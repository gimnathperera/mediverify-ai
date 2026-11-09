import type { JobEventDto, JobEventType, StageName } from '@mediverify/shared';

import type { Queryable } from '../pool.js';

export const JOB_EVENTS_CHANNEL = 'job_events';
export const JOB_QUEUE_CHANNEL = 'job_queue';

/** Append an event and NOTIFY listeners (delivered on commit when inside a transaction). */
export async function appendEvent(
  q: Queryable,
  jobId: string,
  stage: StageName | null,
  type: JobEventType,
  payload: Record<string, unknown> = {},
): Promise<string> {
  const { rows } = await q.query<{ id: string }>(
    `INSERT INTO job_events(job_id, stage, type, payload) VALUES ($1, $2, $3, $4) RETURNING id`,
    [jobId, stage, type, JSON.stringify(payload)],
  );
  await q.query('SELECT pg_notify($1, $2)', [JOB_EVENTS_CHANNEL, jobId]);
  return rows[0]!.id;
}

interface EventRow {
  id: string;
  job_id: string;
  stage: StageName | null;
  type: string;
  payload: Record<string, unknown>;
  created_at: Date;
}

export async function listEventsSince(
  q: Queryable,
  jobId: string,
  afterId: string,
  limit = 500,
): Promise<JobEventDto[]> {
  const { rows } = await q.query<EventRow>(
    `SELECT id, job_id, stage, type, payload, created_at FROM job_events
     WHERE job_id = $1 AND id > $2 ORDER BY id LIMIT $3`,
    [jobId, afterId, limit],
  );
  return rows.map((r) => ({
    id: r.id,
    jobId: r.job_id,
    stage: r.stage,
    type: r.type,
    payload: r.payload,
    createdAt: r.created_at.toISOString(),
  }));
}
