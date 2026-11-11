import type { VerificationDto } from '@mediverify/shared/client';
import { AlertTriangle, ArrowRight } from 'lucide-react';

import { VerificationBadge } from '../status';
import { Card } from '../ui/primitives';

import { FIELD_LABEL, REASON_LABEL } from './labels';

/** One line explaining why a medication needs a reviewer's attention. */
function reasonLine(v: VerificationDto): string {
  if (v.status === 'contradicted') {
    const conflicts = v.findings.filter((f) => f.verdict === 'conflict');
    const lowest = conflicts.some((f) => f.confidence === 'low')
      ? 'low'
      : conflicts.some((f) => f.confidence === 'medium')
        ? 'medium'
        : 'high';
    return `Conflicts on ${conflicts.map((f) => FIELD_LABEL[f.field].toLowerCase()).join(', ')} (${lowest} confidence)`;
  }
  if (v.status === 'unsupported')
    return 'Not in this formulary — a coverage gap, not proof of an error';
  const gaps = v.findings.filter(
    (f) => f.verdict !== 'consistent' && f.reason && f.reason !== 'not_constrained',
  );
  return gaps.length
    ? `Not confirmed: ${gaps.map((f) => `${FIELD_LABEL[f.field].toLowerCase()} (${REASON_LABEL[f.reason!]})`).join(', ')}`
    : v.summary;
}

const PRIORITY = { contradicted: 0, incomplete: 1, unsupported: 2, supported: 3 } as const;

/**
 * What a reviewer must look at, without expanding any card: confirmed conflicts first, then checks
 * that could not be completed, then coverage gaps. Each row jumps to its card.
 */
export function NeedsAttention({
  verifications,
  onShowVerification,
}: {
  verifications: VerificationDto[];
  onShowVerification: (verificationId: string) => void;
}) {
  const items = verifications
    .filter((v) => v.status !== 'supported')
    .sort((a, b) => PRIORITY[a.status] - PRIORITY[b.status]);
  if (items.length === 0) return null;
  return (
    <Card className="border-amber-200 p-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
        <AlertTriangle className="h-4 w-4 text-amber-600" aria-hidden />
        Needs attention
        <span className="font-normal text-slate-600">
          · {items.length} of {verifications.length} medications
        </span>
      </h3>
      <ul className="mt-2 divide-y divide-slate-100" aria-label="Medications needing attention">
        {items.map((v) => (
          <li key={v.id}>
            <button
              type="button"
              onClick={() => onShowVerification(v.id)}
              className="flex w-full items-start gap-3 rounded-md px-1 py-2 text-left text-sm hover:bg-slate-50"
            >
              <VerificationBadge status={v.status} />
              <span className="min-w-0 flex-1">
                <span className="font-medium text-slate-900">{v.drugName}</span>
                <span className="block text-xs text-slate-600">{reasonLine(v)}</span>
              </span>
              <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-slate-400" aria-hidden />
              <span className="sr-only">Show {v.drugName} details</span>
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}
