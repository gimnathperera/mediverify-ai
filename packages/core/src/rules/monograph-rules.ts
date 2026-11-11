import { splitSentences } from '../text.js';

import {
  parseDose,
  parseFrequency,
  parseNumber,
  parseRoute,
  parseTiming,
  type Frequency,
  type Route,
  type Timing,
} from './normalize.js';

/** Verbatim evidence for a rule: the sentence it came from and the monograph field it belongs to. */
export interface Evidence {
  fieldLabel: string;
  quote: string;
}

export interface DoseSpec {
  value: number;
  unit: string;
  frequency: Frequency | null;
  route: Route | null;
  timing: Timing | null;
  evidence: Evidence;
}

export interface MonographRules {
  version: 1;
  standardDose: DoseSpec | null;
  reducedInitialDoses: { value: number; unit: string; evidence: Evidence }[];
  maxDose: DoseSpec | null;
  maxDailyDose: { value: number; unit: string; evidence: Evidence } | null;
  titration: {
    incrementValue: number | null;
    unit: string | null;
    minIntervalWeeks: number;
    evidence: Evidence;
  } | null;
  requiredTiming: { timing: Timing; evidence: Evidence } | null;
  forbiddenTimings: { timing: Timing; evidence: Evidence }[];
  maxDurationWeeks: { value: number; evidence: Evidence } | null;
  reassessmentWeeks: { value: number; evidence: Evidence } | null;
  indication: { text: string; evidence: Evidence } | null;
}

export interface MonographField {
  label: string;
  text: string; // paragraph text including the 'Label:' prefix
}

const NUM = '(\\d+(?:\\.\\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|twelve)';

function body(field: MonographField): string {
  return field.text.replace(new RegExp(`^${escapeRe(field.label)}:\\s*`), '');
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function fieldNamed(fields: MonographField[], re: RegExp) {
  return fields.find((f) => re.test(f.label));
}

function doseSpec(field: MonographField | undefined): DoseSpec | null {
  if (!field) return null;
  const first = splitSentences(body(field))[0] ?? '';
  const dose = parseDose(first);
  if (!dose) return null;
  return {
    ...dose,
    frequency: parseFrequency(first),
    route: parseRoute(first),
    timing: parseTiming(first),
    evidence: { fieldLabel: field.label, quote: first },
  };
}

/**
 * Deterministically derive prescribing constraints from a monograph's labeled fields.
 * Every rule keeps the verbatim sentence it came from, so findings can cite it and be validated.
 * Rules that cannot be parsed are null — the LLM verifier still sees the full passages.
 */
export function extractMonographRules(fields: MonographField[]): MonographRules {
  const std = fieldNamed(fields, /standard.*dose|usual.*dose|^dose/i);
  const max = fieldNamed(fields, /max/i);
  const rules: MonographRules = {
    version: 1,
    standardDose: doseSpec(std),
    reducedInitialDoses: [],
    maxDose: doseSpec(max),
    maxDailyDose: null,
    titration: null,
    requiredTiming: null,
    forbiddenTimings: [],
    maxDurationWeeks: null,
    reassessmentWeeks: null,
    indication: null,
  };

  if (std) {
    for (const sentence of splitSentences(body(std))) {
      const reduced = new RegExp(`(?:reduced|lowered|decreased) to ${NUM}\\s*(mg|mcg|g)`, 'i').exec(
        sentence,
      );
      if (reduced) {
        const value = parseNumber(reduced[1]!);
        if (value !== null)
          rules.reducedInitialDoses.push({
            value,
            unit: reduced[2]!.toLowerCase(),
            evidence: { fieldLabel: std.label, quote: sentence },
          });
      }
      if (/titrat/i.test(sentence)) {
        const interval = new RegExp(
          `intervals? of (?:no less than|at least|not less than) ${NUM} weeks?`,
          'i',
        ).exec(sentence);
        const inc = new RegExp(`increments? of ${NUM}\\s*(mg|mcg|g)`, 'i').exec(sentence);
        if (interval) {
          rules.titration = {
            incrementValue: inc ? parseNumber(inc[1]!) : null,
            unit: inc ? inc[2]!.toLowerCase() : null,
            minIntervalWeeks: parseNumber(interval[1]!) ?? 0,
            evidence: { fieldLabel: std.label, quote: sentence },
          };
        }
      }
    }
    if (rules.standardDose?.timing) {
      rules.requiredTiming = {
        timing: rules.standardDose.timing,
        evidence: rules.standardDose.evidence,
      };
    }
  }

  if (max) {
    const daily = new RegExp(`maximum daily dose (?:of|is) ${NUM}\\s*(mg|mcg|g)`, 'i').exec(
      body(max),
    );
    if (daily) {
      const sentence = splitSentences(body(max)).find((s) => s.includes(daily[0])) ?? daily[0];
      rules.maxDailyDose = {
        value: parseNumber(daily[1]!)!,
        unit: daily[2]!.toLowerCase(),
        evidence: { fieldLabel: max.label, quote: sentence },
      };
    }
  }

  for (const field of fields) {
    for (const sentence of splitSentences(body(field))) {
      // Forbidden administration timing, e.g. "take Pravoxil at bedtime, not in the morning".
      const notTiming = /\bnot in the (morning|evening)\b|\bnot at (bedtime|night)\b/i.exec(
        sentence,
      );
      if (notTiming) {
        const t = parseTiming(notTiming[0]);
        if (t && !rules.forbiddenTimings.some((f) => f.timing === t))
          rules.forbiddenTimings.push({
            timing: t,
            evidence: { fieldLabel: field.label, quote: sentence },
          });
      }
      // Duration limits, preferring imperative statements ("must not … beyond 4 weeks").
      const dur = new RegExp(
        `(?:up to|beyond|exceed|no longer than|maximum of|not (?:be )?(?:used|continued) (?:for )?more than) ${NUM} (weeks?|days?|months?)`,
        'i',
      ).exec(sentence);
      if (dur && /duration|use|treatment|initiate|course/i.test(sentence)) {
        const n = parseNumber(dur[1]!);
        const unit = dur[2]!.toLowerCase();
        // Stored in weeks; days/months are converted.
        const value =
          n === null
            ? null
            : unit.startsWith('day')
              ? n / 7
              : unit.startsWith('month')
                ? n * (52 / 12)
                : n;
        const better =
          !rules.maxDurationWeeks ||
          (/must not/i.test(sentence) && !/must not/i.test(rules.maxDurationWeeks.evidence.quote));
        if (value !== null && better)
          rules.maxDurationWeeks = {
            value,
            evidence: { fieldLabel: field.label, quote: sentence },
          };
      }
      const reassess = new RegExp(
        `(?:reassess\\w*|reviewed|review)[^.]*?\\bat ${NUM} weeks?`,
        'i',
      ).exec(sentence);
      if (reassess && !rules.reassessmentWeeks) {
        const value = parseNumber(reassess[1]!);
        if (value !== null)
          rules.reassessmentWeeks = {
            value,
            evidence: { fieldLabel: field.label, quote: sentence },
          };
      }
    }
  }

  const ind = fieldNamed(fields, /indication/i);
  if (ind) {
    rules.indication = { text: body(ind), evidence: { fieldLabel: ind.label, quote: body(ind) } };
  }
  return rules;
}
