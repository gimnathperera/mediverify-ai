import type { ResultsDto } from '@mediverify/shared/client';

import { modelLabel } from '../../lib/messages';
import { Alert, Badge, Card } from '../ui/primitives';

export function SummaryCard({
  summary,
  llm,
}: {
  summary: ResultsDto['summary'];
  llm: ResultsDto['llm'];
}) {
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold text-slate-900">Summary</h2>
        {llm && (
          <Badge tone={llm.provider === 'fixture' ? 'warning' : 'neutral'}>{modelLabel(llm)}</Badge>
        )}
      </div>
      {summary ? (
        <>
          <p className="mt-2 text-sm leading-relaxed text-slate-700">{summary.text}</p>
          {summary.warnings.length > 0 && (
            <Alert tone="warning" title="Faithfulness check warnings" className="mt-3">
              <ul className="list-disc pl-5">
                {summary.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </Alert>
          )}
        </>
      ) : (
        <p className="mt-2 text-sm text-slate-500">No summary was produced for this job.</p>
      )}
      <p className="mt-3 text-xs text-slate-500">
        Generated only from the uploaded document. It does not include formulary corrections.
      </p>
    </Card>
  );
}
