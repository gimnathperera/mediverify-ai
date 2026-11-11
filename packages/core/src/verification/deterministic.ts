import type { FieldVerdict, FindingReason, VerifiedField } from '@mediverify/shared';

import type { Evidence, MonographRules } from '../rules/monograph-rules.js';
import {
  compareTimings,
  convertDose,
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
  /** Why the verdict is not decisive (see FINDING_REASONS); absent for consistent/conflict. */
  reason?: FindingReason;
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
    const convertible =
      med.doseValue !== null && convertDose(med.doseValue, med.doseUnit, std.unit) !== null;
    out.push(
      med.doseUnit === std.unit || convertible
        ? {
            field: 'unit',
            verdict: 'consistent',
            prescribed: med.doseUnit,
            constraint: std.unit,
            explanation:
              med.doseUnit === std.unit
                ? `Dose unit (${med.doseUnit}) matches the monograph.`
                : `Dose unit (${med.doseUnit}) converts to the monograph's ${std.unit}; compared after conversion.`,
            confidence: 'high',
            evidence: [std.evidence],
          }
        : {
            // e.g. mL vs mg: a different formulation, not by itself a prescribing error.
            field: 'unit',
            verdict: 'unknown',
            prescribed: med.doseUnit,
            constraint: std.unit,
            explanation: `Prescribed unit "${med.doseUnit}" cannot be converted to the monograph's "${std.unit}"; the dose cannot be compared.`,
            confidence: 'low',
            evidence: [std.evidence],
            reason: 'insufficient_evidence',
          },
    );
  }

  // ── dose
  out.push(checkDose(med, rules, prescribedDose));

  // ── route
  if (!std?.route || !med.route)
    out.push(gap('route', med.route, !std?.route, 'route', std ? [std.evidence] : []));
  else {
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
  if (!std?.frequency || !med.frequency)
    out.push(
      gap(
        'frequency',
        med.frequencyRaw ?? med.frequency,
        !std?.frequency,
        'frequency',
        std ? [std.evidence] : [],
      ),
    );
  else if (med.frequency === 'as_needed')
    out.push({
      field: 'frequency',
      verdict: 'unknown',
      prescribed: med.frequencyRaw ?? med.frequency,
      constraint: FREQUENCY_LABEL[std.frequency],
      explanation: `Prescribed as needed; the monograph specifies ${FREQUENCY_LABEL[std.frequency]}, so the schedule cannot be compared.`,
      confidence: 'low',
      evidence: [std.evidence],
      reason: 'insufficient_evidence',
    });
  else {
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
    reason: rules.indication ? 'insufficient_evidence' : 'not_constrained',
  });
  return out;
}

/**
 * A field that can't be compared: the monograph sets no rule for it (`not_constrained`) or the
 * prescription doesn't state it (`not_stated`). The monograph side is checked first: with no rule
 * there is nothing to verify, whatever the prescription says.
 */
