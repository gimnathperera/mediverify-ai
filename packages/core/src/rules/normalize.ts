/** Normalized vocabularies for prescribing parameters (shared by extraction and verification). */
export type Route =
  'oral' | 'intravenous' | 'intramuscular' | 'subcutaneous' | 'topical' | 'inhaled';
export type Frequency =
  'once_daily' | 'twice_daily' | 'three_times_daily' | 'four_times_daily' | 'as_needed';
export type Timing = 'morning' | 'before_breakfast' | 'bedtime' | 'evening' | 'with_food';

export const FREQUENCY_PER_DAY: Record<Frequency, number | null> = {
  once_daily: 1,
  twice_daily: 2,
  three_times_daily: 3,
  four_times_daily: 4,
  as_needed: null,
};

export const FREQUENCY_LABEL: Record<Frequency, string> = {
  once_daily: 'once daily',
  twice_daily: 'twice daily',
  three_times_daily: 'three times daily',
  four_times_daily: 'four times daily',
  as_needed: 'as needed',
};

export const TIMING_LABEL: Record<Timing, string> = {
  morning: 'in the morning',
  before_breakfast: 'before breakfast',
  bedtime: 'at bedtime',
  evening: 'in the evening',
  with_food: 'with food',
};

export function parseRoute(s: string | null | undefined): Route | null {
  if (!s) return null;
  const t = s.toLowerCase();
  if (/\b(po|p\.o\.|orally|oral|by mouth)\b/.test(t)) return 'oral';
  if (/\b(iv|intravenous(ly)?)\b/.test(t)) return 'intravenous';
  if (/\b(im|intramuscular(ly)?)\b/.test(t)) return 'intramuscular';
  if (/\b(sc|subq|subcutaneous(ly)?)\b/.test(t)) return 'subcutaneous';
  if (/\b(topical(ly)?)\b/.test(t)) return 'topical';
  if (/\b(inhaled|inhalation)\b/.test(t)) return 'inhaled';
  return null;
}

export function parseFrequency(s: string | null | undefined): Frequency | null {
  if (!s) return null;
  // "twice-daily", "b.i.d." and "q12h" style variants normalise to the spaced/plain forms.
  const t = s
    .toLowerCase()
    .replace(/[-_]/g, ' ')
    .replace(/\b([a-z])\.(?=[a-z]\.)/g, '$1')
    .replace(/\b(bid|tid|qid|prn)\./g, '$1');
  if (/\b(as needed|prn)\b/.test(t)) return 'as_needed';
  if (/\b(four times (a |per )?day|four times daily|qid|q ?6 ?h|every 6 hours)\b/.test(t))
    return 'four_times_daily';
  if (/\b(three times (a |per )?day|three times daily|tid|tds|q ?8 ?h|every 8 hours)\b/.test(t))
    return 'three_times_daily';
  if (
    /\b(twice (a |per )?day|twice daily|two times daily|bid|bd|q ?12 ?h|every 12 hours)\b/.test(t)
  )
    return 'twice_daily';
  if (
    /\b(once (a |per )?day|once daily|daily|every day|qd|every morning|each morning|every evening|nightly|at bedtime|every night)\b/.test(
      t,
    )
  )
    return 'once_daily';
  return null;
}

/** Timing of administration; returns the most specific match. */
export function parseTiming(s: string | null | undefined): Timing | null {
  if (!s) return null;
  const t = s.toLowerCase();
  if (/before breakfast|before the first meal/.test(t)) return 'before_breakfast';
  if (/\b(bedtime|nightly|at night|every night|hs)\b/.test(t)) return 'bedtime';
  if (/\b(evening)\b/.test(t)) return 'evening';
  if (/\b(morning)\b/.test(t)) return 'morning';
  if (/\bwith (food|meals?|breakfast)\b/.test(t)) return 'with_food';
  return null;
}

// Timing has two independent dimensions: time of day and relation to meals.
const TIME_OF_DAY: Record<Timing, 'am' | 'pm' | null> = {
  morning: 'am',
  before_breakfast: 'am',
  bedtime: 'pm',
  evening: 'pm',
  with_food: null,
};
const MEAL: Record<Timing, 'before' | 'with' | null> = {
  morning: null,
  before_breakfast: 'before',
  bedtime: null,
  evening: null,
  with_food: 'with',
};

