import type { FieldVerdict, VerifiedField } from '@mediverify/shared';

import type { Evidence, MonographRules } from '../rules/monograph-rules.js';
import {
  FREQUENCY_LABEL,
  FREQUENCY_PER_DAY,
  TIMING_LABEL,
  timingsCompatible,
  type Frequency,
  type Route,
  type Timing,
} from '../rules/normalize.js';

export interface MedicationForCheck {
  drugName: string;
  doseValue: number | null;
  doseUnit: string | null;
  doseRaw: string | null;
  route: string | null;
  frequency: string | null;
  frequencyRaw: string | null;
  timing: string | null;
  durationValue: number | null;
  durationUnit: string | null;
  durationRaw: string | null;
  indication: string | null;
  isNewStart: boolean | null;
}

export interface DetFinding {
  field: VerifiedField;
  verdict: FieldVerdict;
  prescribed: string | null;
  constraint: string | null;
  explanation: string;
  confidence: 'high' | 'medium' | 'low';
  /** Ordered evidence; contiguous same-field quotes are joined when the joined text validates. */
  evidence: Evidence[];
}

const fmt = (v: number, u: string | null) => `${v} ${u ?? ''}`.trim();

function weeksOf(med: MedicationForCheck): number | null {
  if (med.durationValue === null || !med.durationUnit) return null;
  if (med.durationUnit === 'weeks') return med.durationValue;
  if (med.durationUnit === 'days') return med.durationValue / 7;
  if (med.durationUnit === 'months') return med.durationValue * (52 / 12);
  return null;
}

/**
 * Deterministic checks of numeric / categorical constraints parsed from the matched monograph.
 * Returns one finding per field. 'unknown' = no reliable deterministic judgement (the LLM may decide).
 */
export function deterministicChecks(med: MedicationForCheck, rules: MonographRules): DetFinding[] {
  const out: DetFinding[] = [];
  const std = rules.standardDose;
  const prescribedDose = med.doseValue !== null ? fmt(med.doseValue, med.doseUnit) : med.doseRaw;

  // ── unit
  if (std && med.doseUnit) {
    out.push(
      med.doseUnit === std.unit
        ? {
            field: 'unit',
            verdict: 'consistent',
            prescribed: med.doseUnit,
            constraint: std.unit,
            explanation: `Dose unit (${med.doseUnit}) matches the monograph.`,
            confidence: 'high',
            evidence: [std.evidence],
          }
        : {
            field: 'unit',
            verdict: 'conflict',
            prescribed: med.doseUnit,
            constraint: std.unit,
            explanation: `Prescribed unit "${med.doseUnit}" differs from the monograph's "${std.unit}".`,
            confidence: 'high',
            evidence: [std.evidence],
          },
    );
  }

  // ── dose
  out.push(checkDose(med, rules, prescribedDose));

  // ── route
  if (std?.route && med.route) {
    const same = (med.route as Route) === std.route;
    out.push({
      field: 'route',
      verdict: same ? 'consistent' : 'conflict',
      prescribed: med.route,
      constraint: std.route,
      explanation: same
        ? `Route (${med.route}) matches the monograph.`
        : `Prescribed route "${med.route}" differs from the monograph route "${std.route}".`,
      confidence: 'high',
      evidence: [std.evidence],
    });
  }

  // ── frequency
  if (std?.frequency && med.frequency && med.frequency !== 'as_needed') {
    const same = (med.frequency as Frequency) === std.frequency;
    out.push({
      field: 'frequency',
      verdict: same ? 'consistent' : 'conflict',
      prescribed: med.frequencyRaw ?? med.frequency,
      constraint: FREQUENCY_LABEL[std.frequency],
      explanation: same
        ? `Frequency (${FREQUENCY_LABEL[std.frequency]}) matches the monograph.`
        : `Prescribed ${FREQUENCY_LABEL[med.frequency as Frequency] ?? med.frequency}, but the monograph specifies ${FREQUENCY_LABEL[std.frequency]}.`,
      confidence: 'high',
      evidence: [std.evidence],
    });
  }

  // ── timing
  out.push(checkTiming(med, rules));

  // ── duration
  out.push(checkDuration(med, rules));

  // ── indication: semantic — left to the LLM verifier.
  out.push({
    field: 'indication',
    verdict: 'unknown',
    prescribed: med.indication,
    constraint: rules.indication?.text ?? null,
    explanation: 'Indication compatibility is assessed by the model against the monograph text.',
    confidence: 'low',
    evidence: rules.indication ? [rules.indication.evidence] : [],
  });
  return out;
}

