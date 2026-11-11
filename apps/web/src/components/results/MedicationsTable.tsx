import type { MedicationDto } from '@mediverify/shared/client';
import { AlertTriangle, FileSearch } from 'lucide-react';
import type * as React from 'react';

import { Card, EmptyState } from '../ui/primitives';

const HEADERS = [
  'Medication',
  'Dose',
  'Route',
  'Frequency',
  'Timing',
  'Duration',
  'Indication',
  'Source',
];

const Missing = ({ label = '—' }: { label?: string }) => (
  <span className="text-slate-500">
    {label}
    {label === '—' && <span className="sr-only">not stated</span>}
  </span>
);

export function MedicationsTable({
  medications,
  onShowPrimaryQuote,
}: {
  medications: MedicationDto[];
  onShowPrimaryQuote: (page: number | null, quote: string) => void;
}) {
  if (medications.length === 0)
    return (
      <EmptyState icon={<FileSearch className="h-8 w-8" />} title="No medications extracted" />
    );

  const cell = (v: React.ReactNode) => <td className="px-3 py-2">{v ?? <Missing />}</td>;
  return (
    <Card className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-left text-sm">
        <caption className="sr-only">Medications extracted from the uploaded document</caption>
        <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
          <tr>
            {HEADERS.map((h) => (
              <th key={h} scope="col" className="px-3 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {medications.map((m) => (
            <tr key={m.id} className="align-top">
              <th scope="row" className="px-3 py-2 font-medium text-slate-900">
                {m.drugName}
                {m.ambiguities.length > 0 && (
                  <span
                    className="ml-1 inline-flex align-middle text-amber-700"
                    title={m.ambiguities.join('\n')}
                  >
                    <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
                    <span className="sr-only">Ambiguities: {m.ambiguities.join('; ')}</span>
                  </span>
                )}
              </th>
              {cell(
                m.doseValue !== null ? (
                  `${m.doseValue} ${m.doseUnit ?? ''}`.trim()
                ) : (
                  <Missing label="not stated" />
                ),
              )}
              {cell(m.route)}
              {cell(m.frequencyRaw)}
              {cell(m.timing?.replaceAll('_', ' '))}
              {cell(m.durationRaw)}
              {cell(m.indication)}
              {cell(
                m.sourceQuote ? (
                  <button
                    type="button"
                    className="text-brand-700 hover:underline"
                    onClick={() => onShowPrimaryQuote(m.sourcePage, m.sourceQuote!)}
                  >
                    p.{m.sourcePage ?? '?'}
                    <span className="sr-only">
                      {' '}
                      — show {m.drugName} prescription in the document
                    </span>
                  </button>
                ) : null,
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
