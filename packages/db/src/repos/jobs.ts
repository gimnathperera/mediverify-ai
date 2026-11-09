import {
  STAGES,
  type JobDto,
  type JobStatus,
  type StageDto,
  type StageName,
  type StageStatus,
} from '@mediverify/shared';

import type { Queryable } from '../pool.js';

import { appendEvent } from './events.js';

export class LeaseLostError extends Error {
  constructor(jobId: string) {
    super(`Lease lost for job ${jobId}`);
    this.name = 'LeaseLostError';
  }
}

export interface ClaimedJob {
  id: string;
  document_id: string;
  owner_id: string;
  attempts: number;
  max_attempts: number;
}

/** Atomically claim the oldest available job (safe under concurrency via SKIP LOCKED). */
export async function claimNextJob(
  q: Queryable,
  workerId: string,
  leaseSeconds: number,
): Promise<ClaimedJob | null> {
  const { rows } = await q.query<ClaimedJob>(
    `UPDATE jobs SET status = 'running', attempts = attempts + 1, lease_owner = $1,
            lease_expires_at = now() + make_interval(secs => $2),
            started_at = COALESCE(started_at, now()), updated_at = now()
      WHERE id = (
        SELECT id FROM jobs WHERE status = 'queued' AND available_at <= now()
         ORDER BY available_at, created_at FOR UPDATE SKIP LOCKED LIMIT 1)
      RETURNING id, document_id, owner_id, attempts, max_attempts`,
    [workerId, leaseSeconds],
  );
  return rows[0] ?? null;
}

/** Extend the lease. Returns false if this worker no longer owns the job. */
export async function heartbeat(
  q: Queryable,
  jobId: string,
  workerId: string,
  leaseSeconds: number,
) {
  const { rowCount } = await q.query(
    `UPDATE jobs SET lease_expires_at = now() + make_interval(secs => $3), updated_at = now()
      WHERE id = $1 AND lease_owner = $2 AND status = 'running'`,
    [jobId, workerId, leaseSeconds],
  );
  return rowCount === 1;
}

/** Inside a tx: lock the job row and assert this worker still holds the lease. */
export async function assertLease(q: Queryable, jobId: string, workerId: string) {
  const { rowCount } = await q.query(
    `SELECT 1 FROM jobs WHERE id = $1 AND lease_owner = $2 AND status = 'running' FOR UPDATE`,
    [jobId, workerId],
  );
  if (rowCount !== 1) throw new LeaseLostError(jobId);
}

export async function setJobLlm(q: Queryable, jobId: string, provider: string, model: string) {
  await q.query('UPDATE jobs SET llm_provider = $2, llm_model = $3 WHERE id = $1', [
    jobId,
    provider,
    model,
  ]);
}

export async function getStageStatuses(q: Queryable, jobId: string) {
  const { rows } = await q.query<{ stage: StageName; status: StageStatus }>(
    'SELECT stage, status FROM job_stages WHERE job_id = $1 ORDER BY ordinal',
    [jobId],
  );
  return new Map(rows.map((r) => [r.stage, r.status]));
}

export async function markStageRunning(
  q: Queryable,
  jobId: string,
  stage: StageName,
  attempt: number,
) {
  await q.query(
    `UPDATE job_stages SET status = 'running', attempt = $3, started_at = now(), finished_at = NULL,
            duration_ms = NULL, error_code = NULL, error_message = NULL, detail = NULL
      WHERE job_id = $1 AND stage = $2`,
    [jobId, stage, attempt],
  );
  await q.query('UPDATE jobs SET current_stage = $2, updated_at = now() WHERE id = $1', [
    jobId,
    stage,
  ]);
  return appendEvent(q, jobId, stage, 'stage.started', { attempt });
}

export async function markStageCompleted(
  q: Queryable,
  jobId: string,
  stage: StageName,
  detail: string | null,
  metadata: Record<string, unknown> = {},
) {
  const { rows } = await q.query<{ duration_ms: number }>(
    `UPDATE job_stages SET status = 'completed', finished_at = now(),
            duration_ms = GREATEST(0, (EXTRACT(EPOCH FROM (now() - started_at)) * 1000)::int),
            detail = $3, metadata = $4
      WHERE job_id = $1 AND stage = $2 RETURNING duration_ms`,
    [jobId, stage, detail, JSON.stringify(metadata)],
  );
  const durationMs = rows[0]?.duration_ms ?? null;
  await appendEvent(q, jobId, stage, 'stage.completed', { durationMs, detail, ...metadata });
  return durationMs;
}

