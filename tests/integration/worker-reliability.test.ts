import { LlmError, type LlmProvider, type LlmRequest } from '@mediverify/core';
import { jobsRepo, withTransaction, type pg } from '@mediverify/db';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { listenForJobs } from '../../apps/worker/src/queue-listener.js';
import { createUser, deps, runJob, testPool, uploadFile } from '../helpers/db.js';
import { TEST_DATABASE_URL } from '../helpers/env.js';

let pool: pg.Pool;
beforeAll(() => {
  pool = testPool();
});
afterAll(async () => {
  await pool.end();
});

class FailingLlm implements LlmProvider {
  readonly name = 'failing';
  readonly model = 'failing';
  calls = 0;
  constructor(private readonly err: LlmError) {}
  generate<T>(_req: LlmRequest<T>): Promise<T> {
    this.calls++;
    return Promise.reject(this.err);
  }
}

async function stages(jobId: string) {
  const { rows } = await pool.query<{ stage: string; status: string; error_code: string | null }>(
    'SELECT stage, status, error_code FROM job_stages WHERE job_id = $1 ORDER BY ordinal',
    [jobId],
  );
  return Object.fromEntries(rows.map((r) => [r.stage, r]));
}

async function job(jobId: string) {
  const { rows } = await pool.query('SELECT * FROM jobs WHERE id = $1', [jobId]);
  return rows[0] as {
    status: string;
    error_code: string | null;
    error_message: string | null;
    attempts: number;
    lease_owner: string | null;
    available_at: Date;
  };
}

describe('model / stage failure handling', () => {
  it('non-retryable model error → failing stage failed, later stages skipped, job failed with message', async () => {
    const u = await createUser(pool, 'fail');
    const { jobId } = await uploadFile(pool, u.id);
    const outcome = await runJob(
      pool,
      jobId,
      deps(pool, new FailingLlm(new LlmError('MODEL_NOT_CONFIGURED', 'No LLM is configured'))),
    );
    expect(outcome).toBe('failed');
    const s = await stages(jobId);
    expect(s.parsed!.status).toBe('completed');
    expect(s.embedded!.status).toBe('completed');
    expect(s.summarized).toMatchObject({ status: 'failed', error_code: 'MODEL_NOT_CONFIGURED' });
    for (const later of ['key_points_extracted', 'entities_extracted', 'verified', 'done'])
      expect(s[later]!.status).toBe('skipped');
    const j = await job(jobId);
    expect(j).toMatchObject({
      status: 'failed',
      error_code: 'MODEL_NOT_CONFIGURED',
      lease_owner: null,
    });
    expect(j.error_message).toMatch(/No LLM is configured/);
    const ev = await pool.query<{ type: string }>(
      "SELECT type FROM job_events WHERE job_id = $1 AND type IN ('stage.failed','job.failed')",
      [jobId],
    );
    expect(ev.rows.map((r) => r.type)).toEqual(['stage.failed', 'job.failed']);
  });

  it('retryable model error → requeued with backoff while attempts remain, then terminal failure', async () => {
    const u = await createUser(pool, 'retry');
    const { jobId } = await uploadFile(pool, u.id);
    await pool.query('UPDATE jobs SET max_attempts = 2 WHERE id = $1', [jobId]);
    const llm = new FailingLlm(
      new LlmError('MODEL_UNAVAILABLE', 'Model provider unavailable (HTTP 503)', true),
    );
    expect(await runJob(pool, jobId, deps(pool, llm))).toBe('requeued');
    let j = await job(jobId);
    expect(j.status).toBe('queued');
    expect((await stages(jobId)).summarized!.status).toBe('pending');
    expect((await stages(jobId)).parsed!.status).toBe('completed'); // completed stages are kept
    // Second (last) attempt fails terminally.
    expect(await runJob(pool, jobId, deps(pool, llm))).toBe('failed');
    j = await job(jobId);
    expect(j).toMatchObject({ status: 'failed', error_code: 'MODEL_UNAVAILABLE', attempts: 2 });
  });

  it('a resumed job skips already-completed stages (idempotent resume)', async () => {
    const u = await createUser(pool, 'resume');
    const { jobId } = await uploadFile(pool, u.id);
    await pool.query('UPDATE jobs SET max_attempts = 3 WHERE id = $1', [jobId]);
    await runJob(
      pool,
      jobId,
      deps(pool, new FailingLlm(new LlmError('MODEL_UNAVAILABLE', 'down', true))),
    );
    const parsedEventsBefore = await pool.query(
      "SELECT count(*)::int n FROM job_events WHERE job_id = $1 AND stage = 'parsed' AND type = 'stage.started'",
      [jobId],
    );
    await pool.query('UPDATE jobs SET available_at = now() WHERE id = $1', [jobId]);
    expect(await runJob(pool, jobId, deps(pool))).toBe('completed');
    const parsedEventsAfter = await pool.query(
      "SELECT count(*)::int n FROM job_events WHERE job_id = $1 AND stage = 'parsed' AND type = 'stage.started'",
      [jobId],
    );
    expect(parsedEventsAfter.rows[0].n).toBe(parsedEventsBefore.rows[0].n);
  });
});

