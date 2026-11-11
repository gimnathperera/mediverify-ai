import type { FindingDto } from '@mediverify/shared/client';
import { Check, HelpCircle, Minus, X } from 'lucide-react';

import { cn } from '../../lib/utils';

import { FIELD_LABEL, REASON_LABEL, STRIP_FIELDS } from './labels';

function chip(f: FindingDto | undefined) {
  if (!f)
    return { icon: Minus, cls: 'border-slate-200 bg-white text-slate-500', text: 'not checked' };
  if (f.verdict === 'conflict')
    return { icon: X, cls: 'border-rose-200 bg-rose-50 text-rose-800', text: 'conflict' };
  if (f.verdict === 'consistent')
    return {
      icon: Check,
      cls:
        f.confidence === 'low'
          ? 'border-amber-200 bg-amber-50 text-amber-900'
          : 'border-emerald-200 bg-emerald-50 text-emerald-800',
      text: f.confidence === 'low' ? 'consistent (low confidence)' : 'consistent',
    };
  if (f.reason === 'not_constrained')
    return {
      icon: Minus,
      cls: 'border-slate-200 bg-slate-50 text-slate-600',
      text: REASON_LABEL.not_constrained,
    };
  return {
    icon: HelpCircle,
    cls: 'border-amber-200 bg-amber-50 text-amber-900',
    text: f.reason ? REASON_LABEL[f.reason] : 'not verified',
  };
}

/** Every prescribing parameter's outcome at a glance, so nothing has to be expanded to be seen. */
export function FindingStrip({ findings }: { findings: FindingDto[] }) {
  return (
    <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Checks by parameter">
      {STRIP_FIELDS.map((field) => {
        const c = chip(findings.find((f) => f.field === field));
        const Icon = c.icon;
        return (
          <li
            key={field}
            title={`${FIELD_LABEL[field]}: ${c.text}`}
            className={cn(
              'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium',
              c.cls,
            )}
          >
            <Icon className="h-3 w-3" aria-hidden />
            {FIELD_LABEL[field]}
            <span className="sr-only">: {c.text}</span>
          </li>
        );
      })}
    </ul>
  );
}
