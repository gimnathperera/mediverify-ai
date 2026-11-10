import { describe, expect, it } from 'vitest';

import type { MonographRules } from '../src/rules/monograph-rules.js';
import { normalizeDrugName, quoteAppearsIn } from '../src/text.js';
import { deterministicChecks, type MedicationForCheck } from '../src/verification/deterministic.js';
import {
  identityMatchType,
  matchMonograph,
  similarMonographNames,
} from '../src/verification/identity.js';
import { mergeFindings, type ChunkLike } from '../src/verification/verify-medication.js';

const monographs = [
  'Velantine',
  'Cordizem-XR',
  'Mirosartan',
  'Pravoxil',
  'Etrazolam',
  'Sumavast',
  'Quintaxin',
  'Floranase',
].map((name, i) => ({
  id: `m${i}`,
  name,
  nameNormalized: normalizeDrugName(name),
  aliases: name.includes('-') ? [normalizeDrugName(name).replace('-', ' ')] : [],
}));

describe('identity gate', () => {
  it('matches exact and formulation-spacing variants', () => {
    expect(matchMonograph('Cordizem-XR', monographs)?.name).toBe('Cordizem-XR');
    expect(matchMonograph('CORDIZEM XR', monographs)?.name).toBe('Cordizem-XR');
    expect(matchMonograph(' pravoxil ', monographs)?.name).toBe('Pravoxil');
  });

  it('never matches a similar-looking but different drug (Pranixol ≠ Pravoxil)', () => {
    expect(matchMonograph('Pranixol', monographs)).toBeNull();
    expect(similarMonographNames('Pranixol', monographs)).toEqual(['Pravoxil']);
    expect(matchMonograph('Velantina', monographs)).toBeNull();
    expect(matchMonograph('Quintax', monographs)).toBeNull();
  });

  it('records whether the match was by exact name or explicit alias', () => {
    const cordizem = matchMonograph('Cordizem-XR', monographs)!;
    expect(identityMatchType('Cordizem-XR', cordizem)).toBe('exact');
    const viaAlias = {
      ...cordizem,
      nameNormalized: 'cordizem-xr-tablets',
      aliases: ['cordizem-xr'],
    };
    expect(identityMatchType('Cordizem-XR', viaAlias)).toBe('alias');
  });
});

describe('quote validation', () => {
  const src =
    'Standard adult dose: 20 mg orally once daily, at bedtime. Pravoxil’s pharmacokinetics favor evening administration.';
  it('accepts verbatim quotes modulo whitespace, case and typographic punctuation', () => {
    expect(quoteAppearsIn('20 mg orally   once daily, AT BEDTIME.', src)).toBe(true);
    expect(quoteAppearsIn("Pravoxil's pharmacokinetics favor evening", src)).toBe(true);
  });
  it('treats table cell separators shown in the prompt as whitespace', () => {
    // renderForPrompt shows table rows as `| a | b |`; page text joins the cells with spaces.
    const row = 'Etrazolam 0.5 mg PO twice daily 8 weeks Acute anxiety, sleep disturbance';
    expect(quoteAppearsIn('Etrazolam | 0.5 mg | PO twice daily | 8 weeks |', row)).toBe(true);
    expect(quoteAppearsIn('Etrazolam | 1 mg | PO twice daily', row)).toBe(false);
  });
  it('rejects fabricated or paraphrased quotes', () => {
    expect(quoteAppearsIn('20 mg orally once daily in the morning', src)).toBe(false);
    expect(quoteAppearsIn('take at night', src)).toBe(false);
    expect(quoteAppearsIn('', src)).toBe(false);
  });
  it('accepts ellipsis quotes only when every long fragment appears in order', () => {
    expect(quoteAppearsIn('20 mg orally once daily … favor evening administration', src)).toBe(
      true,
    );
    expect(quoteAppearsIn('favor evening administration … 20 mg orally once daily', src)).toBe(
      false,
    );
    expect(quoteAppearsIn('20 mg … bedtime', src)).toBe(false);
  });
});

