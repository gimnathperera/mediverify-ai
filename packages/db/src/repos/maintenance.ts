import type { Queryable } from '../pool.js';

/**
 * Data lifecycle, run periodically by the worker:
 * - sessions: expired ones, and revoked ones after a day (kept briefly for audit);
 * - job events: progress history of finished jobs older than `eventRetentionDays` (results, stages
 *   and the job row stay — events only power live progress and replay);
 * - documents: older than `documentRetentionDays` with no job still queued/running; their jobs and
 *   results cascade. 0 disables a rule.
 */
export async function purgeExpiredData(
  q: Queryable,
  opts: { eventRetentionDays: number; documentRetentionDays: number },
) {
  const sessions = await q.query(
    `DELETE FROM sessions
      WHERE expires_at < now() OR (revoked_at IS NOT NULL AND revoked_at < now() - interval '1 day')`,
  );
  const events =
    opts.eventRetentionDays > 0
      ? await q.query(
          `DELETE FROM job_events e USING jobs j
            WHERE e.job_id = j.id AND j.status IN ('completed', 'failed')
              AND e.created_at < now() - make_interval(days => $1)`,
          [opts.eventRetentionDays],
        )
      : null;
  const documents =
    opts.documentRetentionDays > 0
      ? await q.query(
          `DELETE FROM documents d
            WHERE d.created_at < now() - make_interval(days => $1)
              AND NOT EXISTS (SELECT 1 FROM jobs j
                               WHERE j.document_id = d.id AND j.status IN ('queued', 'running'))`,
          [opts.documentRetentionDays],
        )
      : null;
  return {
    sessions: sessions.rowCount ?? 0,
    events: events?.rowCount ?? 0,
    documents: documents?.rowCount ?? 0,
  };
}
