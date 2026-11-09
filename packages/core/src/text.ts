import { createHash } from 'node:crypto';

export function sha256Hex(data: string | Buffer | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

/** Collapse whitespace and normalize typographic punctuation (used for quote matching). */
export function normalizeForMatch(s: string): string {
  return s
    .normalize('NFKC')
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/[•▪◦●]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

const ELLIPSIS = /\s*(?:\.\.\.|…)\s*/;

/**
 * True when `quote` appears verbatim (modulo whitespace/punctuation/case normalization) in `source`.
 * Quotes containing an ellipsis are accepted only if every fragment (≥ 12 chars) appears in order.
 */
export function quoteAppearsIn(quote: string | null | undefined, source: string): boolean {
  if (!quote) return false;
  const hay = normalizeForMatch(source);
  const parts = quote
    .split(ELLIPSIS)
    .map((p) => normalizeForMatch(p).replace(/^["']|["']$/g, ''))
    .filter((p) => p.length > 0);
  if (parts.length === 0) return false;
  if (parts.length > 1 && parts.some((p) => p.length < 12)) return false;
  if (parts.length === 1 && parts[0]!.length < 4) return false;
  let from = 0;
  for (const p of parts) {
    const idx = hay.indexOf(p, from);
    if (idx < 0) return false;
    from = idx + p.length;
  }
  return true;
}

/** Identity key for drug names: case/space/punctuation-insensitive, hyphen-preserving. */
export function normalizeDrugName(name: string): string {
  return name
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[‐-―]/g, '-')
    .replace(/[®™]/g, '')
    .replace(/\s*-\s*/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/[^a-z0-9\- ]/g, '')
    .trim()
    .replace(/ (xr|er|sr|la|cr|xl)$/, '-$1'); // 'Cordizem XR' → 'cordizem-xr'
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]!;
      prev[j] = Math.min(prev[j]! + 1, prev[j - 1]! + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length]!;
}

const NUMBER_WORDS: Record<string, string> = {
  one: '1',
  two: '2',
  three: '3',
  four: '4',
  five: '5',
  six: '6',
  seven: '7',
  eight: '8',
  nine: '9',
  ten: '10',
  eleven: '11',
  twelve: '12',
  thirty: '30',
  fourteen: '14',
};

export function wordsToDigits(s: string): string {
  return s.replace(/\b[a-z]+\b/gi, (w) => NUMBER_WORDS[w.toLowerCase()] ?? w);
}

/** Split into sentences, keeping the text verbatim (used to pick quote-sized evidence). */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z0-9•])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}
