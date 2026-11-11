import { FixtureProvider, LlmError, type LlmProvider, type LlmRequest } from '@mediverify/core';
import {
  jobsRepo,
  listenWithReconnect,
  maintenanceRepo,
  resultsRepo,
  withTransaction,
  type pg,
} from '@mediverify/db';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createUser, deps, runJob, testPool, uploadFile } from '../helpers/db.js';
import { FIXTURE_DIR, TEST_DATABASE_URL } from '../helpers/env.js';

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
    const listener = await listenWithReconnect({
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

/** Never answers on its own; settles only when the stage's abort signal fires. */
class HangingLlm implements LlmProvider {
  readonly name = 'hanging';
  readonly model = 'hanging';
  sawAbort = false;
  generate<T>(req: LlmRequest<T>): Promise<T> {
    return new Promise<T>((_, reject) => {
      req.signal?.addEventListener('abort', () => {
        this.sawAbort = true;
        reject(new Error('aborted'));
      });
    });
  }
}

/** Fixture outputs, except one medication's verification fails. */
class PartlyFailingLlm implements LlmProvider {
  readonly name = 'fixture';
  readonly model = 'fixture';
  private readonly inner = new FixtureProvider(FIXTURE_DIR);
  generate<T>(req: LlmRequest<T>): Promise<T> {
    if (req.fixtureKey.endsWith('verify--pravoxil'))
      return Promise.reject(new LlmError('MODEL_UNAVAILABLE', 'provider error', true));
    return this.inner.generate(req);
  }
}

describe('limits, cancellation and partial failure', () => {
  it('a stage timeout aborts the in-flight model call instead of letting it run on', async () => {
    const u = await createUser(pool, 'timeout');
    const { jobId } = await uploadFile(pool, u.id);
    const llm = new HangingLlm();
    // Long enough for parsing/embedding; the first model call (summary) then hangs until aborted.
    const outcome = await runJob(pool, jobId, deps(pool, llm), 'test-worker', {
      stageTimeoutMs: 8000,
    });
    expect(outcome).toBe('requeued'); // STAGE_TIMEOUT is retryable
    expect(llm.sawAbort).toBe(true);
    expect((await stages(jobId)).summarized!.status).toBe('pending');
  });

  it('refuses a document over the page limit before any model call', async () => {
    const u = await createUser(pool, 'toolarge');
    const { jobId } = await uploadFile(pool, u.id);
    const llm = new FailingLlm(new LlmError('MODEL_UNAVAILABLE', 'must not be called'));
    const d = deps(pool, llm);
    const outcome = await runJob(pool, jobId, {
      ...d,
      config: { ...d.config, maxDocumentPages: 1 },
    });
    expect(outcome).toBe('failed');
    expect((await stages(jobId)).parsed).toMatchObject({
      status: 'failed',
      error_code: 'DOCUMENT_TOO_LARGE',
    });
    expect(llm.calls).toBe(0);
  });

  it('one medication failing leaves the others verified and records model usage', async () => {
    const u = await createUser(pool, 'partial');
    const { jobId } = await uploadFile(pool, u.id);
    expect(await runJob(pool, jobId, deps(pool, new PartlyFailingLlm()))).toBe('completed');
    const results = await resultsRepo.getResultsForOwner(pool, jobId, u.id);
    const status = Object.fromEntries(results!.verifications.map((v) => [v.drugName, v.status]));
    expect(status).toMatchObject({
      Pravoxil: 'incomplete',
      'Cordizem-XR': 'contradicted',
      Etrazolam: 'contradicted',
      Velantine: 'supported',
      Quintaxin: 'supported',
      Pranixol: 'unsupported',
    });
    const usage = await pool.query<{ llm_usage: { calls: number } }>(
      'SELECT llm_usage FROM jobs WHERE id = $1',
      [jobId],
    );
    // Summary, critical points, entities and the 4 verifications that succeeded (a failed call
    // returns no usage).
    expect(usage.rows[0]!.llm_usage.calls).toBe(7);
  });

  it('keeps a citation after its passage leaves the index (evidence snapshot)', async () => {
    const u = await createUser(pool, 'snapshot');
    const { jobId } = await uploadFile(pool, u.id);
    expect(await runJob(pool, jobId, deps(pool))).toBe('completed');
    // Simulate a re-index for this job's findings only (the shared index is left intact).
    await pool.query(
      `UPDATE verification_findings f SET chunk_id = NULL
         FROM verification_results v WHERE v.id = f.verification_result_id AND v.job_id = $1`,
      [jobId],
    );
    const results = await resultsRepo.getResultsForOwner(pool, jobId, u.id);
    const pravoxil = results!.verifications.find((v) => v.drugName === 'Pravoxil')!;
    const timing = pravoxil.findings.find((f) => f.field === 'timing')!;
    expect(timing.citation).toMatchObject({
      chunkId: null,
      monographName: 'Pravoxil',
      quoteValid: true,
    });
    expect(timing.citation!.page).toBeGreaterThan(0);
  });
});

describe('data lifecycle', () => {
  it('purges expired sessions and old progress events of finished jobs, keeping results', async () => {
    const u = await createUser(pool, 'retention');
    const { jobId } = await uploadFile(pool, u.id);
    expect(await runJob(pool, jobId, deps(pool))).toBe('completed');
    await pool.query(
      "UPDATE job_events SET created_at = now() - interval '40 days' WHERE job_id = $1",
      [jobId],
    );
    const session = await pool.query<{ id: string }>(
      `INSERT INTO sessions(user_id, token_hash, expires_at)
       VALUES ($1, gen_random_bytes(32), now() - interval '1 hour') RETURNING id`,
      [u.id],
    );
    const r = await maintenanceRepo.purgeExpiredData(pool, {
      eventRetentionDays: 30,
      documentRetentionDays: 0,
    });
    expect(r.events).toBeGreaterThan(0);
    expect(r.documents).toBe(0);
    const left = await pool.query(
      `SELECT (SELECT count(*) FROM job_events WHERE job_id = $1)::int AS events,
              (SELECT count(*) FROM verification_results WHERE job_id = $1)::int AS results,
              (SELECT count(*) FROM sessions WHERE id = $2)::int AS sessions`,
      [jobId, session.rows[0]!.id],
    );
    expect(left.rows[0]).toEqual({ events: 0, results: 6, sessions: 0 });
  });
});