function checkDose(
  med: MedicationForCheck,
  rules: MonographRules,
  prescribed: string | null,
): DetFinding {
  const std = rules.standardDose;
  const base = { field: 'dose' as const, prescribed };
  if (med.doseValue === null)
    return {
      ...base,
      verdict: 'unknown',
      constraint: null,
      explanation: 'Dose not stated in the prescription.',
      confidence: 'low',
      evidence: [],
    };
  if (!std)
    return {
      ...base,
      verdict: 'unknown',
      constraint: null,
      explanation: 'Monograph standard dose could not be parsed deterministically.',
      confidence: 'low',
      evidence: [],
    };
  if (med.doseUnit && med.doseUnit !== std.unit)
    return {
      ...base,
      verdict: 'unknown',
      constraint: fmt(std.value, std.unit),
      explanation: 'Units differ; dose cannot be compared numerically.',
      confidence: 'low',
      evidence: [std.evidence],
    };
  const dose = med.doseValue;
  const max = rules.maxDose;
  if (max && dose > max.value)
    return {
      ...base,
      verdict: 'conflict',
      constraint: `maximum ${fmt(max.value, max.unit)} per dose`,
      explanation: `Prescribed ${fmt(dose, med.doseUnit)} exceeds the monograph maximum of ${fmt(max.value, max.unit)}.`,
      confidence: 'high',
      evidence: [max.evidence],
    };
  const perDay = med.frequency ? FREQUENCY_PER_DAY[med.frequency as Frequency] : null;
  if (rules.maxDailyDose && perDay && dose * perDay > rules.maxDailyDose.value)
    return {
      ...base,
      verdict: 'conflict',
      constraint: `maximum ${fmt(rules.maxDailyDose.value, rules.maxDailyDose.unit)} per day`,
      explanation: `Total daily dose ${fmt(dose * perDay, med.doseUnit)} exceeds the monograph's maximum daily dose of ${fmt(rules.maxDailyDose.value, rules.maxDailyDose.unit)}.`,
      confidence: 'high',
      evidence: [rules.maxDailyDose.evidence],
    };
  if (dose === std.value)
    return {
      ...base,
      verdict: 'consistent',
      constraint: `standard ${fmt(std.value, std.unit)}`,
      explanation: `Dose matches the monograph standard adult dose of ${fmt(std.value, std.unit)}.`,
      confidence: 'high',
      evidence: [std.evidence],
    };
  const reduced = rules.reducedInitialDoses.find((r) => r.value === dose);
  if (reduced)
    return {
      ...base,
      verdict: 'consistent',
      constraint: `reduced initial ${fmt(reduced.value, reduced.unit)} in specific patients`,
      explanation: `Dose matches the monograph's reduced initial dose, which applies only in the circumstances the monograph lists.`,
      confidence: 'medium',
      evidence: [reduced.evidence],
    };
  if (dose < std.value)
    return {
      ...base,
      verdict: 'unknown',
      constraint: `standard ${fmt(std.value, std.unit)}`,
      explanation: `Dose is below the standard dose and is not a reduced dose listed in the monograph.`,
      confidence: 'low',
      evidence: [std.evidence],
    };

  // dose > standard and ≤ max
  const t = rules.titration;
  if (t) {
    const steps = t.incrementValue ? Math.ceil((dose - std.value) / t.incrementValue) : 1;
    const minWeeks = steps * t.minIntervalWeeks;
    const schedule = t.incrementValue
      ? `titration in ${fmt(t.incrementValue, t.unit ?? std.unit)} increments at intervals of no less than ${t.minIntervalWeeks} weeks`
      : `titration at intervals of no less than ${t.minIntervalWeeks} weeks`;
    const constraint = `start ${fmt(std.value, std.unit)}; ${schedule}`;
    if (med.isNewStart === false)
      return {
        ...base,
        verdict: 'consistent',
        constraint,
        explanation: `Dose is above the standard starting dose but within the maximum; the document indicates prior therapy, so titration may already have occurred.`,
        confidence: 'medium',
        evidence: [std.evidence, t.evidence],
      };
    const startNote = med.isNewStart
      ? 'The document describes this as a new start'
      : 'The document does not document prior therapy or titration';
    return {
      ...base,
      verdict: 'conflict',
      constraint,
      explanation: `${startNote}, yet ${fmt(dose, med.doseUnit)} exceeds the standard starting dose of ${fmt(std.value, std.unit)}. Under the monograph's ${schedule}, reaching ${fmt(dose, med.doseUnit)} needs ${steps} step(s) — at least ${minWeeks} weeks. Being below the ${max ? fmt(max.value, max.unit) : ''} maximum does not make this initiation dose consistent.`,
      confidence: med.isNewStart ? 'medium' : 'low',
      evidence: [std.evidence, t.evidence],
    };
  }
  return {
    ...base,
    verdict: 'consistent',
    constraint: max ? `≤ ${fmt(max.value, max.unit)}` : null,
    explanation: `Dose is above the standard dose but within the monograph maximum; no titration schedule is specified.`,
    confidence: 'medium',
    evidence: max ? [std.evidence, max.evidence] : [std.evidence],
  };
}