const ev = (fieldLabel: string, quote: string) => ({ fieldLabel, quote });
const cordizemRules: MonographRules = {
  version: 1,
  standardDose: {
    value: 50,
    unit: 'mg',
    frequency: 'once_daily',
    route: 'oral',
    timing: 'morning',
    evidence: ev('Standard adult dose', '50 mg orally once daily, taken in the morning.'),
  },
  reducedInitialDoses: [],
  maxDose: {
    value: 200,
    unit: 'mg',
    frequency: 'once_daily',
    route: 'oral',
    timing: null,
    evidence: ev('Maximum dose', '200 mg orally once daily.'),
  },
  maxDailyDose: null,
  titration: {
    incrementValue: 25,
    unit: 'mg',
    minIntervalWeeks: 2,
    evidence: ev(
      'Standard adult dose',
      'May be titrated upward in increments of 25 mg at intervals of no less than two weeks based on heart rate response and blood pressure.',
    ),
  },
  requiredTiming: {
    timing: 'morning',
    evidence: ev('Standard adult dose', '50 mg orally once daily, taken in the morning.'),
  },
  forbiddenTimings: [],
  maxDurationWeeks: null,
  reassessmentWeeks: null,
  indication: null,
};
const med = (over: Partial<MedicationForCheck>): MedicationForCheck => ({
  drugName: 'Cordizem-XR',
  doseValue: 100,
  doseUnit: 'mg',
  doseRaw: '100 mg',
  route: 'oral',
  frequency: 'once_daily',
  frequencyRaw: 'once daily',
  timing: null,
  durationValue: null,
  durationUnit: 'indefinite',
  durationRaw: 'Continue indefinitely',
  indication: null,
  isNewStart: true,
  ...over,
});
const dose = (m: MedicationForCheck, r = cordizemRules) =>
  deterministicChecks(m, r).find((f) => f.field === 'dose')!;

describe('deterministic dose checks', () => {
  it('flags a new start above the standard dose against the titration schedule even though it is below max', () => {
    const f = dose(med({}));
    expect(f.verdict).toBe('conflict');
    expect(f.confidence).toBe('medium');
    expect(f.explanation).toMatch(/2 step\(s\) — at least 4 weeks/);
  });
  it('treats an undocumented start as conflict with low confidence', () => {
    expect(dose(med({ isNewStart: null }))).toMatchObject({
      verdict: 'conflict',
      confidence: 'low',
    });
  });
  it('accepts a higher dose when prior therapy is documented (within max)', () => {
    expect(dose(med({ isNewStart: false })).verdict).toBe('consistent');
  });
  it('flags any dose above the maximum with high confidence', () => {
    expect(dose(med({ doseValue: 250 }))).toMatchObject({
      verdict: 'conflict',
      confidence: 'high',
    });
  });
  it('accepts the standard dose', () => {
    expect(dose(med({ doseValue: 50 }))).toMatchObject({
      verdict: 'consistent',
      confidence: 'high',
    });
  });
  it('flags a frequency mismatch', () => {
    const f = deterministicChecks(
      med({ doseValue: 50, frequency: 'twice_daily', frequencyRaw: 'twice daily' }),
      cordizemRules,
    ).find((x) => x.field === 'frequency')!;
    expect(f.verdict).toBe('conflict');
  });
});

