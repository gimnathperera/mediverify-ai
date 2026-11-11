import {
  CORE_VERIFIED_FIELDS,
  type FieldVerdict,
  type FindingReason,
  type VerificationStatus,
  type VerifiedField,
} from '@mediverify/shared';

import { VERIFY_SYSTEM, verifyUser } from '../llm/prompts.js';
import { verifyOutput, type VerifyOutput } from '../llm/schemas.js';
import type { LlmProvider } from '../llm/types.js';
import type { Evidence, MonographRules } from '../rules/monograph-rules.js';
import { normalizeForMatch, quoteAppearsIn, truncate } from '../text.js';

import { deterministicChecks, type DetFinding, type MedicationForCheck } from './deterministic.js';
import {
  identityMatchType,
  matchMonograph,
  similarMonographNames,
  type MonographIdentity,
} from './identity.js';

export interface ChunkLike {
  id: string;
  monographId: string | null;
  fieldLabel: string | null;
  page: number;
  text: string;
}

export interface RetrievedChunk extends ChunkLike {
  /** Fused rank score (RRF) used for ordering. */
  score: number;
  /** Best cosine similarity to any query: the relevance gate compares this with `minScore`. */
  vectorScore: number;
}

export interface MonographForVerify extends MonographIdentity {
  rules: MonographRules | null;
  pageStart: number;
}

export interface VerifyDeps {
  llm: LlmProvider;
  /** Ranked field passages *within the matched monograph* (identity already established). */
  retrieve(
    monographId: string,
    med: MedicationForCheck,
  ): Promise<{ chunks: RetrievedChunk[]; queries: { aspect: string; text: string }[] }>;
  monographChunks(monographId: string): Promise<ChunkLike[]>;
  primaryContext(med: MedicationForCheck): Promise<string[]>;
  coverageChunk: ChunkLike | null;
  minScore: number;
  referenceTitle: string;
  /** Full text of the primary document (to check that a restriction applies to this patient). */
  primaryText?: string;
}

export interface FindingOut {
  field: VerifiedField;
  verdict: FieldVerdict;
  prescribedValue: string | null;
  referenceConstraint: string | null;
  explanation: string;
  decidedBy: 'deterministic' | 'llm' | 'both';
  confidence: 'high' | 'medium' | 'low';
  chunkId: string | null;
  quote: string | null;
  quoteValid: boolean;
  /** Why the verdict is not decisive (see FINDING_REASONS); null for consistent/conflict. */
  reason: FindingReason | null;
}

export interface VerificationOut {
  status: VerificationStatus;
  monographId: string | null;
  /** Identity gate outcome: exact name, explicit alias, or no monograph (similarity never matches). */
  identity: { match: 'exact' | 'alias' | 'none'; monographName: string | null };
  summary: string;
  similarNames: string[];
  coverageChunkId: string | null;
  retrieval: {
    query: string | null;
    chunks: { id: string; score: number; vectorScore?: number; field: string | null }[];
    droppedBelowThreshold: number;
  };
  findings: FindingOut[];
}

const FIELD_ORDER: VerifiedField[] = [
  'identity',
  'dose',
  'unit',
  'route',
  'frequency',
  'timing',
  'duration',
  'indication',
];

/** Find a chunk (of the matched monograph) containing the quote; prefer the labeled field. */
export function citeEvidence(
  evidence: Evidence[],
  chunks: ChunkLike[],
): { chunkId: string | null; quote: string | null; valid: boolean } {
  if (evidence.length === 0) return { chunkId: null, quote: null, valid: false };
  const candidates: string[] = [];
  const sameField = evidence.every((e) => e.fieldLabel === evidence[0]!.fieldLabel);
  if (evidence.length > 1 && sameField) candidates.push(evidence.map((e) => e.quote).join(' '));
  candidates.push(...evidence.map((e) => e.quote));
  for (const quote of candidates) {
    const label = evidence.find((e) => quote.includes(e.quote))?.fieldLabel;
    const ordered = [...chunks].sort(
      (a, b) => Number(b.fieldLabel === label) - Number(a.fieldLabel === label),
    );
    const hit = ordered.find((c) => quoteAppearsIn(quote, c.text));
    if (hit) return { chunkId: hit.id, quote, valid: true };
  }
  return { chunkId: null, quote: evidence[0]!.quote, valid: false };
}