describe('queue safety', () => {
  it('concurrent claims never hand the same job to two workers (SKIP LOCKED)', async () => {
    const u = await createUser(pool, 'claim');
    await uploadFile(pool, u.id);
    await uploadFile(pool, u.id);
    const claims = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        withTransaction(pool, (c) => jobsRepo.claimNextJob(c, `w${i}`, 60)),
      ),
    );
    const ids = claims.filter(Boolean).map((c) => c!.id);
    expect(ids.length).toBeGreaterThanOrEqual(2);
    expect(new Set(ids).size).toBe(ids.length);
    // release them so other tests are unaffected
    await pool.query("UPDATE jobs SET status = 'failed', lease_owner = NULL WHERE id = ANY($1)", [
      ids,
    ]);
  });

  it('reaper requeues a crashed worker’s job, and fails it once attempts are exhausted (no hung jobs)', async () => {
    const u = await createUser(pool, 'reaper');
    const a = await uploadFile(pool, u.id);
    const b = await uploadFile(pool, u.id);
    await pool.query(
      `UPDATE jobs SET status = 'running', lease_owner = 'dead-worker', lease_expires_at = now() - interval '1 minute',
              attempts = CASE WHEN id = $1 THEN 1 ELSE 3 END, max_attempts = 3, current_stage = 'summarized'
        WHERE id IN ($1, $2)`,
      [a.jobId, b.jobId],
    );
    await pool.query(
      "UPDATE job_stages SET status = 'running', started_at = now() WHERE job_id IN ($1, $2) AND stage = 'summarized'",
      [a.jobId, b.jobId],
    );
    const out = await withTransaction(pool, (c) => jobsRepo.reapExpiredLeases(c, 0));
    expect(out.requeued).toContain(a.jobId);
    expect(out.failed).toContain(b.jobId);
    expect((await job(a.jobId)).status).toBe('queued');
    expect((await stages(a.jobId)).summarized!.status).toBe('pending');
    expect(await job(b.jobId)).toMatchObject({ status: 'failed', error_code: 'WORKER_LOST' });
    expect((await stages(b.jobId)).summarized!.status).toBe('failed');
  });

  it('a worker that lost its lease cannot write results (zombie protection)', async () => {
    const u = await createUser(pool, 'zombie');
    const { jobId } = await uploadFile(pool, u.id);
    class StealLease implements LlmProvider {
      readonly name = 'steal';
      readonly model = 'steal';
      async generate<T>(): Promise<T> {
        await pool.query("UPDATE jobs SET lease_owner = 'other-worker' WHERE id = $1", [jobId]);
        throw new LlmError('MODEL_UNAVAILABLE', 'irrelevant', true);
      }
    }
    expect(await runJob(pool, jobId, deps(pool, new StealLease()))).toBe('lease_lost');
    const s = await stages(jobId);
    expect(s.summarized!.status).toBe('running'); // untouched by the zombie; reaper/new owner handles it
  });
});

describe('queue listener', () => {
  it('survives a dropped LISTEN connection, reconnects, and keeps receiving notifications', async () => {
    const channel = 'test_queue_listener';
    const onNotify = vi.fn();
    const listener = await listenForJobs({
      connectionString: TEST_DATABASE_URL,
      channel,
      onNotify,
      log: pino({ level: 'silent' }),
      retryMs: 50,
    });
    try {
      await pool.query(`NOTIFY ${channel}`);
      await vi.waitFor(() => expect(onNotify).toHaveBeenCalledTimes(1));

      // What a database restart does to an idle LISTEN connection. Before the fix this emitted an
      // unhandled 'error' event and killed the worker process (Vitest fails on unhandled errors).
      const { rows } = await pool.query<{ killed: boolean }>(
        `SELECT pg_terminate_backend(pid) AS killed FROM pg_stat_activity
          WHERE datname = current_database() AND query = $1`,
        [`LISTEN ${channel}`],
      );
      expect(rows.map((r) => r.killed)).toEqual([true]);

      // Reconnect pokes the worker once (to claim anything queued during the outage)…
      await vi.waitFor(() => expect(onNotify).toHaveBeenCalledTimes(2), { timeout: 5000 });
      // …and new notifications arrive on the new connection.
      await pool.query(`NOTIFY ${channel}`);
      await vi.waitFor(() => expect(onNotify).toHaveBeenCalledTimes(3));
    } finally {
      await listener.close();
    }
  });
});
