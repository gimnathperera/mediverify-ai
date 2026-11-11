/**
 * Locate citation quotes in a PDF page's text items, for exact highlighting.
 *
 * pdf.js splits a page into many text items (runs). A quote can span several runs and its words
 * also occur elsewhere on the page ("PO once daily" is in every table row), so matching run by run
 * marks the wrong text. Instead the runs are joined, normalised the same way the server validates
 * quotes, searched once per quote, and the match is mapped back to character ranges per run.
 */

/** Per-character normalisation matching `normalizeText` (lib/utils.ts) and the server's matcher. */
function normChar(c: string): string {
  return c
    .normalize('NFKC')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/[•|]/g, ' ')
    .toLowerCase();
}

/** Normalised text plus, for each normalised character, the index of its source character. */
function normalizeWithMap(raw: string): { text: string; map: number[] } {
  let text = '';
  const map: number[] = [];
  for (let i = 0; i < raw.length; i++) {
    for (const ch of normChar(raw[i]!)) {
      if (/\s/.test(ch)) {
        if (text === '' || text.endsWith(' ')) continue; // collapse whitespace
        text += ' ';
      } else text += ch;
      map.push(i);
    }
  }
  if (text.endsWith(' ')) {
    text = text.slice(0, -1);
    map.pop();
  }
  return { text, map };
}

const normalizeQuote = (q: string) => normalizeWithMap(q).text;

/**
 * Where to search for a quote: the whole quote, or — when it continues onto another page — its
 * longest leading/trailing word span (at least 4 words) present on this page.
 */
function findQuote(page: string, quote: string): [number, number] | null {
  const q = normalizeQuote(quote);
  if (q.length < 4) return null;
  const at = page.indexOf(q);
  if (at >= 0) return [at, at + q.length];
  const words = q.split(' ');
  for (let n = words.length - 1; n >= 4; n--) {
    for (const part of [words.slice(0, n).join(' '), words.slice(-n).join(' ')]) {
      const i = page.indexOf(part);
      if (i >= 0) return [i, i + part.length];
    }
  }
  return null;
}

/**
 * Character ranges to highlight in each text item (keyed by item index). Items are joined with a
 * single space, as pdf.js renders them as separate spans.
 */
export function highlightRanges(
  items: readonly string[],
  quotes: readonly string[],
): Map<number, [number, number][]> {
  const starts: number[] = [];
  let raw = '';
  for (const s of items) {
    starts.push(raw.length);
    raw += `${s} `;
  }
  const { text, map } = normalizeWithMap(raw);
  const out = new Map<number, [number, number][]>();
  for (const quote of quotes) {
    const hit = findQuote(text, quote);
    if (!hit) continue;
    const from = map[hit[0]]!;
    const to = map[hit[1] - 1]! + 1;
    items.forEach((s, i) => {
      const a = starts[i]!;
      const b = a + s.length;
      if (to <= a || from >= b) return;
      const ranges = out.get(i) ?? [];
      ranges.push([Math.max(from, a) - a, Math.min(to, b) - a]);
      out.set(i, ranges);
    });
  }
  return out;
}
