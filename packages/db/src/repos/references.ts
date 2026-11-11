import type { CitationDto, ReferenceDto } from '@mediverify/shared';

import { toVectorLiteral, type Queryable } from '../pool.js';

export interface NewReference {
  slug: string;
  title: string;
  versionLabel: string;
  filename: string;
  mimeType: string;
  sha256: string;
  bytes: Buffer;
}

/** Idempotent registration (by content hash). Returns the reference id. */
export async function upsertReference(q: Queryable, r: NewReference): Promise<string> {
  const { rows } = await q.query<{ id: string }>(
    `INSERT INTO reference_documents(slug, title, version_label, filename, mime_type, sha256, bytes)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (sha256) DO UPDATE SET title = EXCLUDED.title
     RETURNING id`,
    [r.slug, r.title, r.versionLabel, r.filename, r.mimeType, r.sha256, r.bytes],
  );
  return rows[0]!.id;
}

export async function listReferences(q: Queryable): Promise<ReferenceDto[]> {
  const { rows } = await q.query<{
    id: string;
    slug: string;
    title: string;
    version_label: string;
    page_count: number | null;
    index_status: ReferenceDto['indexStatus'];
    monograph_count: number;
    created_at: Date;
  }>(
    `SELECT r.id, r.slug, r.title, r.version_label, r.page_count, r.index_status, r.created_at,
            (SELECT count(*)::int FROM reference_monographs m WHERE m.reference_document_id = r.id) AS monograph_count
       FROM reference_documents r ORDER BY r.slug, r.created_at DESC`,
  );
  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    title: r.title,
    versionLabel: r.version_label,
    pageCount: r.page_count,
    indexStatus: r.index_status,
    monographCount: r.monograph_count,
    createdAt: r.created_at.toISOString(),
  }));
}

export async function referenceExists(q: Queryable, id: string) {
  const { rowCount } = await q.query('SELECT 1 FROM reference_documents WHERE id = $1', [id]);
  return rowCount === 1;
}

export async function getReferenceFile(q: Queryable, id: string) {
  const { rows } = await q.query<{ filename: string; mime_type: string; bytes: Buffer }>(
    'SELECT filename, mime_type, bytes FROM reference_documents WHERE id = $1',
    [id],
  );
  return rows[0] ?? null;
}

