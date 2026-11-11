/**
 * Evidence retrieval inside the matched monograph (identity is already established).
 *
 * One query per prescribing aspect (dose, schedule, duration, indication/contraindications), each
 * ranked twice — by embedding similarity and by full-text rank — and the rankings fused with
 * Reciprocal Rank Fusion (score = Σ 1/(k + rank)). RRF needs no score calibration between the two
 * signals, which is why it replaced the earlier 0.7·cosine + 0.3·text weighting whose text half
 * saturated (see docs/evaluation.md for the measured comparison).
 */
import type { MedicationForCheck } from './deterministic.js';
import type { ChunkLike, RetrievedChunk } from './verify-medication.js';

export interface FieldQuery {
  aspect: 'dose' | 'schedule' | 'duration' | 'indication';
  text: string;
}

export interface ScoredChunk extends ChunkLike {
  vectorScore: number;
  textScore: number;
}

export const RRF_K = 60;

export function fieldQueries(med: MedicationForCheck): FieldQuery[] {
  const q = (aspect: FieldQuery['aspect'], ...parts: (string | null)[]): FieldQuery => ({
    aspect,
    text: [med.drugName, ...parts].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim(),
  });
  return [
    q('dose', 'standard adult dose maximum dose titration', med.doseRaw),
    q('schedule', 'frequency administration timing', med.frequencyRaw, med.timing),
    q('duration', 'duration of treatment limit reassessment', med.durationRaw),
    q('indication', 'indication contraindications', med.indication),
  ];
}

/** Reciprocal Rank Fusion over ranked id lists (rank 1 = best). */
export function rrfFuse(rankings: string[][], k = RRF_K): Map<string, number> {
  const scores = new Map<string, number>();
  for (const ranking of rankings)
    ranking.forEach((id, i) => scores.set(id, (scores.get(id) ?? 0) + 1 / (k + i + 1)));
  return scores;
}

/**
 * Rank a monograph's field chunks for a medication. `rank` returns every field chunk with its
 * vector and text score for one query (DB); `embed` embeds a query. Contraindications are always
 * included when present so restrictions can be checked even if they rank low.
 */
export async function retrieveEvidence(opts: {
  med: MedicationForCheck;
  embed: (text: string) => Promise<number[]>;
  rank: (embedding: number[], text: string) => Promise<ScoredChunk[]>;
  topK: number;
}): Promise<{ chunks: RetrievedChunk[]; queries: FieldQuery[] }> {
  const queries = fieldQueries(opts.med);
  const rankings: string[][] = [];
  const byId = new Map<string, ScoredChunk>();
  for (const query of queries) {
    const rows = await opts.rank(await opts.embed(query.text), query.text);
    for (const r of rows) {
      const prev = byId.get(r.id);
      // Keep each chunk's best similarity across queries (used for the relevance gate).
      if (!prev || r.vectorScore > prev.vectorScore) byId.set(r.id, r);
    }
    rankings.push([...rows].sort((a, b) => b.vectorScore - a.vectorScore).map((r) => r.id));
    rankings.push(
      rows
        .filter((r) => r.textScore > 0)
        .sort((a, b) => b.textScore - a.textScore)
        .map((r) => r.id),
    );
  }
  const fused = rrfFuse(rankings);
  const ranked = [...byId.values()]
    .map((c) => ({ ...c, score: fused.get(c.id) ?? 0 }))
    .sort((a, b) => b.score - a.score);
  const top = ranked.slice(0, opts.topK);
  const contra = ranked.find((c) => /contraindication/i.test(c.fieldLabel ?? ''));
  if (contra && !top.includes(contra)) top.push(contra);
  return {
    chunks: top.map(({ textScore: _t, ...c }) => c),
    queries,
  };
}