export function retrievalQuery(med: MedicationForCheck): string {
  return [
    med.drugName,
    'standard adult dose',
    med.doseRaw,
    med.frequencyRaw,
    'administration timing',
    'duration of treatment limit reassessment',
    med.durationRaw,
    'indication',
    med.indication,
  ]
    .filter(Boolean)
    .join(' ');
}

function pickCoverageSentence(text: string): string {
  const s = text.split(/(?<=\.)\s+/).find((x) => /do not infer|not addressed|not listed/i.test(x));
  return (s ?? text).trim();
}

/**
 * Verify one medication:
 * 1. identity gate (exact/alias) → otherwise UNSUPPORTED citing the coverage note;
 * 2. targeted hybrid retrieval inside the matched monograph (threshold → INCOMPLETE if nothing relevant);
 * 3. deterministic checks from parsed monograph rules;
 * 4. LLM verifier on retrieved passages only;
 * 5. merge under quote validation (evidence must exist in a chunk of the matched monograph).
 */
export async function verifyMedication(
  med: MedicationForCheck,
  monographs: MonographForVerify[],
  deps: VerifyDeps,
  fixtureKey: string,
): Promise<VerificationOut> {
  const monograph = matchMonograph(med.drugName, monographs);
  const similar = similarMonographNames(med.drugName, monographs);

  if (!monograph) {
    const cov = deps.coverageChunk;
    const covQuote = cov ? pickCoverageSentence(cov.text) : null;
    const similarNote = similar.length
      ? ` Similar-looking name(s) ${similar.join(', ')} were deliberately NOT treated as a match.`
      : '';
    return {
      status: 'unsupported',
      monographId: null,
      summary: `No monograph for ${med.drugName} exists in ${deps.referenceTitle}. This is a coverage gap — the prescription is neither confirmed nor shown to be wrong.${similarNote}`,
      identity: { match: 'none', monographName: null },
      similarNames: similar,
      coverageChunkId: cov?.id ?? null,
      retrieval: { query: null, chunks: [], droppedBelowThreshold: 0 },
      findings: [
        {
          field: 'identity',
          verdict: 'not_addressed',
          prescribedValue: med.drugName,
          referenceConstraint: null,
          explanation: cov
            ? `No supporting passage exists: the reference has no monograph for ${med.drugName}. Its coverage note says prescribing parameters for unlisted medications must not be inferred from other entries.`
            : `No supporting passage exists: the reference has no monograph for ${med.drugName}.`,
          decidedBy: 'deterministic',
          confidence: 'high',
          reason: 'not_constrained',
          chunkId: cov?.id ?? null,
          quote: covQuote,
          quoteValid: Boolean(cov && covQuote && quoteAppearsIn(covQuote, cov.text)),
        },
      ],
    };
  }

  const identity = {
    match: identityMatchType(med.drugName, monograph),
    monographName: monograph.name,
  } as const;
  const allChunks = await deps.monographChunks(monograph.id);
  const fieldChunks = allChunks.filter((c) => c.fieldLabel !== null);
  const { chunks: retrieved, queries } = await deps.retrieve(monograph.id, med);
  const relevant = retrieved.filter((c) => c.vectorScore >= deps.minScore);
  const retrieval = {
    query: queries.map((q) => `${q.aspect}: ${q.text}`).join(' | '),
    chunks: retrieved.map((c) => ({
      id: c.id,
      score: Number(c.score.toFixed(4)),
      vectorScore: Number(c.vectorScore.toFixed(4)),
      field: c.fieldLabel,
    })),
    droppedBelowThreshold: retrieved.length - relevant.length,
  };
  if (relevant.length === 0) {
    return {
      status: 'incomplete',
      monographId: monograph.id,
      identity,
      summary: `A ${monograph.name} monograph exists, but no passage was retrieved with sufficient relevance to verify the prescription. Left unclassified rather than guessed.`,
      similarNames: [],
      coverageChunkId: null,
      retrieval,
      findings: [],
    };
  }

  const det = monograph.rules ? deterministicChecks(med, monograph.rules) : [];

  // Passages for the LLM: retrieved + any field the deterministic evidence relies on (deduped).
  const evidenceLabels = new Set(det.flatMap((d) => d.evidence.map((e) => e.fieldLabel)));
  const passageChunks: RetrievedChunk[] = [...relevant];
  for (const c of fieldChunks) {
    if (evidenceLabels.has(c.fieldLabel ?? '') && !passageChunks.some((p) => p.id === c.id))
      passageChunks.push({ ...c, score: 0, vectorScore: 0 });
  }
  const passages = passageChunks.map((c, i) => ({ id: `P${i + 1}`, chunk: c }));

  const llmOut: VerifyOutput = await deps.llm.generate({
    task: 'verify',
    schemaName: 'medication_verification',
    schema: verifyOutput,
    system: VERIFY_SYSTEM,
    user: verifyUser({
      medication: {
        drug_name: med.drugName,
        dose: med.doseRaw,
        route: med.route,
        frequency: med.frequencyRaw,
        timing: med.timing,
        duration: med.durationRaw,
        indication: med.indication,
        new_start: med.isNewStart,
      },
      monographName: monograph.name,
      passages: passages.map((p) => ({
        id: p.id,
        label: p.chunk.fieldLabel ?? '',
        page: p.chunk.page,
        text: p.chunk.text,
      })),
      primaryContext: await deps.primaryContext(med),
    }),
    fixtureKey,
    maxOutputTokens: 3000,
  });

  const findings = mergeFindings(det, llmOut, passages, fieldChunks, {
    ...(deps.primaryText !== undefined ? { primaryText: deps.primaryText } : {}),
  });
  const { status, gaps } = classifyVerification(findings);
  const conflicts = findings.filter((f) => f.verdict === 'conflict');
  let summary: string;
  if (status === 'contradicted') {
    summary = `Conflicts with the ${monograph.name} monograph on ${conflicts.map((c) => c.field).join(', ')}. ${conflicts[0]!.explanation}`;
  } else if (status === 'supported') {
    const ok = findings.filter((f) => f.verdict === 'consistent').map((f) => f.field);
    const free = findings.filter((f) => f.reason === 'not_constrained').map((f) => f.field);
    summary = `Consistent with the ${monograph.name} monograph (${ok.join(', ')})${free.length ? `; the monograph sets no rule for ${free.join(', ')}` : ''}. ${truncate(llmOut.overall_explanation, 300)}`;
  } else {
    summary = `A ${monograph.name} monograph exists and no conflicts were found, but ${gaps
      .map((g) => `${g.field} (${GAP_LABEL[g.reason]})`)
      .join(', ')} could not be confirmed. Not marked as supported.`;
  }
  return {
    status,
    monographId: monograph.id,
    identity,
    summary,
    similarNames: [],
    coverageChunkId: null,
    retrieval,
    findings,
  };
}

