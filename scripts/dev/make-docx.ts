/**
 * Generates fixtures/sample_discharge.docx — a DOCX rendition of the provided (PDF-only) discharge
 * summary, used to exercise the DOCX → PDF (LibreOffice) → parse path. Content copied from the PDF.
 */
import { writeFile } from 'node:fs/promises';

import {
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';

const p = (text: string) =>
  new Paragraph({ children: [new TextRun(text)], spacing: { after: 120 } });
const h = (text: string) => new Paragraph({ text, heading: HeadingLevel.HEADING_1 });
const labeled = (label: string, text: string) =>
  new Paragraph({ children: [new TextRun({ text: `${label}: `, bold: true }), new TextRun(text)] });

const rows = [
  ['Medication', 'Dose', 'Route / Frequency', 'Duration', 'Indication'],
  ['Velantine', '10 mg', 'PO once daily', 'Continue indefinitely', 'Hypertension'],
  ['Cordizem-XR', '100 mg', 'PO once daily', 'Continue indefinitely', 'Rate control, hypertension'],
  ['Pravoxil', '20 mg', 'PO every morning', 'Continue indefinitely', 'Hyperlipidemia'],
  ['Etrazolam', '0.5 mg', 'PO twice daily', '8 weeks', 'Acute anxiety, sleep disturbance'],
  [
    'Pranixol',
    '10 mg',
    'PO once daily',
    'Continue indefinitely',
    'Adjunctive cardiovascular protection',
  ],
  [
    'Quintaxin',
    '20 mg',
    'PO once daily, before breakfast',
    '8 weeks, reassess',
    'GERD prophylaxis',
  ],
];

const table = new Table({
  width: { size: 100, type: WidthType.PERCENTAGE },
  rows: rows.map(
    (r, i) =>
      new TableRow({
        children: r.map(
          (c) =>
            new TableCell({
              children: [new Paragraph({ children: [new TextRun({ text: c, bold: i === 0 })] })],
            }),
        ),
      }),
  ),
});

const doc = new Document({
  sections: [
    {
      children: [
        new Paragraph({ text: 'MERIDIAN BAY MEDICAL CENTER', heading: HeadingLevel.TITLE }),
        p('FICTIONAL DOCUMENT — FOR SOFTWARE TESTING ONLY. Not real medical guidance.'),
        labeled('Patient', 'Daniel Okonkwo, 58-year-old male'),
        labeled('Discharge date', 'March 11, 2026'),
        h('1. Reason for Admission'),
        p(
          'Mr. Okonkwo presented with progressive dyspnea on exertion, intermittent palpitations, and one episode of chest tightness. Initial ECG demonstrated atrial fibrillation with rapid ventricular response.',
        ),
        h('4. Discharge Medications'),
        p('The following regimen was prescribed at discharge.'),
        table,
        h('5. Counseling and Warnings Reviewed with Patient'),
        p('• Pravoxil should be taken in the morning with breakfast for best tolerability.'),
        p('• Quintaxin should be taken thirty minutes before breakfast for optimal effect.'),
        h('6. Follow-Up'),
        p(
          'The patient was instructed to follow up with primary care within seven days of discharge.',
        ),
      ],
    },
  ],
});

await writeFile('fixtures/sample_discharge.docx', await Packer.toBuffer(doc));
console.log('wrote fixtures/sample_discharge.docx');
