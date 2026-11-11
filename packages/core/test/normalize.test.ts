import { describe, expect, it } from 'vitest';

import {
  compareTimings,
  convertDose,
  parseDose,
  parseDuration,
  parseFrequency,
} from '../src/rules/normalize.js';

describe('parseDose', () => {
  it.each([
    ['20 mg', { value: 20, unit: 'mg' }],
    ['1,000 mg', { value: 1000, unit: 'mg' }],
    ['0.5 g', { value: 0.5, unit: 'g' }],
    ['250 µg', { value: 250, unit: 'mcg' }],
    ['Cordizem-XR 100 mg', { value: 100, unit: 'mg' }],
  ])('%s → %o', (raw, expected) => expect(parseDose(raw)).toEqual(expected));

  it.each(['5-10 mg', '5 to 10 mg', '25/100 mg', 'two tablets'])(
    'returns null for ambiguous or unit-less "%s" (never collapses)',
    (raw) => expect(parseDose(raw)).toBeNull(),
  );
});

describe('convertDose', () => {
  it('converts between mass units only', () => {
    expect(convertDose(0.5, 'g', 'mg')).toBe(500);
    expect(convertDose(500, 'mcg', 'mg')).toBe(0.5);
    expect(convertDose(5, 'ml', 'mg')).toBeNull();
  });
});

describe('parseFrequency', () => {
  it.each([
    ['once daily', 'once_daily'],
    ['PO once daily', 'once_daily'],
    ['twice daily', 'twice_daily'],
    ['twice-daily', 'twice_daily'],
    ['BD', 'twice_daily'],
    ['b.i.d.', 'twice_daily'],
    ['q12h', 'twice_daily'],
    ['TID', 'three_times_daily'],
    ['every 8 hours', 'three_times_daily'],
    ['q6h', 'four_times_daily'],
    ['as needed', 'as_needed'],
    ['weekly', null],
  ])('%s → %s', (raw, expected) => expect(parseFrequency(raw)).toBe(expected));
});

describe('compareTimings', () => {
  it('treats time of day and meal relation as separate dimensions', () => {
    expect(compareTimings('morning', 'before_breakfast')).toBe('compatible');
    expect(compareTimings('bedtime', 'morning')).toBe('incompatible');
    expect(compareTimings('bedtime', 'evening')).toBe('incompatible');
    expect(compareTimings('with_food', 'morning')).toBe('undetermined');
    expect(compareTimings('before_breakfast', 'morning')).toBe('undetermined');
  });
});

describe('parseDuration', () => {
  it('normalises days, weeks and months to weeks', () => {
    expect(parseDuration('8 weeks')?.weeks).toBe(8);
    expect(parseDuration('14 days')?.weeks).toBe(2);
    expect(parseDuration('seven days')?.weeks).toBe(1);
    expect(parseDuration('Continue indefinitely')?.indefinite).toBe(true);
  });
});