export async function getReferenceForIndexing(q: Queryable, id: string) {
  const { rows } = await q.query<{
    id: string;
    sha256: string;
    bytes: Buffer;
    index_status: string;
    embedding_model: string | null;
    indexed_at: Date | null;
    version_label: string;
    title: string;
  }>(
    `SELECT id, sha256, bytes, index_status, embedding_model, indexed_at, version_label, title
       FROM reference_documents WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function listReferenceIds(q: Queryable) {
  const { rows } = await q.query<{ id: string }>('SELECT id FROM reference_documents');
  return rows.map((r) => r.id);
}

/** Transaction-scoped lock so only one worker indexes a given reference at a time. */
export async function lockReferenceIndex(q: Queryable, referenceId: string) {
  await q.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 1))', [`refidx:${referenceId}`]);
}

export async function setReferenceIndexStatus(
  q: Queryable,
  referenceId: string,
  status: 'pending' | 'indexing' | 'ready' | 'failed',
  error: string | null = null,
) {
  await q.query(
    'UPDATE reference_documents SET index_status = $2, index_error = $3 WHERE id = $1',
    [referenceId, status, error],
  );
}

export interface MonographInput {
  key: string;
  name: string;
  nameNormalized: string;
  aliases: string[];
  sectionTitle: string | null;
  pageStart: number;
  pageEnd: number;
  ordinal: number;
  rules: unknown;
}

export interface ReferenceChunkInput {
  monographKey: string | null;
  kind: 'monograph' | 'field' | 'section' | 'summary' | 'coverage' | 'front_matter';
  ordinal: number;
  medicationNameNormalized: string | null;
  sectionTitle: string | null;
  fieldLabel: string | null;
  pageStart: number;
  pageEnd: number;
  text: string;
  contentHash: string;
  embedding: number[];
}

/** Replace the whole index for a reference version in one transaction (idempotent rebuild). */
export async function replaceReferenceIndex(
  q: Queryable,
  referenceId: string,
  pageCount: number,
  monographs: MonographInput[],
  chunks: ReferenceChunkInput[],
  embeddingModel: string,
) {
  await q.query('DELETE FROM reference_chunks WHERE reference_document_id = $1', [referenceId]);
  await q.query('DELETE FROM reference_monographs WHERE reference_document_id = $1', [referenceId]);
  const ids = new Map<string, string>();
  for (const m of monographs) {
    const { rows } = await q.query<{ id: string }>(
      `INSERT INTO reference_monographs(reference_document_id, name, name_normalized, aliases, section_title,
              page_start, page_end, ordinal, rules)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [
        referenceId,
        m.name,
        m.nameNormalized,
        m.aliases,
        m.sectionTitle,
        m.pageStart,
        m.pageEnd,
        m.ordinal,
        JSON.stringify(m.rules ?? null),
      ],
    );
    ids.set(m.key, rows[0]!.id);
  }
  for (const c of chunks) {
    await q.query(
      `INSERT INTO reference_chunks(reference_document_id, monograph_id, kind, ordinal, medication_name_normalized,
              section_title, field_label, page_start, page_end, text, content_hash, embedding, embedding_model)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        referenceId,
        c.monographKey ? (ids.get(c.monographKey) ?? null) : null,
        c.kind,
        c.ordinal,
        c.medicationNameNormalized,
        c.sectionTitle,
        c.fieldLabel,
        c.pageStart,
        c.pageEnd,
        c.text,
        c.contentHash,
        toVectorLiteral(c.embedding),
        embeddingModel,
      ],
    );
  }
  await q.query(
    `UPDATE reference_documents SET index_status = 'ready', index_error = NULL, embedding_model = $2,
            indexed_at = now(), page_count = $3 WHERE id = $1`,
    [referenceId, embeddingModel, pageCount],
  );
}

export interface MonographRow {
  id: string;
  name: string;
  name_normalized: string;
  aliases: string[];
  section_title: string | null;
  page_start: number;
  page_end: number;
  rules: unknown;
}

export async function listMonographs(q: Queryable, referenceId: string): Promise<MonographRow[]> {
  const { rows } = await q.query<MonographRow>(
    `SELECT id, name, name_normalized, aliases, section_title, page_start, page_end, rules
       FROM reference_monographs WHERE reference_document_id = $1 ORDER BY ordinal`,
    [referenceId],
  );
  return rows;
}

export async function setMonographRules(q: Queryable, monographId: string, rules: unknown) {
  await q.query('UPDATE reference_monographs SET rules = $2 WHERE id = $1', [
    monographId,
    JSON.stringify(rules),
  ]);
}

export interface ReferenceChunkRow {
  id: string;
  monograph_id: string | null;
  kind: string;
  section_title: string | null;
  field_label: string | null;
  page_start: number;
  page_end: number;
  text: string;
  medication_name_normalized: string | null;
}

const CHUNK_COLS = `id, monograph_id, kind, section_title, field_label, page_start, page_end, text, medication_name_normalized`;

export async function listReferenceChunks(q: Queryable, referenceId: string) {
  const { rows } = await q.query<ReferenceChunkRow>(
    `SELECT ${CHUNK_COLS} FROM reference_chunks WHERE reference_document_id = $1 ORDER BY ordinal`,
    [referenceId],
  );
  return rows;
}

export async function countReferenceChunks(q: Queryable, referenceId: string) {
  const { rows } = await q.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM reference_chunks WHERE reference_document_id = $1',
    [referenceId],
  );
  return rows[0]?.n ?? 0;
}

/**
 * Hybrid retrieval *inside one monograph*: cosine similarity + full-text rank, fused by weighted sum.
 * Identity has already been established by the caller; this only ranks that monograph's passages.
 */
export async function searchMonographChunks(
  q: Queryable,
  monographId: string,
  queryEmbedding: number[],
  queryText: string,
  topK: number,
) {
  const { rows } = await q.query<ReferenceChunkRow & { vector_score: number; text_score: number }>(
    `SELECT ${CHUNK_COLS},
            1 - (embedding <=> $2::vector) AS vector_score,
            ts_rank(tsv, websearch_to_tsquery('english', $3)) AS text_score
       FROM reference_chunks
      WHERE monograph_id = $1 AND kind = 'field'
      ORDER BY (0.7 * (1 - (embedding <=> $2::vector)) + 0.3 * least(ts_rank(tsv, websearch_to_tsquery('english', $3)) * 10, 1)) DESC
      LIMIT $4`,
    [monographId, toVectorLiteral(queryEmbedding), queryText, topK],
  );
  return rows;
}

/**
 * Every field chunk of one monograph with both relevance signals for one query: cosine similarity
 * and full-text rank. The full-text query ORs the query's lexemes (an AND of a long query matches
 * nothing); fusion of the per-query rankings happens in core (`retrieveEvidence`). A monograph has
 * ~10 field chunks, so no LIMIT is needed.
 */
export async function rankMonographFieldChunks(
  q: Queryable,
  monographId: string,
  queryEmbedding: number[],
  queryText: string,
) {
  const { rows } = await q.query<ReferenceChunkRow & { vector_score: number; text_score: number }>(
    `WITH tq AS (
       SELECT NULLIF(replace(plainto_tsquery('english', $3)::text, '&', '|'), '')::tsquery AS q
     )
     SELECT ${CHUNK_COLS},
            1 - (embedding <=> $2::vector) AS vector_score,
            COALESCE(ts_rank(tsv, (SELECT q FROM tq)), 0) AS text_score
       FROM reference_chunks
      WHERE monograph_id = $1 AND kind = 'field'`,
    [monographId, toVectorLiteral(queryEmbedding), queryText],
  );
  return rows;
}

/** Unrestricted vector search over a whole reference (used only for evaluation/diagnostics). */
export async function searchReferenceChunks(
  q: Queryable,
  referenceId: string,
  queryEmbedding: number[],
  topK: number,
) {
  const { rows } = await q.query<ReferenceChunkRow & { vector_score: number }>(
    `SELECT ${CHUNK_COLS}, 1 - (embedding <=> $2::vector) AS vector_score
       FROM reference_chunks WHERE reference_document_id = $1
      ORDER BY embedding <=> $2::vector LIMIT $3`,
    [referenceId, toVectorLiteral(queryEmbedding), topK],
  );
  return rows;
}

export async function getChunksForMonograph(q: Queryable, monographId: string) {
  const { rows } = await q.query<ReferenceChunkRow>(
    `SELECT ${CHUNK_COLS} FROM reference_chunks WHERE monograph_id = $1 ORDER BY ordinal`,
    [monographId],
  );
  return rows;
}

export async function getCoverageChunk(q: Queryable, referenceId: string) {
  const { rows } = await q.query<ReferenceChunkRow>(
    `SELECT ${CHUNK_COLS} FROM reference_chunks
      WHERE reference_document_id = $1 AND kind = 'coverage' ORDER BY ordinal LIMIT 1`,
    [referenceId],
  );
  return rows[0] ?? null;
}

/** Citation preview: the chunk text with its monograph/section/page metadata. */
export async function getChunkCitation(
  q: Queryable,
  referenceId: string,
  chunkId: string,
): Promise<(Omit<CitationDto, 'quote' | 'quoteValid'> & { text: string }) | null> {
  const { rows } = await q.query<{
    id: string;
    reference_document_id: string;
    monograph_name: string | null;
    section_title: string | null;
    field_label: string | null;
    page_start: number;
    text: string;
  }>(
    `SELECT c.id, c.reference_document_id, m.name AS monograph_name, c.section_title, c.field_label,
            c.page_start, c.text
       FROM reference_chunks c LEFT JOIN reference_monographs m ON m.id = c.monograph_id
      WHERE c.reference_document_id = $1 AND c.id = $2`,
    [referenceId, chunkId],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    chunkId: r.id,
    referenceId: r.reference_document_id,
    monographName: r.monograph_name,
    section: r.section_title,
    fieldLabel: r.field_label,
    page: r.page_start,
    text: r.text,
  };
}
