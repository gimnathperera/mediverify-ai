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
  const t = s.toLowerCase();
  if (/\b(as needed|prn)\b/.test(t)) return 'as_needed';
  if (/\b(four times (a |per )?day|four times daily|qid)\b/.test(t)) return 'four_times_daily';
  if (/\b(three times (a |per )?day|three times daily|tid)\b/.test(t)) return 'three_times_daily';
  if (/\b(twice (a |per )?day|twice daily|two times daily|bid|every 12 hours)\b/.test(t))
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

/** Are two timings compatible? (before_breakfast is a morning timing; bedtime≈evening.) */
export function timingsCompatible(required: Timing, actual: Timing): boolean {
  if (required === actual) return true;
  const morning: Timing[] = ['morning', 'before_breakfast'];
  const night: Timing[] = ['bedtime', 'evening'];
  if (required === 'morning' && morning.includes(actual)) return true;
  if (required === 'evening' && night.includes(actual)) return true;
  if (required === 'bedtime' && actual === 'evening') return false; // bedtime is stricter
  return false;
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
  const n = Number(s);
  if (Number.isFinite(n)) return n;
  return WORD_NUM[s.toLowerCase()] ?? null;
}

export interface ParsedDose {
  value: number;
  unit: string;
}

export function parseDose(s: string | null | undefined): ParsedDose | null {
  if (!s) return null;
  const m = /(\d+(?:\.\d+)?)\s*(mg|mcg|µg|g|units?|iu|ml)\b/i.exec(s);
  if (!m) return null;
  return { value: Number(m[1]), unit: normalizeUnit(m[2]!) };
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