export async function addStageProgress(
  q: Queryable,
  jobId: string,
  stage: StageName,
  message: string,
  data: Record<string, unknown> = {},
) {
  return appendEvent(q, jobId, stage, 'stage.progress', { message, ...data });
}

export async function completeJob(q: Queryable, jobId: string) {
  await q.query(
    `UPDATE jobs SET status = 'completed', current_stage = 'done', finished_at = now(),
            lease_owner = NULL, lease_expires_at = NULL, updated_at = now()
      WHERE id = $1`,
    [jobId],
  );
  await appendEvent(q, jobId, null, 'job.completed', {});
}

/**
 * Terminal failure: failing stage → failed, remaining pending/running stages → skipped, job → failed.
 * Messages must already be sanitized (no document text, no secrets).
 */
export async function failJob(
  q: Queryable,
  jobId: string,
  stage: StageName | null,
  errorCode: string,
  errorMessage: string,
) {
  if (stage) {
    await q.query(
      `UPDATE job_stages SET status = 'failed', finished_at = now(),
              duration_ms = CASE WHEN started_at IS NULL THEN NULL
                ELSE GREATEST(0, (EXTRACT(EPOCH FROM (now() - started_at)) * 1000)::int) END,
              error_code = $3, error_message = $4
        WHERE job_id = $1 AND stage = $2`,
      [jobId, stage, errorCode, errorMessage],
    );
    await appendEvent(q, jobId, stage, 'stage.failed', { errorCode, errorMessage });
  }
  const skipped = await q.query<{ stage: StageName }>(
    `UPDATE job_stages SET status = 'skipped'
      WHERE job_id = $1 AND status IN ('pending', 'running') RETURNING stage`,
    [jobId],
  );
  for (const s of skipped.rows) {
    await appendEvent(q, jobId, s.stage, 'stage.skipped', { reason: 'previous stage failed' });
  }
  await q.query(
    `UPDATE jobs SET status = 'failed', error_code = $2, error_message = $3, finished_at = now(),
            lease_owner = NULL, lease_expires_at = NULL, updated_at = now()
      WHERE id = $1`,
    [jobId, errorCode, errorMessage],
  );
  await appendEvent(q, jobId, stage, 'job.failed', { errorCode, errorMessage });
}

/** Release a job back to the queue (graceful shutdown or retryable error). */
export async function requeueJob(
  q: Queryable,
  jobId: string,
  stage: StageName | null,
  delaySeconds: number,
  reason: string,
) {
  if (stage) {
    await q.query(
      `UPDATE job_stages SET status = 'pending', started_at = NULL WHERE job_id = $1 AND stage = $2 AND status = 'running'`,
      [jobId, stage],
    );
  }
  await q.query(
    `UPDATE jobs SET status = 'queued', lease_owner = NULL, lease_expires_at = NULL,
            available_at = now() + make_interval(secs => $2), updated_at = now()
      WHERE id = $1`,
    [jobId, delaySeconds],
  );
  await appendEvent(q, jobId, stage, 'job.retrying', { reason, delaySeconds });
}

/**
 * Recover jobs whose worker died (lease expired). Requeue if attempts remain, otherwise fail.
 * Runs in a caller-provided transaction; rows are locked with SKIP LOCKED so reapers don't collide.
 */
export async function reapExpiredLeases(q: Queryable, retryDelaySeconds: number) {
  const { rows } = await q.query<{
    id: string;
    attempts: number;
    max_attempts: number;
    current_stage: StageName | null;
  }>(
    `SELECT id, attempts, max_attempts, current_stage FROM jobs
      WHERE status = 'running' AND lease_expires_at < now()
      FOR UPDATE SKIP LOCKED`,
  );
  const requeued: string[] = [];
  const failed: string[] = [];
  for (const job of rows) {
    if (job.attempts >= job.max_attempts) {
      await failJob(
        q,
        job.id,
        job.current_stage,
        'WORKER_LOST',
        `Worker stopped responding; gave up after ${job.attempts} attempt(s).`,
      );
      failed.push(job.id);
    } else {
      await requeueJob(q, job.id, job.current_stage, retryDelaySeconds, 'worker lease expired');
      requeued.push(job.id);
    }
  }
  return { requeued, failed };
}