function checkTiming(med: MedicationForCheck, rules: MonographRules): DetFinding {
  const timing = med.timing as Timing | null;
  const base = { field: 'timing' as const, prescribed: timing ? TIMING_LABEL[timing] : null };
  if (timing) {
    const forbidden = rules.forbiddenTimings.find((f) => timingsCompatible(f.timing, timing));
    if (forbidden) {
      const req = rules.requiredTiming;
      return {
        ...base,
        verdict: 'conflict',
        constraint: req
          ? `${TIMING_LABEL[req.timing]}, not ${TIMING_LABEL[forbidden.timing]}`
          : `not ${TIMING_LABEL[forbidden.timing]}`,
        explanation: `Prescribed ${TIMING_LABEL[timing]}, but the monograph states it must not be given ${TIMING_LABEL[forbidden.timing]}${req ? ` (required: ${TIMING_LABEL[req.timing]})` : ''}.`,
        confidence: 'high',
        evidence: req ? [forbidden.evidence, req.evidence] : [forbidden.evidence],
      };
    }
  }
  const req = rules.requiredTiming;
  if (!req)
    return {
      ...base,
      verdict: 'not_addressed',
      constraint: null,
      explanation: 'The monograph does not specify administration timing.',
      confidence: 'medium',
      evidence: [],
    };
  if (!timing)
    return {
      ...base,
      verdict: 'not_addressed',
      constraint: TIMING_LABEL[req.timing],
      explanation: `The monograph specifies administration ${TIMING_LABEL[req.timing]}; the prescription does not state a timing.`,
      confidence: 'medium',
      evidence: [req.evidence],
    };
  const ok = timingsCompatible(req.timing, timing);
  return {
    ...base,
    verdict: ok ? 'consistent' : 'conflict',
    constraint: TIMING_LABEL[req.timing],
    explanation: ok
      ? `Timing (${TIMING_LABEL[timing]}) is consistent with the monograph (${TIMING_LABEL[req.timing]}).`
      : `Prescribed ${TIMING_LABEL[timing]}, but the monograph specifies ${TIMING_LABEL[req.timing]}.`,
    confidence: 'high',
    evidence: [req.evidence],
  };
}

function checkDuration(med: MedicationForCheck, rules: MonographRules): DetFinding {
  const weeks = weeksOf(med);
  const indefinite = med.durationUnit === 'indefinite';
  const reassessMentioned = /reassess|review/i.test(med.durationRaw ?? '');
  const base = { field: 'duration' as const, prescribed: med.durationRaw };
  const max = rules.maxDurationWeeks;
  if (max) {
    if (indefinite)
      return {
        ...base,
        verdict: 'conflict',
        constraint: `≤ ${max.value} weeks`,
        explanation: `Prescribed to continue indefinitely, but the monograph limits treatment to ${max.value} weeks.`,
        confidence: 'high',
        evidence: [max.evidence],
      };
    if (weeks !== null)
      return weeks > max.value
        ? {
            ...base,
            verdict: 'conflict',
            constraint: `≤ ${max.value} weeks`,
            explanation: `Intended duration of ${med.durationRaw} exceeds the monograph's ${max.value}-week limit.`,
            confidence: 'high',
            evidence: [max.evidence],
          }
        : {
            ...base,
            verdict: 'consistent',
            constraint: `≤ ${max.value} weeks`,
            explanation: `Duration is within the monograph's ${max.value}-week limit.`,
            confidence: 'high',
            evidence: [max.evidence],
          };
  }
  const re = rules.reassessmentWeeks;
  if (re && weeks !== null && reassessMentioned)
    return weeks <= re.value
      ? {
          ...base,
          verdict: 'consistent',
          constraint: `reassess at ${re.value} weeks`,
          explanation: `Planned course ("${med.durationRaw}") is consistent with the monograph's reassessment at ${re.value} weeks.`,
          confidence: 'high',
          evidence: [re.evidence],
        }
      : {
          ...base,
          verdict: 'conflict',
          constraint: `reassess at ${re.value} weeks`,
          explanation: `Reassessment is planned later (${med.durationRaw}) than the monograph's ${re.value}-week reassessment.`,
          confidence: 'medium',
          evidence: [re.evidence],
        };
  return {
    ...base,
    verdict: (max || re) && med.durationRaw ? 'unknown' : 'not_addressed',
    constraint: re ? `reassess at ${re.value} weeks` : null,
    explanation:
      max || re
        ? 'Duration could not be compared deterministically.'
        : 'The monograph states no numeric duration limit.',
    confidence: 'low',
    evidence: re ? [re.evidence] : [],
  };
}
