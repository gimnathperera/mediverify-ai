import { describe, expect, it } from 'vitest';

import { highlightRanges } from '../src/lib/highlight';

// pdf.js text items for part of the sample's medication table (one run per cell).
const ITEMS = [
  'Velantine',
  '10 mg',
  'PO once daily',
  'Continue indefinitely',
  'Cordizem-XR',
  '100 mg',
  'PO once daily',
  'Continue indefinitely',
];
const marked = (items: string[], quotes: string[]) =>
  [...highlightRanges(items, quotes)].map(([i, rs]) => rs.map(([a, b]) => items[i]!.slice(a, b)));

describe('highlightRanges', () => {
  it('marks only the cited row, not every run with the same words', () => {
    expect(marked(ITEMS, ['Cordizem-XR 100 mg PO once daily'])).toEqual([
      ['Cordizem-XR'],
      ['100 mg'],
      ['PO once daily'],
    ]);
    // The same "PO once daily" in Velantine's row (item 2) is not marked.
    expect(highlightRanges(ITEMS, ['Cordizem-XR 100 mg PO once daily']).has(2)).toBe(false);
  });

  it('marks partial runs exactly at the quote boundaries', () => {
    const items = ['Standard adult dose: 20 mg orally once daily, at bedtime. Max 80 mg daily.'];
    expect(marked(items, ['20 mg orally once daily, at bedtime'])).toEqual([
      ['20 mg orally once daily, at bedtime'],
    ]);
  });

  it('matches across typographic quotes, case and spacing, and finds a quote cut by a page break', () => {
    const items = ['Pravoxil’s   pharmacokinetics', 'favor evening administration.'];
    expect(marked(items, ["PRAVOXIL'S pharmacokinetics favor evening"])).toEqual([
      ['Pravoxil’s   pharmacokinetics'],
      ['favor evening'],
    ]);
    // Only the first half of this quote is on this page.
    expect(
      highlightRanges(items, [
        'pharmacokinetics favor evening administration and dosing at bedtime',
      ]).size,
    ).toBeGreaterThan(0);
  });

  it('marks nothing when the quote is absent', () => {
    expect(highlightRanges(ITEMS, ['Quintaxin 20 mg before breakfast']).size).toBe(0);
  });
});