interface JobRow {
  id: string;
  document_id: string;
  status: JobStatus;
  current_stage: StageName | null;
  attempts: number;
  max_attempts: number;
  error_code: string | null;
  error_message: string | null;
  llm_provider: string | null;
  created_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
}

interface StageRow {
  stage: StageName;
  ordinal: number;
  status: StageStatus;
  started_at: Date | null;
  finished_at: Date | null;
  duration_ms: number | null;
  error_code: string | null;
  error_message: string | null;
  detail: string | null;
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

/** Snapshot used by the API (and SSE clients) — enforces ownership in SQL. */
export async function getJobForOwner(
  q: Queryable,
  jobId: string,
  ownerId: string,
): Promise<JobDto | null> {
  const job = await q.query<JobRow>(
    `SELECT id, document_id, status, current_stage, attempts, max_attempts, error_code, error_message,
            llm_provider, created_at, started_at, finished_at
       FROM jobs WHERE id = $1 AND owner_id = $2`,
    [jobId, ownerId],
  );
  const j = job.rows[0];
  if (!j) return null;
  // Read the event high-water mark *before* stages: replay from here never misses a transition.
  const last = await q.query<{ id: string | null }>(
    'SELECT max(id)::text AS id FROM job_events WHERE job_id = $1',
    [jobId],
  );
  const stages = await q.query<StageRow>(
    `SELECT stage, ordinal, status, started_at, finished_at, duration_ms, error_code, error_message, detail
       FROM job_stages WHERE job_id = $1 ORDER BY ordinal`,
    [jobId],
  );
  return {
    id: j.id,
    documentId: j.document_id,
    status: j.status,
    currentStage: j.current_stage,
    attempts: j.attempts,
    maxAttempts: j.max_attempts,
    errorCode: j.error_code,
    errorMessage: j.error_message,
    createdAt: j.created_at.toISOString(),
    startedAt: iso(j.started_at),
    finishedAt: iso(j.finished_at),
    lastEventId: last.rows[0]?.id ?? '0',
    llmProvider: j.llm_provider,
    stages: stages.rows.map((s): StageDto => ({
      stage: s.stage,
      ordinal: s.ordinal,
      status: s.status,
      startedAt: iso(s.started_at),
      finishedAt: iso(s.finished_at),
      durationMs: s.duration_ms,
      errorCode: s.error_code,
      errorMessage: s.error_message,
      detail: s.detail,
    })),
  };
}

export async function getJobStatus(q: Queryable, jobId: string) {
  const { rows } = await q.query<{ status: JobStatus }>('SELECT status FROM jobs WHERE id = $1', [
    jobId,
  ]);
  return rows[0]?.status ?? null;
}

/** Owner-scoped: create a fresh job for an existing document (manual retry after failure). */
export async function createRetryJob(q: Queryable, jobId: string, ownerId: string) {
  const { rows } = await q.query<{ document_id: string; status: JobStatus; max_attempts: number }>(
    'SELECT document_id, status, max_attempts FROM jobs WHERE id = $1 AND owner_id = $2 FOR UPDATE',
    [jobId, ownerId],
  );
  const prev = rows[0];
  if (!prev) return { kind: 'not_found' as const };
  if (prev.status !== 'failed') return { kind: 'not_retryable' as const };
  const job = await q.query<{ id: string }>(
    'INSERT INTO jobs(document_id, owner_id, max_attempts) VALUES ($1, $2, $3) RETURNING id',
    [prev.document_id, ownerId, prev.max_attempts],
  );
  const newId = job.rows[0]!.id;
  await q.query(
    `INSERT INTO job_stages(job_id, stage, ordinal)
     SELECT $1, s.stage, s.ord FROM unnest($2::text[]) WITH ORDINALITY AS s(stage, ord)`,
    [newId, STAGES as readonly StageName[]],
  );
  await appendEvent(q, newId, null, 'job.queued', { retryOf: jobId });
  await q.query("SELECT pg_notify('job_queue', $1)", [newId]);
  return { kind: 'ok' as const, jobId: newId, documentId: prev.document_id };
}