/**
 * Compare a prescribed timing with a required one. `undetermined` when the prescription is silent
 * on the dimension the requirement is about (e.g. "in the morning" vs a "with food" rule) — that is
 * a gap to report, never a conflict.
 */
export function compareTimings(
  required: Timing,
  actual: Timing,
): 'compatible' | 'incompatible' | 'undetermined' {
  if (required === actual) return 'compatible';
  if (required === 'bedtime' && actual === 'evening') return 'incompatible'; // bedtime is stricter
  const [tr, ta, mr, ma] = [
    TIME_OF_DAY[required],
    TIME_OF_DAY[actual],
    MEAL[required],
    MEAL[actual],
  ];
  if (tr && ta && tr !== ta) return 'incompatible';
  if (mr && ma && mr !== ma) return 'incompatible';
  if ((mr && !ma) || (tr && !ta)) return 'undetermined';
  return 'compatible'; // e.g. morning ⊇ before breakfast, evening ⊇ bedtime
}

/** True only when the timings are positively compatible. */
export function timingsCompatible(required: Timing, actual: Timing): boolean {
  return compareTimings(required, actual) === 'compatible';
}

const WORD_NUM: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  twelve: 12,
};

export function parseNumber(s: string): number | null {
  const n = Number(s.replace(/,/g, ''));
  if (Number.isFinite(n)) return n;
  return WORD_NUM[s.toLowerCase()] ?? null;
}

export interface ParsedDose {
  value: number;
  unit: string;
}

const DOSE_NUM = '\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|\\d+(?:\\.\\d+)?';
const DOSE_UNIT = 'mg|mcg|µg|g|units?|iu|ml';
const DOSE_RE = new RegExp(`(${DOSE_NUM})\\s*(${DOSE_UNIT})\\b`, 'i');
// "5-10 mg", "5 to 10 mg" (range) and "25/100 mg" (combination strength).
const DOSE_AMBIGUOUS_RE = new RegExp(
  `(?:${DOSE_NUM})\\s*(?:-|–|to|/)\\s*(?:${DOSE_NUM})\\s*(?:${DOSE_UNIT})\\b`,
  'i',
);

/** True for ranges and combination strengths, which must never collapse to a single value. */
export function isAmbiguousDose(s: string | null | undefined): boolean {
  return Boolean(s && DOSE_AMBIGUOUS_RE.test(s));
}

export function parseDose(s: string | null | undefined): ParsedDose | null {
  if (!s || isAmbiguousDose(s)) return null;
  const m = DOSE_RE.exec(s);
  if (!m) return null;
  const value = parseNumber(m[1]!);
  return value === null ? null : { value, unit: normalizeUnit(m[2]!) };
}

const MG_PER: Record<string, number> = { mcg: 0.001, mg: 1, g: 1000 };

/**
 * Express `value unit` in `target` unit when both are mass units (mcg/mg/g); null otherwise.
 * Lets "0.5 g" be compared with a "500 mg" rule instead of being reported as a unit conflict.
 */
export function convertDose(value: number, unit: string, target: string): number | null {
  if (unit === target) return value;
  const from = MG_PER[unit];
  const to = MG_PER[target];
  if (from === undefined || to === undefined) return null;
  return Math.round(((value * from) / to) * 1e6) / 1e6;
}

export function normalizeUnit(u: string): string {
  const t = u.toLowerCase();
  if (t === 'µg') return 'mcg';
  if (t === 'unit' || t === 'units' || t === 'iu') return 'units';
  return t;
}

export interface ParsedDuration {
  value: number | null;
  unit: 'days' | 'weeks' | 'months' | null;
  indefinite: boolean;
  reassess: boolean;
  weeks: number | null;
}

export function parseDuration(s: string | null | undefined): ParsedDuration | null {
  if (!s) return null;
  const t = s.toLowerCase();
  const reassess = /reassess|review/.test(t);
  if (/indefinite|long[- ]term|ongoing|chronic|continue/.test(t) && !/\d/.test(t)) {
    return { value: null, unit: null, indefinite: true, reassess, weeks: null };
  }
  const m =
    /(\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|twelve)\s*(day|week|month)s?/.exec(
      t,
    );
  if (!m) return null;
  const value = parseNumber(m[1]!)!;
  const unit = `${m[2]!}s` as 'days' | 'weeks' | 'months';
  const weeks = unit === 'weeks' ? value : unit === 'days' ? value / 7 : value * (52 / 12);
  return { value, unit, indefinite: false, reassess, weeks };
}