const GAP_LABEL: Record<FindingReason | 'not_checked', string> = {
  not_constrained: 'no rule in the monograph',
  not_stated: 'not stated in the prescription',
  insufficient_evidence: 'insufficient evidence',
  unverified: 'model claim could not be verified',
  not_checked: 'not checked',
};

/**
 * Medication status from its findings:
 * - contradicted: any field conflicts with the matched monograph;
 * - supported: dose, route and frequency are confirmed consistent (dose must be — a monograph
 *   without a standard dose can't support it; route/frequency may be unconstrained), and every
 *   other field is consistent or not constrained by the monograph;
 * - incomplete: otherwise — something meaningful could not be verified (listed in `gaps`).
 */
export function classifyVerification(findings: FindingOut[]): {
  status: VerificationStatus;
  gaps: { field: VerifiedField; reason: FindingReason | 'not_checked' }[];
} {
  if (findings.some((f) => f.verdict === 'conflict')) return { status: 'contradicted', gaps: [] };
  const gaps: { field: VerifiedField; reason: FindingReason | 'not_checked' }[] = [];
  for (const field of CORE_VERIFIED_FIELDS)
    if (!findings.some((f) => f.field === field)) gaps.push({ field, reason: 'not_checked' });
  for (const f of findings) {
    if (f.verdict === 'consistent') continue;
    const unconstrained = f.reason === 'not_constrained' && f.field !== 'dose';
    if (!unconstrained) gaps.push({ field: f.field, reason: f.reason ?? 'insufficient_evidence' });
  }
  return { status: gaps.length ? 'incomplete' : 'supported', gaps };
}