function gap(
  field: VerifiedField,
  prescribed: string | null,
  noRule: boolean,
  label: string,
  evidence: Evidence[],
): DetFinding {
  return {
    field,
    verdict: 'not_addressed',
    prescribed,
    constraint: null,
    explanation: noRule
      ? `The monograph does not specify a ${label}.`
      : `The prescription does not state a ${label}.`,
    confidence: 'medium',
    evidence: noRule ? [] : evidence,
    reason: noRule ? 'not_constrained' : 'not_stated',
  };
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
      explanation: med.doseRaw
        ? `Dose "${med.doseRaw}" is a range or combination and cannot be compared to a single value.`
        : 'Dose not stated in the prescription.',
      confidence: 'low',
      evidence: [],
      reason: med.doseRaw ? 'insufficient_evidence' : 'not_stated',
    };
  if (!std)
    return {
      ...base,
      verdict: 'unknown',
      constraint: null,
      explanation: 'Monograph standard dose could not be parsed deterministically.',
      confidence: 'low',
      evidence: [],
      reason: 'insufficient_evidence',
    };
  // Compare in the monograph's unit (mass units convert: 0.5 g = 500 mg).
  const dose = med.doseUnit ? convertDose(med.doseValue, med.doseUnit, std.unit) : med.doseValue;
  if (dose === null)
    return {
      ...base,
      verdict: 'unknown',
      constraint: fmt(std.value, std.unit),
      explanation: 'Units differ and cannot be converted; dose cannot be compared numerically.',
      confidence: 'low',
      evidence: [std.evidence],
      reason: 'insufficient_evidence',
    };
  const max = rules.maxDose;
  if (max && dose > max.value)
    return {
      ...base,
      verdict: 'conflict',
      constraint: `maximum ${fmt(max.value, max.unit)} per dose`,
      explanation: `Prescribed ${fmt(dose, std.unit)} exceeds the monograph maximum of ${fmt(max.value, max.unit)}.`,
      confidence: 'high',
      evidence: [max.evidence],
    };
  const perDay = med.frequency ? FREQUENCY_PER_DAY[med.frequency as Frequency] : null;
  if (rules.maxDailyDose && perDay && dose * perDay > rules.maxDailyDose.value)
    return {
      ...base,
      verdict: 'conflict',
      constraint: `maximum ${fmt(rules.maxDailyDose.value, rules.maxDailyDose.unit)} per day`,
      explanation: `Total daily dose ${fmt(dose * perDay, std.unit)} exceeds the monograph's maximum daily dose of ${fmt(rules.maxDailyDose.value, rules.maxDailyDose.unit)}.`,
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
      reason: 'insufficient_evidence',
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
    // Whether this is a new start decides the verdict; when the document doesn't establish it
    // (with a validated quote), report the gap instead of guessing a conflict.
    if (med.isNewStart === null)
      return {
        ...base,
        verdict: 'unknown',
        constraint,
        explanation: `${fmt(dose, std.unit)} exceeds the standard starting dose of ${fmt(std.value, std.unit)}. Whether it is consistent depends on prior therapy, which the document does not establish (the monograph requires ${schedule}).`,
        confidence: 'low',
        evidence: [std.evidence, t.evidence],
        reason: 'insufficient_evidence',
      };
    const startNote = 'The document describes this as a new start';
    return {
      ...base,
      verdict: 'conflict',
      constraint,
      explanation: `${startNote}, yet ${fmt(dose, std.unit)} exceeds the standard starting dose of ${fmt(std.value, std.unit)}. Under the monograph's ${schedule}, reaching ${fmt(dose, std.unit)} needs ${steps} step(s) — at least ${minWeeks} weeks. Being below the ${max ? fmt(max.value, max.unit) : ''} maximum does not make this initiation dose consistent.`,
      confidence: 'medium',
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
      reason: 'not_constrained',
    };
  if (!timing)
    return {
      ...base,
      verdict: 'not_addressed',
      constraint: TIMING_LABEL[req.timing],
      explanation: `The monograph specifies administration ${TIMING_LABEL[req.timing]}; the prescription does not state a timing.`,
      confidence: 'medium',
      evidence: [req.evidence],
      reason: 'not_stated',
    };
  const cmp = compareTimings(req.timing, timing);
  if (cmp === 'undetermined')
    return {
      ...base,
      verdict: 'unknown',
      constraint: TIMING_LABEL[req.timing],
      explanation: `The monograph specifies administration ${TIMING_LABEL[req.timing]}; the prescription (${TIMING_LABEL[timing]}) does not say whether that is met.`,
      confidence: 'low',
      evidence: [req.evidence],
      reason: 'insufficient_evidence',
    };
  const ok = cmp === 'compatible';
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
  const limited = Boolean(max || re);
  return {
    ...base,
    verdict: limited && med.durationRaw ? 'unknown' : 'not_addressed',
    constraint: re ? `reassess at ${re.value} weeks` : max ? `≤ ${max.value} weeks` : null,
    explanation: !limited
      ? 'The monograph states no numeric duration limit.'
      : med.durationRaw
        ? 'Duration could not be compared deterministically.'
        : 'The monograph limits the duration, but the prescription does not state one.',
    confidence: 'low',
    evidence: re ? [re.evidence] : max ? [max.evidence] : [],
    reason: !limited ? 'not_constrained' : med.durationRaw ? 'insufficient_evidence' : 'not_stated',
  };
}
