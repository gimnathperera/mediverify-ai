import { levenshtein, normalizeDrugName } from '../text.js';

export interface MonographIdentity {
  id: string;
  name: string;
  nameNormalized: string;
  aliases: string[];
}

/**
 * Identity gate: exact normalized name or explicit alias ONLY. Similarity (edit distance, embeddings)
 * never establishes identity — "Pranixol" must not match "Pravoxil" (edit distance 3, cosine ≈ 0.81).
 */
export function matchMonograph<T extends MonographIdentity>(
  drugName: string,
  monographs: T[],
): T | null {
  const key = normalizeDrugName(drugName);
  if (!key) return null;
  return monographs.find((m) => m.nameNormalized === key || m.aliases.includes(key)) ?? null;
}

/** Similar-looking names surfaced for transparency ("not matched"), never used for verification. */
export function similarMonographNames(drugName: string, monographs: MonographIdentity[]): string[] {
  const key = normalizeDrugName(drugName);
  return monographs
    .filter((m) => {
      const d = levenshtein(key, m.nameNormalized);
      return d > 0 && d / Math.max(key.length, m.nameNormalized.length) <= 0.45;
    })
    .map((m) => m.name);
}
