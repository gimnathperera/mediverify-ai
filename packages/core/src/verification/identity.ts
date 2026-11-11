import { drugIdentityKey, levenshtein, normalizeDrugName } from '../text.js';

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
  // Try the name as written, then without strength/form ("Pravoxil 20 mg tablet" → "pravoxil").
  for (const key of new Set([normalizeDrugName(drugName), drugIdentityKey(drugName)])) {
    if (!key) continue;
    const hit = monographs.find((m) => m.nameNormalized === key || m.aliases.includes(key));
    if (hit) return hit;
  }
  return null;
}

/** How a matched monograph was identified (for logs and audit). */
export function identityMatchType(
  drugName: string,
  monograph: MonographIdentity,
): 'exact' | 'alias' {
  const keys = [normalizeDrugName(drugName), drugIdentityKey(drugName)];
  return keys.includes(monograph.nameNormalized) ? 'exact' : 'alias';
}

/** Similar-looking names surfaced for transparency ("not matched"), never used for verification. */
export function similarMonographNames(drugName: string, monographs: MonographIdentity[]): string[] {
  const key = drugIdentityKey(drugName);
  return monographs
    .filter((m) => {
      const d = levenshtein(key, m.nameNormalized);
      return d > 0 && d / Math.max(key.length, m.nameNormalized.length) <= 0.45;
    })
    .map((m) => m.name);
}
