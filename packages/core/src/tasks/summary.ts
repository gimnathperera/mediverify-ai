import { renderForPrompt } from '../chunking/primary.js';
import { SUMMARY_SYSTEM, summaryUser } from '../llm/prompts.js';
import { summaryOutput } from '../llm/schemas.js';
import type { LlmProvider } from '../llm/types.js';
import type { ParsedDocument } from '../parsing/types.js';
import { normalizeForMatch, wordsToDigits } from '../text.js';

/**
 * Faithfulness guard (deterministic, cheap): every number in the summary must occur in the source,
 * and capitalised mid-sentence terms (names, drugs) must occur in the source. Violations are
 * returned as warnings (shown in the UI) after one regeneration attempt.
 */
export function summaryWarnings(summary: string, source: string): string[] {
  const src = normalizeForMatch(wordsToDigits(source));
  const warnings: string[] = [];
  const numbers = new Set(wordsToDigits(summary).match(/\d+(?:\.\d+)?/g) ?? []);
  for (const n of numbers) {
    if (!new RegExp(`(^|[^\\d.])${n.replace('.', '\\.')}([^\\d]|$)`).test(src))
      warnings.push(`Number "${n}" does not appear in the source document`);
  }
  const terms = summary.match(/(?<=[a-z,;]\s)[A-Z][A-Za-z]+(?:-[A-Z]{1,3})?/g) ?? [];
  for (const t of new Set(terms)) {
    if (!src.includes(t.toLowerCase()))
      warnings.push(`Term "${t}" does not appear in the source document`);
  }
  return warnings;
}

export async function generateSummary(
  llm: LlmProvider,
  doc: ParsedDocument,
  fixturePrefix: string,
): Promise<{ text: string; warnings: string[] }> {
  const rendered = renderForPrompt(doc);
  const source = doc.pages.map((p) => p.text).join('\n');
  let user = summaryUser(rendered);
  let last: { text: string; warnings: string[] } | null = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const out = await llm.generate({
      task: 'summary',
      schemaName: 'discharge_summary',
      schema: summaryOutput,
      system: SUMMARY_SYSTEM,
      user,
      fixtureKey: `${fixturePrefix}/summary`,
      maxOutputTokens: 2000,
    });
    const text = out.summary.trim();
    last = { text, warnings: summaryWarnings(text, source) };
    if (last.warnings.length === 0 || llm.name === 'fixture') break;
    user = `${summaryUser(rendered)}\n\nYour previous draft contained content not found in the document (${last.warnings.join('; ')}). Rewrite using only document content.`;
  }
  return last!;
}
