import {
  STAGES,
  type DocumentDto,
  type DocumentStatusFilter,
  type JobStatus,
  type StageName,
} from '@mediverify/shared';

import type { Queryable } from '../pool.js';

import { appendEvent, JOB_QUEUE_CHANNEL } from './events.js';

export interface NewUpload {
  ownerId: string;
  referenceId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  bytes: Buffer;
  maxAttempts: number;
}

/**
 * Inserts document + job + all stage rows + initial event. MUST be called inside a transaction
 * (see DocumentsService) so that either everything or nothing is persisted.
 */
export async function insertUploadRecords(q: Queryable, u: NewUpload) {
  const doc = await q.query<{ id: string }>(
    `INSERT INTO documents(owner_id, reference_document_id, filename, mime_type, size_bytes, sha256, bytes)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [u.ownerId, u.referenceId, u.filename, u.mimeType, u.sizeBytes, u.sha256, u.bytes],
  );
  const documentId = doc.rows[0]!.id;
  const job = await q.query<{ id: string }>(
    `INSERT INTO jobs(document_id, owner_id, max_attempts) VALUES ($1, $2, $3) RETURNING id`,
    [documentId, u.ownerId, u.maxAttempts],
  );
  const jobId = job.rows[0]!.id;
  await q.query(
    `INSERT INTO job_stages(job_id, stage, ordinal)
     SELECT $1, s.stage, s.ord FROM unnest($2::text[]) WITH ORDINALITY AS s(stage, ord)`,
    [jobId, STAGES as readonly StageName[]],
  );
  await appendEvent(q, jobId, null, 'job.queued', { documentId });
  await q.query('SELECT pg_notify($1, $2)', [JOB_QUEUE_CHANNEL, jobId]);
  return { documentId, jobId };
}

/** Same owner + same content + same reference within the window, whose job did not fail. */
export async function findRecentDuplicate(
  q: Queryable,
  ownerId: string,
  sha256: string,
  referenceId: string,
  windowSeconds: number,
) {
  if (windowSeconds <= 0) return null;
  const { rows } = await q.query<{ document_id: string; job_id: string }>(
    `SELECT d.id AS document_id, j.id AS job_id
       FROM documents d JOIN jobs j ON j.document_id = d.id
      WHERE d.owner_id = $1 AND d.sha256 = $2 AND d.reference_document_id = $3
        AND d.created_at > now() - make_interval(secs => $4)
        AND j.status <> 'failed'
      ORDER BY d.created_at DESC, j.created_at DESC LIMIT 1`,
    [ownerId, sha256, referenceId, windowSeconds],
  );
  const r = rows[0];
  return r ? { documentId: r.document_id, jobId: r.job_id } : null;
}

/** Serialize concurrent duplicate checks for the same owner+hash inside the upload transaction. */
export async function lockUploadKey(q: Queryable, ownerId: string, sha256: string) {
  await q.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`${ownerId}:${sha256}`]);
}

interface DocRow {
  id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  page_count: number | null;
  created_at: Date;
  ref_id: string;
  ref_title: string;
  ref_version: string;
  job_id: string | null;
  job_status: JobStatus | null;
  job_stage: StageName | null;
  job_error: string | null;
}

const DOC_SELECT = `
  SELECT d.id, d.filename, d.mime_type, d.size_bytes, d.page_count, d.created_at,
         r.id AS ref_id, r.title AS ref_title, r.version_label AS ref_version,
         j.id AS job_id, j.status AS job_status, j.current_stage AS job_stage, j.error_message AS job_error
    FROM documents d
    JOIN reference_documents r ON r.id = d.reference_document_id
    LEFT JOIN LATERAL (
      SELECT id, status, current_stage, error_message FROM jobs
       WHERE document_id = d.id ORDER BY created_at DESC LIMIT 1
    ) j ON true`;

function toDocDto(r: DocRow): DocumentDto {
  return {
    id: r.id,
    filename: r.filename,
    mimeType: r.mime_type,
    sizeBytes: r.size_bytes,
    pageCount: r.page_count,
    createdAt: r.created_at.toISOString(),
    reference: { id: r.ref_id, title: r.ref_title, versionLabel: r.ref_version },
    latestJob: r.job_id
      ? {
          id: r.job_id,
          status: r.job_status!,
          currentStage: r.job_stage,
          errorMessage: r.job_error,
        }
      : null,
  };
}

/** Keyset cursor: the last row's exact created_at (Postgres text, µs precision) and id. */
export function encodeCursor(createdAt: string, id: string) {
  return Buffer.from(`${createdAt}|${id}`).toString('base64url');
}

export function decodeCursor(cursor: string): { createdAt: string; id: string } | null {
  const [createdAt, id] = Buffer.from(cursor, 'base64url').toString().split('|');
  if (!createdAt || !id || Number.isNaN(Date.parse(createdAt))) return null;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  return { createdAt, id };
}

// Latest-job status groups used by the list filter ($3; 'processing' = queued, running or no job).
const STATUS_SQL = `($3 = 'all'
  OR ($3 = 'completed' AND job_status = 'completed')
  OR ($3 = 'failed' AND job_status = 'failed')
  OR ($3 = 'processing' AND (job_status IS NULL OR job_status IN ('queued', 'running'))))`;

/**
 * One page of a user's documents, newest first, filtered on the server by latest-job status and
 * file name. Keyset pagination on (created_at, id) stays stable while new uploads arrive. `counts`
 * are per status for the current search, so the filter badges match what paging will return.
 */
export async function listDocumentsPage(
  q: Queryable,
  ownerId: string,
  opts: {
    limit: number;
    status: DocumentStatusFilter;
    search?: string | undefined;
    after?: { createdAt: string; id: string } | null;
  },
): Promise<{
  items: DocumentDto[];
  nextCursor: string | null;
  counts: Record<DocumentStatusFilter, number>;
}> {
  const like = opts.search ? `%${opts.search.replace(/[\\%_]/g, '\\$&')}%` : null;
  // The user's documents matching the search. Both queries pass $1 = owner, $2 = ILIKE pattern.
  const base = `WITH base AS (
      SELECT x.*, x.created_at::text AS cursor_ts FROM (${DOC_SELECT}
       WHERE d.owner_id = $1 AND ($2::text IS NULL OR d.filename ILIKE $2)) x
    )`;
  const page = await q.query<DocRow & { cursor_ts: string }>(
    `${base}
     SELECT * FROM base
      WHERE ${STATUS_SQL}
        AND ($4::timestamptz IS NULL OR (created_at, id) < ($4::timestamptz, $5::uuid))
      ORDER BY created_at DESC, id DESC
      LIMIT $6`,
    [
      ownerId,
      like,
      opts.status,
      opts.after?.createdAt ?? null,
      opts.after?.id ?? null,
      opts.limit + 1,
    ],
  );
  const counts = await q.query<Record<DocumentStatusFilter, number>>(
    `${base}
     SELECT count(*)::int AS "all",
            count(*) FILTER (WHERE job_status IS NULL OR job_status IN ('queued', 'running'))::int AS processing,
            count(*) FILTER (WHERE job_status = 'completed')::int AS completed,
            count(*) FILTER (WHERE job_status = 'failed')::int AS failed
       FROM base`,
    [ownerId, like],
  );
  const rows = page.rows.slice(0, opts.limit);
  const last = rows.at(-1);
  return {
    items: rows.map(toDocDto),
    nextCursor:
      page.rows.length > opts.limit && last ? encodeCursor(last.cursor_ts, last.id) : null,
    counts: counts.rows[0]!,
  };
}

/** Delete a user's document; jobs, events and all results cascade. False if not theirs / absent. */
export async function deleteDocumentForOwner(q: Queryable, documentId: string, ownerId: string) {
  const { rowCount } = await q.query('DELETE FROM documents WHERE id = $1 AND owner_id = $2', [
    documentId,
    ownerId,
  ]);
  return rowCount === 1;
}

export async function getDocumentForOwner(q: Queryable, documentId: string, ownerId: string) {
  const { rows } = await q.query<DocRow>(`${DOC_SELECT} WHERE d.id = $1 AND d.owner_id = $2`, [
    documentId,
    ownerId,
  ]);
  return rows[0] ? toDocDto(rows[0]) : null;
}

/** Returns the bytes to render: converted preview PDF for DOCX, original for PDF. */
export async function getDocumentFileForOwner(q: Queryable, documentId: string, ownerId: string) {
  const { rows } = await q.query<{
    filename: string;
    mime_type: string;
    bytes: Buffer;
    preview_pdf: Buffer | null;
  }>(
    `SELECT filename, mime_type, bytes, preview_pdf FROM documents WHERE id = $1 AND owner_id = $2`,
    [documentId, ownerId],
  );
  return rows[0] ?? null;
}

// ---- worker-side accessors (no owner filter: worker acts on behalf of the job's owner) ----
export async function getDocumentForProcessing(q: Queryable, documentId: string) {
  const { rows } = await q.query<{
    id: string;
    owner_id: string;
    reference_document_id: string;
    filename: string;
    mime_type: string;
    sha256: string;
    bytes: Buffer;
    preview_pdf: Buffer | null;
  }>(
    `SELECT id, owner_id, reference_document_id, filename, mime_type, sha256, bytes, preview_pdf
       FROM documents WHERE id = $1`,
    [documentId],
  );
  return rows[0] ?? null;
}

export async function setDocumentParseInfo(
  q: Queryable,
  documentId: string,
  pageCount: number,
  previewPdf: Buffer | null,
) {
  await q.query(
    'UPDATE documents SET page_count = $2, preview_pdf = COALESCE($3, preview_pdf) WHERE id = $1',
    [documentId, pageCount, previewPdf],
  );
}
