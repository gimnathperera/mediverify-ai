import {
  documentsRepo,
  referencesRepo,
  resultsRepo,
  type pg,
  type PoolClient,
} from '@mediverify/db';
import type { PipelineErrorCode, StageName } from '@mediverify/shared';
import type { Logger } from 'pino';

import { chunkPrimary } from '../chunking/primary.js';
import type { EmbeddingProvider, LlmProvider } from '../llm/types.js';
import { convertDocxToPdf, isDocx, isPdf, parsePdf } from '../parsing/index.js';
import type { ParsedDocument } from '../parsing/types.js';
import type { MonographRules } from '../rules/monograph-rules.js';
import { extractCriticalPoints } from '../tasks/critical-points.js';
import { extractMedications } from '../tasks/entities.js';
import { generateSummary } from '../tasks/summary.js';
import {
  retrievalQuery,
  verifyMedication,
  type ChunkLike,
} from '../verification/verify-medication.js';

import { ensureReferenceIndexed } from './reference-index.js';

export interface PipelineConfig {
  retrievalTopK: number;
  retrievalMinScore: number;
  sofficeBin?: string | undefined;
}

export interface PipelineDeps {
  pool: pg.Pool;
  llm: LlmProvider;
  embedder: EmbeddingProvider;
  config: PipelineConfig;
}

export interface JobContext {
  jobId: string;
  documentId: string;
  log: Logger;
  /** Persist + broadcast a progress event for the running stage. */
  progress(message: string, data?: Record<string, unknown>): Promise<void>;
}

export interface StageResult {
  detail: string;
  metadata?: Record<string, unknown>;
  /** Writes this stage's results; executed in the same transaction that marks the stage completed. */
  persist?: (client: PoolClient) => Promise<void>;
}

/** Error with a pipeline error code; message must be safe to show users (no document text/secrets). */
export class StageError extends Error {
  constructor(
    readonly code: PipelineErrorCode,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'StageError';
  }
}

/** Per-job in-memory state. Everything here can be rebuilt from the DB (stages are resumable). */
export class JobState {
  private parsedDoc: ParsedDocument | null = null;
  private docRow: Awaited<ReturnType<typeof documentsRepo.getDocumentForProcessing>> = null;

  constructor(
    private readonly deps: PipelineDeps,
    readonly ctx: JobContext,
  ) {}

  async document() {
    this.docRow ??= await documentsRepo.getDocumentForProcessing(
      this.deps.pool,
      this.ctx.documentId,
    );
    if (!this.docRow) throw new StageError('INTERNAL', 'Document no longer exists');
    return this.docRow;
  }

  get fixturePrefix(): Promise<string> {
    return this.document().then((d) => d.sha256.slice(0, 16));
  }

  /** PDF bytes to parse: the original PDF, or the DOCX converted to PDF (cached in preview_pdf). */
  async pdfBytes(): Promise<{ bytes: Buffer; converted: Buffer | null }> {
    const doc = await this.document();
    if (isPdf(doc.bytes)) return { bytes: doc.bytes, converted: null };
    if (!isDocx(doc.bytes))
      throw new StageError('UNSUPPORTED_DOCUMENT', 'File is neither a PDF nor a DOCX document');
    if (doc.preview_pdf) return { bytes: doc.preview_pdf, converted: null };
    try {
      const converted = await convertDocxToPdf(doc.bytes, { binary: this.deps.config.sofficeBin });
      return { bytes: converted, converted };
    } catch (err) {
      this.ctx.log.error(
        { event: 'docx.convert_failed', err: (err as Error).message },
        'DOCX conversion failed',
      );
      throw new StageError('CONVERSION_FAILED', 'Could not convert the DOCX document to PDF');
    }
  }

  async parsed(): Promise<ParsedDocument> {
    if (this.parsedDoc) return this.parsedDoc;
    const { bytes } = await this.pdfBytes();
    try {
      this.parsedDoc = await parsePdf(bytes);
    } catch (err) {
      throw new StageError(
        'PARSE_FAILED',
        `Could not parse the document: ${(err as Error).message}`.slice(0, 300),
      );
    }
    return this.parsedDoc;
  }

  setParsed(doc: ParsedDocument) {
    this.parsedDoc = doc;
  }
}

type StageFn = (deps: PipelineDeps, state: JobState) => Promise<StageResult>;

