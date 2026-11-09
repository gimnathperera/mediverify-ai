import { readFileSync } from 'node:fs';
import path from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

import { chunkReference } from '../src/chunking/reference.js';
import { isDocx, isPdf, parsePdf } from '../src/parsing/index.js';
import type { ParsedDocument } from '../src/parsing/types.js';
import { findMedicationTable } from '../src/tasks/entities.js';

const ROOT = path.resolve(import.meta.dirname, '../../..');
let primary: ParsedDocument;
let reference: ParsedDocument;

beforeAll(async () => {
  primary = await parsePdf(readFileSync(path.join(ROOT, 'resources/primary_document_medical.pdf')));
  reference = await parsePdf(
    readFileSync(path.join(ROOT, 'resources/reference_document_medical.pdf')),
  );
});

describe('PDF table reconstruction (primary)', () => {
  it('finds the medication table on page 3 with semantic headers', () => {
    const t = findMedicationTable(primary)!;
    expect(t).not.toBeNull();
    expect(t.col).toMatchObject({
      name: 'Medication',
      dose: 'Dose',
      route: 'Route / Frequency',
      duration: 'Duration',
      indication: 'Indication',
    });
    expect(t.rows.every((r) => r.page === 3)).toBe(true);
  });

  it('keeps row/column meaning, including multi-line cells', () => {
    const rows = findMedicationTable(primary)!.rows.map((r) => r.cells);
    expect(rows).toEqual([
      {
        Medication: 'Velantine',
        Dose: '10 mg',
        'Route / Frequency': 'PO once daily',
        Duration: 'Continue indefinitely',
        Indication: 'Hypertension',
      },
      {
        Medication: 'Cordizem-XR',
        Dose: '100 mg',
        'Route / Frequency': 'PO once daily',
        Duration: 'Continue indefinitely',
        Indication: 'Rate control, hypertension',
      },
      {
        Medication: 'Pravoxil',
        Dose: '20 mg',
        'Route / Frequency': 'PO every morning',
        Duration: 'Continue indefinitely',
        Indication: 'Hyperlipidemia',
      },
      {
        Medication: 'Etrazolam',
        Dose: '0.5 mg',
        'Route / Frequency': 'PO twice daily',
        Duration: '8 weeks',
        Indication: 'Acute anxiety, sleep disturbance',
      },
      {
        Medication: 'Pranixol',
        Dose: '10 mg',
        'Route / Frequency': 'PO once daily',
        Duration: 'Continue indefinitely',
        Indication: 'Adjunctive cardiovascular protection',
      },
      {
        Medication: 'Quintaxin',
        Dose: '20 mg',
        'Route / Frequency': 'PO once daily, before breakfast',
        Duration: '8 weeks, reassess',
        Indication: 'GERD prophylaxis',
      },
    ]);
  });

  it('reconstructs the same table from a LibreOffice-converted DOCX (tight gutters, wrapped cells)', async () => {
    const converted = await parsePdf(
      readFileSync(path.join(ROOT, 'fixtures/sample_discharge.libreoffice.pdf')),
    );
    const rows = findMedicationTable(converted)!.rows.map((r) => r.cells);
    expect(rows).toEqual(
      findMedicationTable(primary)!
        .rows.map((r) => ({ ...r.cells }))
        .map((c) => ({ ...c })),
    );
  });

  it('sniffs DOCX and PDF by magic bytes', () => {
    expect(isDocx(readFileSync(path.join(ROOT, 'fixtures/sample_discharge.docx')))).toBe(true);
    expect(isPdf(readFileSync(path.join(ROOT, 'fixtures/sample_discharge.docx')))).toBe(false);
    expect(isDocx(readFileSync(path.join(ROOT, 'resources/primary_document_medical.pdf')))).toBe(
      false,
    );
  });

  it('merges a sentence that continues across a page break', () => {
    const notes = primary.blocks.find((b) => b.label === 'Notes on regimen')!;
    expect(notes.page).toBe(3);
    expect(notes.pageEnd).toBe(4);
    expect(notes.text).toMatch(/adjunctive cardiovascular protection\. Quintaxin was added/);
  });
});

describe('monograph-aware chunking (reference)', () => {
  it('finds exactly the 8 monographs with their headings, sections and pages', () => {
    const { monographs } = chunkReference(reference);
    expect(monographs.map((m) => [m.name, m.pageStart])).toEqual([
      ['Velantine', 2],
      ['Cordizem-XR', 3],
      ['Mirosartan', 4],
      ['Pravoxil', 5],
      ['Etrazolam', 6],
      ['Sumavast', 7],
      ['Quintaxin', 8],
      ['Floranase', 9],
    ]);
    expect(monographs.find((m) => m.name === 'Etrazolam')!.sectionTitle).toBe(
      'III. Anxiolytics and Sedatives',
    );
  });

  it('keeps each monograph whole in a parent chunk and gives field chunks the same monograph key', () => {
    const { chunks } = chunkReference(reference);
    const parent = chunks.find(
      (c) => c.kind === 'monograph' && c.medicationNameNormalized === 'cordizem-xr',
    )!;
    expect(parent.text).toMatch(/^Cordizem-XR\nDrug class:/);
    expect(parent.text).toMatch(/Maximum dose: 200 mg/);
    const fields = chunks.filter(
      (c) => c.kind === 'field' && c.monographKey === parent.monographKey,
    );
    expect(fields.map((f) => f.fieldLabel)).toContain('Standard adult dose');
    expect(fields.every((f) => f.embedText.startsWith('Cordizem-XR — '))).toBe(true);
  });

  it('classifies the quick-reference summary and coverage note as non-monograph chunks', () => {
    const { chunks } = chunkReference(reference);
    const coverage = chunks.filter((c) => c.kind === 'coverage');
    expect(coverage).toHaveLength(1);
    expect(coverage[0]!.text).toMatch(
      /Do not infer prescribing parameters for unlisted medications/,
    );
    expect(chunks.filter((c) => c.kind === 'summary').every((c) => c.monographKey === null)).toBe(
      true,
    );
  });

  it('parses deterministic prescribing rules with verbatim evidence', () => {
    const byName = Object.fromEntries(
      chunkReference(reference).monographs.map((m) => [m.name, m.rules]),
    );
    expect(byName['Cordizem-XR']!.titration).toMatchObject({
      incrementValue: 25,
      minIntervalWeeks: 2,
    });
    expect(byName['Cordizem-XR']!.maxDose?.value).toBe(200);
    expect(byName.Pravoxil!.requiredTiming?.timing).toBe('bedtime');
    expect(byName.Pravoxil!.forbiddenTimings.map((f) => f.timing)).toEqual(['morning']);
    expect(byName.Etrazolam!.maxDurationWeeks?.value).toBe(4);
    expect(byName.Etrazolam!.maxDurationWeeks?.evidence.quote).toMatch(/must not initiate/);
    expect(byName.Etrazolam!.maxDailyDose?.value).toBe(2);
    expect(byName.Quintaxin!.reassessmentWeeks?.value).toBe(8);
    expect(byName.Quintaxin!.requiredTiming?.timing).toBe('before_breakfast');
  });
});