const STOP_WORDS = new Set(
  'with without patients patient history known severe active from that this have been should must never avoid only when used using other than more less under over aged years year their they which these those where while also into upon such each'.split(
    ' ',
  ),
);

/**
 * Does a monograph restriction apply to *this* patient? The condition named after the exclusion
 * phrase ("Not for use in children under 12" → children) must be documented in the discharge
 * document; otherwise the restriction is not shown to apply and is not reported as a conflict.
 * Deterministic and conservative: a missing match yields "insufficient evidence", never "safe".
 */
export function exclusionApplies(quote: string, primaryText: string | undefined): boolean {
  if (!primaryText) return false;
  const m = EXCLUSION_RE.exec(quote);
  const clause = normalizeForMatch(m ? quote.slice(m.index + m[0].length) : quote);
  const terms = [...new Set(clause.split(/[^a-z0-9]+/))].filter(
    (w) => w.length >= 4 && !STOP_WORDS.has(w),
  );
  if (terms.length === 0) return false;
  const hay = normalizeForMatch(primaryText);
  // Light stemming: compare on a prefix so "children"/"child", "pregnancy"/"pregnant" match.
  const stem = (w: string) => (w.length > 6 ? w.slice(0, w.length - 3) : w);
  const hits = terms.filter((t) => new RegExp(`\\b${stem(t)}`).test(hay));
  return hits.length >= Math.ceil(terms.length / 2);
}

/** A quote that decides a verdict must be substantive (not "once" or "10 mg"). */
export function isDecisiveQuote(quote: string | null | undefined): boolean {
  const q = normalizeForMatch(quote ?? '');
  return q.length >= 12 && q.split(' ').length >= 3;
}

const EXCLUSION_RE =
  /\b(contraindicat\w*|not (?:be )?(?:used|indicated|recommended|approved)|not for\b|avoid\w*|do not|should not|must not|never|only (?:for|in|when|if))/i;

/**
 * An indication conflict needs exclusion language: the Contraindications field, or a quote that limits
 * or forbids use ("not for", "avoid", "only in", "contraindicated"). Absence from a list is not enough.
 */
export function statesExclusion(chunk: ChunkLike, quote: string | null): boolean {
  if (/contraindication/i.test(chunk.fieldLabel ?? '')) return true;
  return EXCLUSION_RE.test(quote ?? '');
}

/**
 * Merge deterministic and LLM per-field judgements.
 * - Deterministic conflict with a validated quote is authoritative.
 * - High-confidence deterministic "consistent" outranks an LLM conflict (noted in the explanation).
 * - Otherwise an LLM conflict counts only if its quote validates in a passage of the matched monograph;
 *   an indication conflict additionally needs exclusion language (see statesExclusion).
 * - Unverifiable LLM claims are kept visible as 'unknown' (rejected evidence), never as findings.
 */