const parsed: StageFn = async (_deps, state) => {
  const { bytes, converted } = await state.pdfBytes();
  if (converted) await state.ctx.progress('Converted DOCX to PDF for parsing and preview');
  let doc: ParsedDocument;
  try {
    doc = await parsePdf(bytes);
  } catch (err) {
    throw new StageError(
      'PARSE_FAILED',
      `Could not parse the document: ${(err as Error).message}`.slice(0, 300),
    );
  }
  state.setParsed(doc);
  const tables = doc.blocks.filter((b) => b.kind === 'table');
  const rows = tables.reduce((n, t) => n + (t.table?.rows.length ?? 0), 0);
  const detail = `${doc.pageCount} page(s), ${doc.blocks.length} blocks, ${tables.length} table(s) with ${rows} row(s)`;
  return {
    detail,
    metadata: {
      pageCount: doc.pageCount,
      blocks: doc.blocks.length,
      tables: tables.length,
      tableRows: rows,
      convertedFromDocx: Boolean(converted),
    },
    persist: (c) =>
      documentsRepo.setDocumentParseInfo(c, state.ctx.documentId, doc.pageCount, converted),
  };
};

const chunked: StageFn = async (deps, state) => {
  const doc = await state.parsed();
  const chunks = chunkPrimary(doc);
  const refId = (await state.document()).reference_document_id;
  const idx = await ensureReferenceIndexed(deps.pool, deps.embedder, refId, state.ctx.log);
  const refNote = idx.reused
    ? `reference index reused (${idx.monographCount} monographs, ${idx.chunkCount} chunks)`
    : `reference indexed now (${idx.monographCount} monographs, ${idx.chunkCount} chunks)`;
  await state.ctx.progress(refNote, { referenceReused: idx.reused });
  return {
    detail: `${chunks.length} primary chunks; ${refNote}`,
    metadata: { primaryChunks: chunks.length, reference: idx },
    persist: (c) =>
      resultsRepo.replaceDocumentChunks(
        c,
        state.ctx.jobId,
        state.ctx.documentId,
        chunks.map((ch) => ({
          ordinal: ch.ordinal,
          kind: ch.kind,
          pageStart: ch.pageStart,
          pageEnd: ch.pageEnd,
          sectionTitle: ch.sectionTitle,
          text: ch.text,
          data: ch.data ?? null,
        })),
      ),
  };
};

const embedded: StageFn = async (deps, state) => {
  const chunks = await resultsRepo.getDocumentChunks(deps.pool, state.ctx.jobId);
  const embeddable = chunks.filter((c) => c.kind !== 'heading');
  let vectors: number[][];
  try {
    vectors = await deps.embedder.embedDocuments(
      embeddable.map((c) => (c.section_title ? `${c.section_title} — ${c.text}` : c.text)),
    );
  } catch (err) {
    state.ctx.log.error(
      { event: 'embedding.failed', err: (err as Error).message },
      'embedding failed',
    );
    throw new StageError(
      'EMBEDDING_FAILED',
      'Embedding model failed to embed document chunks',
      true,
    );
  }
  const ref = await referencesRepo.getReferenceForIndexing(
    deps.pool,
    (await state.document()).reference_document_id,
  );
  return {
    detail: `${vectors.length} primary chunks embedded with ${deps.embedder.model}; reference embeddings reused from index (${ref?.embedding_model ?? 'n/a'})`,
    metadata: {
      embedded: vectors.length,
      model: deps.embedder.model,
      dimensions: deps.embedder.dimensions,
    },
    persist: (c) =>
      resultsRepo.setDocumentChunkEmbeddings(
        c,
        embeddable.map((ch, i) => ({ id: ch.id, embedding: vectors[i]! })),
        deps.embedder.model,
      ),
  };
};

const summarized: StageFn = async (deps, state) => {
  const doc = await state.parsed();
  const { text, warnings } = await generateSummary(deps.llm, doc, await state.fixturePrefix);
  return {
    detail: `${text.split(/\s+/).length} words${warnings.length ? `, ${warnings.length} faithfulness warning(s)` : ''}`,
    metadata: { words: text.split(/\s+/).length, warnings: warnings.length },
    persist: (c) =>
      resultsRepo.saveSummary(
        c,
        state.ctx.jobId,
        text,
        warnings,
        `${deps.llm.name}:${deps.llm.model}`,
      ),
  };
};

const keyPoints: StageFn = async (deps, state) => {
  const doc = await state.parsed();
  const { points, dropped } = await extractCriticalPoints(deps.llm, doc, await state.fixturePrefix);
  return {
    detail: `${points.length} critical point(s)${dropped ? `; ${dropped} dropped for unverifiable quotes` : ''}`,
    metadata: { points: points.length, dropped },
    persist: (c) => resultsRepo.replaceCriticalPoints(c, state.ctx.jobId, points),
  };
};

