import type { CriticalCategory } from '@mediverify/shared';

import { renderForPrompt } from '../chunking/primary.js';
import { CRITICAL_POINTS_SYSTEM, criticalPointsUser } from '../llm/prompts.js';
import { criticalPointsOutput } from '../llm/schemas.js';
import type { LlmProvider } from '../llm/types.js';
import type { ParsedDocument } from '../parsing/types.js';
import { quoteAppearsIn } from '../text.js';

/** Lower = more critical. Ranking = severity first, then this category order (see README). */
export const CATEGORY_WEIGHT: Record<CriticalCategory, number> = {
  serious_side_effect: 0,
  document_discrepancy: 1,
  administration_timing: 2,
  duration_limit: 3,
  safety_precaution: 4,
  follow_up: 5,
  other: 6,
};
const SEVERITY_WEIGHT = { high: 0, medium: 1, low: 2 } as const;

export interface ValidatedCriticalPoint {
  rank: number;
  category: CriticalCategory;
  severity: 'high' | 'medium' | 'low';
  text: string;
  relatedMedication: string | null;
  sources: { page: number | null; quote: string; quoteValid: boolean }[];
}

/** Locate a quote: keep the stated page if it validates there, otherwise search all pages. */
export function locateQuote(doc: ParsedDocument, quote: string, page: number | null) {
  const stated = page ? doc.pages[page - 1] : undefined;
  if (stated && quoteAppearsIn(quote, stated.text)) return { page: stated.page, valid: true };
  for (const p of doc.pages)
    if (quoteAppearsIn(quote, p.text)) return { page: p.page, valid: true };
  return { page, valid: false };
}

export async function extractCriticalPoints(
  llm: LlmProvider,
  doc: ParsedDocument,
  fixturePrefix: string,
): Promise<{ points: ValidatedCriticalPoint[]; dropped: number }> {
  const out = await llm.generate({
    task: 'critical_points',
    schemaName: 'critical_points',
    schema: criticalPointsOutput,
    system: CRITICAL_POINTS_SYSTEM,
    user: criticalPointsUser(renderForPrompt(doc)),
    fixtureKey: `${fixturePrefix}/critical_points`,
    maxOutputTokens: 4000,
  });
  let dropped = 0;
  const kept: Omit<ValidatedCriticalPoint, 'rank'>[] = [];
  for (const p of out.points) {
    const sources = p.sources.map((s) => {
      const loc = locateQuote(doc, s.quote, s.page);
      return { page: loc.page, quote: s.quote, quoteValid: loc.valid };
    });
    // Hallucination control: a point needs at least one verifiable quote from the primary document.
    // Discrepancies need ≥2 valid quotes (both sides of the inconsistency).
    const valid = sources.filter((s) => s.quoteValid);
    const enough = p.category === 'document_discrepancy' ? valid.length >= 2 : valid.length >= 1;
    if (!enough) {
      dropped++;
      continue;
    }
    kept.push({
      category: p.category,
      severity: p.severity,
      text: p.text.trim(),
      relatedMedication: p.related_medication,
      sources: valid,
    });
  }
  const ranked = kept
    .map((p, i) => ({ p, i }))
    .sort(
      (a, b) =>
        SEVERITY_WEIGHT[a.p.severity] - SEVERITY_WEIGHT[b.p.severity] ||
        CATEGORY_WEIGHT[a.p.category] - CATEGORY_WEIGHT[b.p.category] ||
        a.i - b.i,
    )
    .map(({ p }, idx) => ({ ...p, rank: idx + 1 }));
  return { points: ranked, dropped };
}