export function mergeFindings(
  det: DetFinding[],
  llm: VerifyOutput,
  passages: { id: string; chunk: ChunkLike }[],
  monographChunks: ChunkLike[],
  context: { primaryText?: string } = {},
): FindingOut[] {
  const fields = new Set<VerifiedField>([
    ...det.map((d) => d.field),
    ...llm.fields.map((f) => f.field),
  ]);
  const out: FindingOut[] = [];
  for (const field of FIELD_ORDER) {
    if (!fields.has(field)) continue;
    const d = det.find((x) => x.field === field);
    const l = llm.fields.find((x) => x.field === field);
    const dCite = d ? citeEvidence(d.evidence, monographChunks) : null;
    // LLM evidence must appear verbatim in a passage of the matched monograph. The named passage is
    // preferred; if the model mislabelled the id, re-anchor to the passage that contains the quote.
    const named = l?.passage_id ? passages.find((p) => p.id === l.passage_id) : undefined;
    const lPassage =
      l?.quote && named && quoteAppearsIn(l.quote, named.chunk.text)
        ? named
        : l?.quote
          ? passages.find((p) => quoteAppearsIn(l.quote, p.chunk.text))
          : undefined;
    const lValid = Boolean(
      l?.quote &&
      isDecisiveQuote(l.quote) &&
      lPassage &&
      monographChunks.some((c) => c.id === lPassage.chunk.id),
    );
    const decisive = (v: FieldVerdict) => v === 'consistent' || v === 'conflict';

    const fromDet = (decidedBy: FindingOut['decidedBy'], note = ''): FindingOut => ({
      field,
      verdict: d!.verdict,
      prescribedValue: d!.prescribed,
      referenceConstraint: d!.constraint,
      explanation: d!.explanation + note,
      decidedBy,
      confidence: d!.confidence,
      chunkId: dCite!.chunkId,
      quote: dCite!.quote,
      quoteValid: dCite!.valid,
      reason: decisive(d!.verdict) ? null : (d!.reason ?? 'insufficient_evidence'),
    });
    // The model's "not addressed": the prescription is silent, or the passages set no rule.
    const llmGapReason = (): FindingReason =>
      (l?.prescribed ?? d?.prescribed) ? 'not_constrained' : 'not_stated';
    const fromLlm = (
      verdict: FieldVerdict,
      confidence: FindingOut['confidence'],
      note = '',
      reason: FindingReason | null = decisive(verdict)
        ? null
        : verdict === 'unknown'
          ? 'unverified'
          : llmGapReason(),
    ): FindingOut => ({
      field,
      verdict,
      prescribedValue: l!.prescribed ?? d?.prescribed ?? null,
      referenceConstraint: l!.reference_constraint ?? d?.constraint ?? null,
      explanation: l!.explanation + note,
      decidedBy: 'llm',
      confidence,
      chunkId: lValid ? lPassage!.chunk.id : null,
      quote: l!.quote,
      quoteValid: lValid,
      reason,
    });

    const dSolid = Boolean(
      d && dCite?.valid && (d.verdict === 'conflict' || d.verdict === 'consistent'),
    );
    if (d && dSolid && d.verdict === 'conflict') {
      out.push(fromDet(l?.verdict === 'conflict' ? 'both' : 'deterministic'));
    } else if (d && dSolid && d.verdict === 'consistent' && d.confidence === 'high') {
      const note =
        l?.verdict === 'conflict'
          ? ' (The model suggested a conflict here, but the deterministic check of the cited passage did not confirm it.)'
          : '';
      out.push(fromDet(l?.verdict === 'consistent' ? 'both' : 'deterministic', note));
    } else if (
      l &&
      l.verdict === 'conflict' &&
      lValid &&
      field === 'indication' &&
      !statesExclusion(lPassage!.chunk, l.quote)
    ) {
      // An indication list is not exhaustive: a use the digest does not name is not contradicted by it.
      out.push(
        fromLlm(
          'not_addressed',
          'low',
          ' — not counted as a conflict: the cited passage lists indications but does not exclude or contraindicate this use.',
          'not_constrained',
        ),
      );
    } else if (
      l &&
      l.verdict === 'conflict' &&
      lValid &&
      field === 'indication' &&
      !exclusionApplies(l.quote ?? '', context.primaryText)
    ) {
      // A restriction exists, but the discharge document doesn't show it applies to this patient.
      out.push(
        fromLlm(
          'not_addressed',
          'low',
          ' — not counted as a conflict: the discharge document does not show that this restriction applies to the patient. Needs review.',
          'insufficient_evidence',
        ),
      );
    } else if (l && l.verdict === 'conflict' && lValid) {
      out.push(fromLlm('conflict', 'medium'));
    } else if (l && l.verdict === 'conflict') {
      out.push(
        d && dSolid
          ? fromDet(
              'deterministic',
              ' (A model-claimed conflict was rejected: its quote could not be verified in the cited passage.)',
            )
          : fromLlm(
              'unknown',
              'low',
              ' — rejected: the supporting quote could not be verified in this monograph.',
            ),
      );
    } else if (d && dSolid) {
      out.push(fromDet(l?.verdict === d.verdict ? 'both' : 'deterministic'));
    } else if (l && l.verdict === 'consistent' && lValid) {
      out.push(fromLlm('consistent', 'medium'));
    } else if (d && field === 'indication' && l?.verdict === 'not_addressed') {
      // Indication is semantic: the model's "no rule on this" outranks the placeholder check.
      out.push(fromLlm('not_addressed', 'medium'));
    } else if (d) {
      out.push(fromDet('deterministic'));
    } else if (l) {
      out.push(
        l.verdict === 'consistent'
          ? fromLlm('unknown', 'low', ' — not counted: no verifiable quote.')
          : fromLlm(l.verdict, 'low'),
      );
    }
  }
  return out;
}
