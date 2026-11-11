import { referencesRepo, type pg } from '@mediverify/db';

import type { EmbeddingProvider, LlmProvider } from '../llm/types.js';
import type { MonographRules } from '../rules/monograph-rules.js';
import { retrieveEvidence } from '../verification/retrieval.js';
import type {
  ChunkLike,
  MonographForVerify,
  VerifyDeps,
} from '../verification/verify-medication.js';

import type { PipelineConfig } from './stages.js';

const toChunk = (r: referencesRepo.ReferenceChunkRow): ChunkLike => ({
  id: r.id,
  monographId: r.monograph_id,
  fieldLabel: r.field_label,
  page: r.page_start,
  text: r.text,
});

/**
 * Everything verification needs from one indexed reference: its monographs (with parsed rules),
 * the coverage note, and the retrieval wiring. Shared by the `verified` stage and the evaluation
 * script, so both verify through exactly the same code. Null when the reference isn't indexed.
 */
export async function loadVerifyContext(
  pool: pg.Pool,
  embedder: EmbeddingProvider,
  config: Pick<PipelineConfig, 'retrievalTopK' | 'retrievalMinScore'>,
  referenceId: string,
) {
  const ref = await referencesRepo.getReferenceForIndexing(pool, referenceId);
  if (ref?.index_status !== 'ready') return null;
  const monographs: MonographForVerify[] = (
    await referencesRepo.listMonographs(pool, referenceId)
  ).map((m) => ({
    id: m.id,
    name: m.name,
    nameNormalized: m.name_normalized,
    aliases: m.aliases,
    rules: m.rules as MonographRules | null,
    pageStart: m.page_start,
  }));
  const cov = await referencesRepo.getCoverageChunk(pool, referenceId);
  /** Verification deps for one document (the parts that depend on it are passed in). */
  const deps = (
    llm: LlmProvider,
    doc: Pick<VerifyDeps, 'primaryContext' | 'primaryText'>,
  ): VerifyDeps => ({
    llm,
    ...doc,
    coverageChunk: cov ? toChunk(cov) : null,
    minScore: config.retrievalMinScore,
    referenceTitle: `${ref.title} (rev. ${ref.version_label})`,
    monographChunks: async (id) =>
      (await referencesRepo.getChunksForMonograph(pool, id)).map(toChunk),
    retrieve: (id, m) =>
      retrieveEvidence({
        med: m,
        topK: config.retrievalTopK,
        embed: (text) => embedder.embedQuery(text),
        rank: async (embedding, text) =>
          (await referencesRepo.rankMonographFieldChunks(pool, id, embedding, text)).map((r) => ({
            ...toChunk(r),
            vectorScore: r.vector_score,
            textScore: r.text_score,
          })),
      }),
  });
  return { ref, monographs, deps };
}