const entities: StageFn = async (deps, state) => {
  const doc = await state.parsed();
  const { medications, notes } = await extractMedications(deps.llm, doc, await state.fixturePrefix);
  for (const n of notes) await state.ctx.progress(n);
  return {
    detail: `${medications.length} medication(s) extracted${notes.length ? `; ${notes.length} reconciliation note(s)` : ''}`,
    metadata: { medications: medications.length, notes },
    persist: (c) => resultsRepo.replaceMedications(c, state.ctx.jobId, medications),
  };
};

const verified: StageFn = async (deps, state) => {
  const { pool, embedder, config } = deps;
  const doc = await state.document();
  const refId = doc.reference_document_id;
  const ref = await referencesRepo.getReferenceForIndexing(pool, refId);
  if (ref?.index_status !== 'ready') {
    throw new StageError(
      'REFERENCE_INDEX_FAILED',
      'Reference index is not available; verification cannot run',
    );
  }
  const monographs = (await referencesRepo.listMonographs(pool, refId)).map((m) => ({
    id: m.id,
    name: m.name,
    nameNormalized: m.name_normalized,
    aliases: m.aliases,
    rules: m.rules as MonographRules | null,
    pageStart: m.page_start,
  }));
  const cov = await referencesRepo.getCoverageChunk(pool, refId);
  const toChunk = (r: referencesRepo.ReferenceChunkRow): ChunkLike => ({
    id: r.id,
    monographId: r.monograph_id,
    fieldLabel: r.field_label,
    page: r.page_start,
    text: r.text,
  });
  const meds = await resultsRepo.getMedications(pool, state.ctx.jobId);
  const prefix = await state.fixturePrefix;
  const results: resultsRepo.VerificationInput[] = [];
  const counts: Record<string, number> = {};
  for (const med of meds) {
    const out = await verifyMedication(
      med,
      monographs,
      {
        llm: deps.llm,
        coverageChunk: cov ? toChunk(cov) : null,
        minScore: config.retrievalMinScore,
        referenceTitle: `${ref.title} (rev. ${ref.version_label})`,
        monographChunks: async (id) =>
          (await referencesRepo.getChunksForMonograph(pool, id)).map(toChunk),
        retrieve: async (id, query) => {
          const qv = await embedder.embedQuery(query);
          const rows = await referencesRepo.searchMonographChunks(
            pool,
            id,
            qv,
            query,
            config.retrievalTopK,
          );
          return rows.map((r) => ({
            ...toChunk(r),
            score: 0.7 * r.vector_score + 0.3 * Math.min(r.text_score * 10, 1),
          }));
        },
        primaryContext: async (m) => {
          const qv = await embedder.embedQuery(retrievalQuery(m));
          const rows = await resultsRepo.searchDocumentChunksByName(
            pool,
            state.ctx.jobId,
            m.drugName,
            qv,
            3,
          );
          return rows.map((r) => `[page ${r.page_start}] ${r.text}`);
        },
      },
      `${prefix}/verify--${med.drugNameNormalized}`,
    );
    counts[out.status] = (counts[out.status] ?? 0) + 1;
    state.ctx.log.info(
      {
        event: 'verification.result',
        medication: med.drugName,
        status: out.status,
        // identity gate
        identity_match: out.identity.match,
        monograph: out.identity.monographName,
        similar_not_matched: out.similarNames,
        // retrieval (ids/fields/scores only — never passage text)
        retrieved: out.retrieval.chunks.length,
        dropped_below_threshold: out.retrieval.droppedBelowThreshold,
        top_passages: out.retrieval.chunks
          .slice(0, 3)
          .map((c) => ({ chunk_id: c.id, field: c.field, score: c.score })),
        // verification
        conflicts: out.findings.filter((f) => f.verdict === 'conflict').map((f) => f.field),
        decided_by: out.findings.reduce<Record<string, number>>((acc, f) => {
          acc[f.decidedBy] = (acc[f.decidedBy] ?? 0) + 1;
          return acc;
        }, {}),
        invalid_quotes: out.findings.filter((f) => f.quote && !f.quoteValid).length,
      },
      'medication verified',
    );
    await state.ctx.progress(`${med.drugName}: ${out.status}`, {
      medication: med.drugName,
      status: out.status,
    });
    results.push({ medicationId: med.id, ...out });
  }
  return {
    detail:
      Object.entries(counts)
        .map(([k, v]) => `${v} ${k}`)
        .join(', ') || 'no medications to verify',
    metadata: { counts },
    persist: (c) => resultsRepo.replaceVerifications(c, state.ctx.jobId, results),
  };
};

const done: StageFn = () => Promise.resolve({ detail: 'Pipeline complete' });

export const STAGE_IMPLEMENTATIONS: Record<StageName, StageFn> = {
  parsed,
  chunked,
  embedded,
  summarized,
  key_points_extracted: keyPoints,
  entities_extracted: entities,
  verified,
  done,
};
