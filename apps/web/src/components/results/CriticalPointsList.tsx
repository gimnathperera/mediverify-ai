import type { CriticalPointDto, VerificationDto } from '@mediverify/shared';
import { AlertTriangle, ArrowRight, FileSearch, Quote } from 'lucide-react';

import { cn } from '../../lib/utils';
import { VERIFICATION_META, VerificationBadge } from '../status';
import { Badge, Card, EmptyState } from '../ui/primitives';

import { CATEGORY_LABEL } from './labels';

const SEVERITY_TONE = { high: 'danger', medium: 'info', low: 'neutral' } as const;

export function CriticalPointsList({
  points,
  verifications,
  onShowPrimaryQuote,
  onShowVerification,
}: {
  points: CriticalPointDto[];
  verifications: VerificationDto[];
  onShowPrimaryQuote: (page: number | null, quote: string) => void;
  onShowVerification: (verificationId: string) => void;
}) {
  const byDrug = new Map(verifications.map((v) => [v.drugName.toLowerCase(), v]));
  if (points.length === 0)
    return (
      <EmptyState icon={<FileSearch className="h-8 w-8" />} title="No critical points found" />
    );

  return (
    <>
      <ol className="space-y-2">
        {points.map((p) => {
          const v = p.relatedMedication ? byDrug.get(p.relatedMedication.toLowerCase()) : undefined;
          const discrepancy = p.category === 'document_discrepancy';
          return (
            <li key={p.id}>
              <Card className={cn('p-4', discrepancy && 'border-amber-300')}>
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 text-xs font-semibold text-white"
                    aria-label={`Rank ${p.rank}`}
                  >
                    {p.rank}
                  </span>
                  <Badge tone={SEVERITY_TONE[p.severity]}>{p.severity} severity</Badge>
                  <Badge tone={discrepancy ? 'warning' : 'neutral'}>
                    {discrepancy && <AlertTriangle className="h-3 w-3" aria-hidden />}
                    {CATEGORY_LABEL[p.category]}
                  </Badge>
                  {p.relatedMedication && <Badge tone="brand">{p.relatedMedication}</Badge>}
                  {v && v.status !== 'supported' && (
                    <button
                      type="button"
                      onClick={() => onShowVerification(v.id)}
                      className="inline-flex items-center gap-1 rounded-full text-xs text-slate-600 hover:text-slate-900"
                      aria-label={`Formulary check: ${VERIFICATION_META[v.status].label} — show ${v.drugName} verification`}
                    >
                      Formulary check: <VerificationBadge status={v.status} />
                      <ArrowRight className="h-3 w-3" aria-hidden />
                    </button>
                  )}
                </div>
                <p className="mt-2 text-sm text-slate-800">{p.text}</p>
                <ul className="mt-2 space-y-1" aria-label="Sources in the uploaded document">
                  {p.sources.map((s, i) => (
                    <li key={i}>
                      <button
                        type="button"
                        onClick={() => onShowPrimaryQuote(s.page, s.quote)}
                        className="flex w-full items-start gap-2 rounded-md px-2 py-1 text-left text-xs text-slate-600 hover:bg-slate-50"
                      >
                        <Quote className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                        <span>
                          <span className="font-medium text-slate-700">
                            Primary doc p.{s.page ?? '?'}:
                          </span>{' '}
                          “{s.quote}”
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </Card>
            </li>
          );
        })}
      </ol>
      <p className="mt-3 text-xs text-slate-500">
        Ranked by severity, then category (serious side effects → document inconsistencies → timing
        → duration → safety → follow-up). Restated from the uploaded document only.
      </p>
    </>
  );
}
