import { describe, expect, it } from 'vitest';

import type { MedicationForCheck } from '../src/verification/deterministic.js';
import { fieldQueries, retrieveEvidence, rrfFuse } from '../src/verification/retrieval.js';

const med: MedicationForCheck = {
  drugName: 'Pravoxil',
  doseValue: 20,
  doseUnit: 'mg',
  doseRaw: '20 mg',
  route: 'oral',
  frequency: 'once_daily',
  frequencyRaw: 'once daily',
  timing: 'morning',
  durationValue: null,
  durationUnit: 'indefinite',
  durationRaw: 'Continue indefinitely',
  indication: 'Hyperlipidemia',
  isNewStart: true,
};

const chunk = (id: string, fieldLabel: string, vectorScore: number, textScore: number) => ({
  id,
  monographId: 'm1',
  fieldLabel,
  page: 5,
  text: fieldLabel,
  vectorScore,
  textScore,
});

describe('retrieval', () => {
  it('builds one query per prescribing aspect', () => {
    expect(fieldQueries(med).map((q) => q.aspect)).toEqual([
      'dose',
      'schedule',
      'duration',
      'indication',
    ]);
  });

  it('fuses rankings with reciprocal rank (agreement beats a single top rank)', () => {
    const s = rrfFuse([
      ['a', 'b', 'c'],
      ['b', 'a', 'c'],
      ['b', 'c', 'a'],
    ]);
    expect([...s.entries()].sort((x, y) => y[1] - x[1])[0]![0]).toBe('b');
  });

  it('keeps the best similarity per chunk and always includes contraindications', async () => {
    const rows = [
      chunk('dose', 'Standard adult dose', 0.9, 0.5),
      chunk('notes', 'Prescribing notes', 0.8, 0.2),
      chunk('max', 'Maximum dose', 0.7, 0.1),
      chunk('contra', 'Contraindications', 0.3, 0),
    ];
    const out = await retrieveEvidence({
      med,
      topK: 2,
      embed: () => Promise.resolve([0]),
      rank: () => Promise.resolve(rows),
    });
    expect(out.chunks.map((c) => c.id)).toEqual(['dose', 'notes', 'contra']);
    expect(out.chunks[0]!.vectorScore).toBe(0.9);
  });
});
