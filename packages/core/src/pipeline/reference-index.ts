import { referencesRepo, withTransaction, type pg } from '@mediverify/db';
import type { Logger } from 'pino';

import { chunkReference } from '../chunking/reference.js';
import type { EmbeddingProvider } from '../llm/types.js';
import { parsePdf } from '../parsing/index.js';

export interface IndexOutcome {
  reused: boolean;
  chunkCount: number;
  monographCount: number;
  embeddingModel: string;
  durationMs: number;
}

/**
 * Idempotent, concurrency-safe reference indexing. If the reference is already indexed with the
 * current embedding model it is reused (no recomputation). Otherwise parse → monograph chunking →
 * embed → replace index, all under a per-reference advisory lock inside one transaction, so a
 * crash never leaves a half-written index and two workers never index the same reference twice.
 * (Local CPU embedding only — no remote model call is made while the transaction is open.)
 */
export async function ensureReferenceIndexed(
  pool: pg.Pool,
  embedder: EmbeddingProvider,
  referenceId: string,
  logger: Logger,
): Promise<IndexOutcome> {
  const started = Date.now();
  const ready = async (q: pg.Pool | pg.PoolClient) => {
    const ref = await referencesRepo.getReferenceForIndexing(q, referenceId);
    if (!ref) throw new Error(`Reference ${referenceId} not found`);
    return ref.index_status === 'ready' && ref.embedding_model === embedder.model;
  };
  const counts = async (q: pg.Pool | pg.PoolClient) => ({
    chunkCount: await referencesRepo.countReferenceChunks(q, referenceId),
    monographCount: (await referencesRepo.listMonographs(q, referenceId)).length,
  });

  if (await ready(pool)) {
    return {
      reused: true,
      ...(await counts(pool)),
      embeddingModel: embedder.model,
      durationMs: Date.now() - started,
    };
  }
  try {
    return await withTransaction(pool, async (client) => {
      await referencesRepo.lockReferenceIndex(client, referenceId);
      if (await ready(client)) {
        return {
          reused: true,
          ...(await counts(client)),
          embeddingModel: embedder.model,
          durationMs: Date.now() - started,
        };
      }
      const ref = (await referencesRepo.getReferenceForIndexing(client, referenceId))!;
      const parsed = await parsePdf(ref.bytes);
      const { monographs, chunks } = chunkReference(parsed);
      if (monographs.length === 0) throw new Error('No monographs found in reference document');
      const embeddings = await embedder.embedDocuments(chunks.map((c) => c.embedText));
      await referencesRepo.replaceReferenceIndex(
        client,
        referenceId,
        parsed.pageCount,
        monographs.map((m) => ({
          key: m.key,
          name: m.name,
          nameNormalized: m.nameNormalized,
          aliases: m.aliases,
          sectionTitle: m.sectionTitle,
          pageStart: m.pageStart,
          pageEnd: m.pageEnd,
          ordinal: m.ordinal,
          rules: m.rules,
        })),
        chunks.map((c, i) => ({
          monographKey: c.monographKey,
          kind: c.kind,
          ordinal: c.ordinal,
          medicationNameNormalized: c.medicationNameNormalized,
          sectionTitle: c.sectionTitle,
          fieldLabel: c.fieldLabel,
          pageStart: c.pageStart,
          pageEnd: c.pageEnd,
          text: c.text,
          contentHash: c.contentHash,
          embedding: embeddings[i]!,
        })),
        embedder.model,
      );
      const outcome = {
        reused: false,
        chunkCount: chunks.length,
        monographCount: monographs.length,
        embeddingModel: embedder.model,
        durationMs: Date.now() - started,
      };
      logger.info(
        { event: 'reference.indexed', reference_id: referenceId, ...outcome },
        'reference indexed',
      );
      return outcome;
    });
  } catch (err) {
    await referencesRepo
      .setReferenceIndexStatus(pool, referenceId, 'failed', (err as Error).message.slice(0, 500))
      .catch(() => undefined);
    throw err;
  }
}
