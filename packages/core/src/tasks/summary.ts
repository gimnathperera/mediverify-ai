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
  warnings.push(...attributionWarnings(summary, source), ...negationWarnings(summary, source));
  return warnings;
}

const sentencesOf = (text: string) =>
  text
    .split(/\n|(?<=[.;!?])\s+/)
    .map((x) => normalizeForMatch(wordsToDigits(x)))
    .filter(Boolean);

const DOSE_IN_TEXT = /(\d+(?:\.\d+)?)\s*(mg|mcg|g|ml|units?)\b/gi;
const DRUG_LIKE = /\b[A-Z][a-z]+(?:-[A-Z]{1,3})?\b/g;

/**
 * A dose stated next to a drug name must be attributed to that drug in the source: both have to
 * occur in one source sentence or table row ("Velantine 20 mg" when the source pairs 20 mg with
 * another drug is flagged even though "20 mg" appears somewhere).
 */
function attributionWarnings(summary: string, source: string): string[] {
  const src = sentencesOf(source);
  const out: string[] = [];
  for (const raw of summary.split(/(?<=[.;!?])\s+/)) {
    const doses = [...raw.matchAll(DOSE_IN_TEXT)].map((m) => normalizeForMatch(`${m[1]} ${m[2]}`));
    if (doses.length === 0) continue;
    const drugs = [...new Set(raw.match(DRUG_LIKE) ?? [])]
      .map((d) => d.toLowerCase())
      .filter((d) => src.some((line) => line.includes(d)));
    // Attribute each dose to the drug written just before it in the sentence.
    for (const m of raw.matchAll(DOSE_IN_TEXT)) {
      const before = raw.slice(0, m.index).match(DRUG_LIKE)?.pop()?.toLowerCase();
      if (!before || !drugs.includes(before)) continue;
      const dose = normalizeForMatch(`${m[1]} ${m[2]}`);
      if (!src.some((line) => line.includes(before) && line.includes(dose)))
        out.push(`"${m[0]}" is not attributed to ${before} anywhere in the source document`);
    }
  }
  return out;
}

const NEGATION = /\b(no|not|never|denies|denied|without|ruled out|negative for)\b/;
const CONTENT_STOP = new Set(
  'patient patients which there their these those about after before during other should would could daily'.split(
    ' ',
  ),
);
const contentWords = (x: string) =>
  new Set(x.split(/[^a-z0-9-]+/).filter((w) => w.length >= 5 && !CONTENT_STOP.has(w)));

/**
 * Polarity check: a summary sentence that negates what every closely matching source sentence
 * affirms (or affirms what they all negate) is flagged. Conservative: needs ≥3 shared content words.
 */
function negationWarnings(summary: string, source: string): string[] {
  const src = sentencesOf(source).map((line) => ({ line, words: contentWords(line) }));
  const out: string[] = [];
  for (const sentence of sentencesOf(summary)) {
    const words = contentWords(sentence);
    const matches = src.filter((s) => [...words].filter((w) => s.words.has(w)).length >= 3);
    if (matches.length === 0) continue;
    const negated = NEGATION.test(sentence);
    if (matches.every((m) => NEGATION.test(m.line) !== negated))
      out.push(
        `Possible ${negated ? 'added' : 'dropped'} negation compared with the source: "${sentence.slice(0, 80)}${sentence.length > 80 ? '…' : ''}"`,
      );
  }
  return out;
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