describe('merge: hallucination control', () => {
  const chunk: ChunkLike = {
    id: 'c-std',
    monographId: 'm1',
    fieldLabel: 'Standard adult dose',
    page: 3,
    text: 'Standard adult dose: 50 mg orally once daily, taken in the morning. May be titrated upward in increments of 25 mg at intervals of no less than two weeks based on heart rate response and blood pressure.',
  };
  const foreign: ChunkLike = {
    id: 'c-foreign',
    monographId: 'm9',
    fieldLabel: 'Maximum dose',
    page: 4,
    text: 'Maximum dose: 160 mg orally once daily.',
  };
  const passages = [
    { id: 'P1', chunk },
    { id: 'P2', chunk: foreign },
  ];

  it('rejects an LLM conflict whose quote is not in the passages', () => {
    const out = mergeFindings(
      [],
      {
        overall_explanation: '',
        fields: [
          {
            field: 'indication',
            verdict: 'conflict',
            prescribed: 'x',
            reference_constraint: 'y',
            explanation: 'made up',
            passage_id: 'P1',
            quote: 'Contraindicated in hypertension.',
          },
        ],
      },
      passages,
      [chunk],
    );
    expect(out[0]).toMatchObject({
      field: 'indication',
      verdict: 'unknown',
      quoteValid: false,
      chunkId: null,
    });
  });

  it('rejects LLM evidence quoted from a different monograph (distractor)', () => {
    const out = mergeFindings(
      [],
      {
        overall_explanation: '',
        fields: [
          {
            field: 'dose',
            verdict: 'conflict',
            prescribed: '100 mg',
            reference_constraint: '160 mg',
            explanation: 'x',
            passage_id: 'P2',
            quote: '160 mg orally once daily.',
          },
        ],
      },
      passages,
      [chunk],
    );
    expect(out[0]!.verdict).not.toBe('conflict');
  });

  it('keeps a deterministic conflict authoritative even if the model says consistent', () => {
    const det = deterministicChecks(med({}), cordizemRules);
    const out = mergeFindings(
      det,
      {
        overall_explanation: '',
        fields: [
          {
            field: 'dose',
            verdict: 'consistent',
            prescribed: '100 mg',
            reference_constraint: '≤200',
            explanation: 'below max',
            passage_id: 'P1',
            quote: '50 mg orally once daily',
          },
        ],
      },
      passages,
      [chunk],
    );
    const d = out.find((f) => f.field === 'dose')!;
    expect(d).toMatchObject({
      verdict: 'conflict',
      decidedBy: 'deterministic',
      quoteValid: true,
      chunkId: 'c-std',
    });
  });

  it('does not count an indication merely absent from the monograph list as a conflict', () => {
    const ind: ChunkLike = {
      id: 'c-ind',
      monographId: 'm1',
      fieldLabel: 'Indication',
      page: 8,
      text: 'Indication: Treatment of gastroesophageal reflux disease and peptic ulcer disease. Not for use in children under 12.',
    };
    const llmSays = (quote: string) => ({
      overall_explanation: '',
      fields: [
        {
          field: 'indication' as const,
          verdict: 'conflict' as const,
          prescribed: 'GERD prophylaxis',
          reference_constraint: 'GERD treatment',
          explanation: 'not listed',
          passage_id: 'P1',
          quote,
        },
      ],
    });
    const notListed = mergeFindings(
      [],
      llmSays('Treatment of gastroesophageal reflux disease and peptic ulcer disease.'),
      [{ id: 'P1', chunk: ind }],
      [ind],
    );
    expect(notListed[0]).toMatchObject({ verdict: 'not_addressed', quoteValid: true });
    const excluded = mergeFindings(
      [],
      llmSays('Not for use in children under 12.'),
      [{ id: 'P1', chunk: ind }],
      [ind],
    );
    expect(excluded[0]).toMatchObject({ verdict: 'conflict', quoteValid: true });
  });

  it('re-anchors a valid quote when the model mislabels the passage id', () => {
    const out = mergeFindings(
      [],
      {
        overall_explanation: '',
        fields: [
          {
            field: 'timing',
            verdict: 'consistent',
            prescribed: 'morning',
            reference_constraint: 'morning',
            explanation: 'ok',
            passage_id: 'P2',
            quote: 'taken in the morning',
          },
        ],
      },
      passages,
      [chunk],
    );
    expect(out[0]).toMatchObject({ verdict: 'consistent', chunkId: 'c-std', quoteValid: true });
  });
});
