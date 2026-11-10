import type {
  CitationDto,
  FindingDto,
  MedicationDto,
  VerificationDto,
  VerificationStatus,
} from '@mediverify/shared';
import { ChevronDown, FileSearch, Quote, X } from 'lucide-react';
import { useState } from 'react';

import { cn } from '../../lib/utils';
import { VERIFICATION_META, VerificationBadge } from '../status';
import { Button, Card, EmptyState } from '../ui/primitives';

import {
  FIELD_LABEL,
  prescribedLine,
  STATUS_ACCENT,
  STATUS_ORDER,
  STATUS_SURFACE,
  VERDICT_STYLE,
  verificationAnchor,
} from './labels';

export type OnCite = (c: CitationDto, heading: string) => void;

export function VerificationPanel({
  verifications,
  medications,
  filter,
  onFilterChange,
  onCite,
}: {
  verifications: VerificationDto[];
  medications: MedicationDto[];
  filter: VerificationStatus | null;
  onFilterChange: (s: VerificationStatus | null) => void;
  onCite: OnCite;
}) {
  const medById = new Map(medications.map((m) => [m.id, m]));
  const counts = new Map<VerificationStatus, number>();
  for (const v of verifications) counts.set(v.status, (counts.get(v.status) ?? 0) + 1);
  const visible = filter ? [filter] : STATUS_ORDER;

  return (
    <div className="space-y-4">
      <div
        className="grid grid-cols-2 gap-2 sm:grid-cols-4"
        role="group"
        aria-label="Filter by status"
      >
        {STATUS_ORDER.map((s) => {
          const m = VERIFICATION_META[s];
          const Icon = m.icon;
          const n = counts.get(s) ?? 0;
          const active = filter === s;
          return (
            <button
              key={s}
              type="button"
              aria-pressed={active}
              disabled={n === 0}
              onClick={() => onFilterChange(active ? null : s)}
              className={cn(
                'rounded-lg border p-3 text-left transition-shadow focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 enabled:cursor-pointer enabled:hover:shadow-md disabled:opacity-60',
                STATUS_SURFACE[s],
                active && 'ring-2 ring-brand-600',
              )}
            >
              <span className="flex items-center gap-1 text-xs font-medium text-slate-700">
                <Icon className="h-3.5 w-3.5" aria-hidden />
                {m.label}
                <span className="sr-only">{': '}</span>
              </span>
              <span className="block text-2xl font-semibold tabular-nums text-slate-900">
                {n}
                <span className="sr-only"> medication{n === 1 ? '' : 's'}</span>
              </span>
            </button>
          );
        })}
      </div>

      {filter && (
        <div className="flex items-center justify-between gap-2 rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700">
          <span>
            Showing only <strong>{VERIFICATION_META[filter].label.toLowerCase()}</strong>{' '}
            medications.
          </span>
          <Button variant="ghost" size="sm" onClick={() => onFilterChange(null)}>
            <X className="h-3.5 w-3.5" aria-hidden /> Show all
          </Button>
        </div>
      )}

      {verifications.length === 0 && (
        <EmptyState icon={<FileSearch className="h-8 w-8" />} title="No medications were verified">
          No prescribed medications were extracted from this document.
        </EmptyState>
      )}

      {visible.map((s) => {
        const items = verifications.filter((v) => v.status === s);
        if (!items.length) return null;
        return (
          <section key={s} aria-labelledby={`sec-${s}`} className="space-y-3">
            <h3
              id={`sec-${s}`}
              className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-800"
            >
              <VerificationBadge status={s} />
              <span className="font-normal text-slate-600">{VERIFICATION_META[s].help}</span>
            </h3>
            {items.map((v) => (
              <VerificationCard
                key={v.id}
                v={v}
                med={medById.get(v.medicationId)}
                onCite={onCite}
              />
            ))}
          </section>
        );
      })}
    </div>
  );
}

export function VerificationCard({
  v,
  med,
  onCite,
}: {
  v: VerificationDto;
  med: MedicationDto | undefined;
  onCite: OnCite;
}) {
  const [open, setOpen] = useState(v.status !== 'supported');
  const conflicts = v.findings.filter((f) => f.verdict === 'conflict');
  const others = v.findings.filter((f) => f.verdict !== 'conflict');
  const titleId = `${verificationAnchor(v.id)}-title`;
  return (
    <Card
      id={verificationAnchor(v.id)}
      tabIndex={-1}
      aria-labelledby={titleId}
      role="article"
      className={cn(
        'scroll-mt-24 border-l-4 p-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600',
        STATUS_ACCENT[v.status],
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h4 id={titleId} className="font-semibold text-slate-900">
            {v.drugName}
          </h4>
          <p className="text-xs text-slate-600">Prescribed: {prescribedLine(med) || '—'}</p>
        </div>
        <VerificationBadge status={v.status} />
      </div>
      <p className="mt-2 text-sm text-slate-700">{v.summary}</p>

      {v.status === 'unsupported' && (
        <div className="mt-3 space-y-2">
          {v.similarNames.length > 0 && (
            <p className="text-xs text-amber-900">
              Similar-looking monograph name(s) not treated as a match: {v.similarNames.join(', ')}.
            </p>
          )}
          {v.coverageCitation ? (
            <button
              type="button"
              className="inline-flex items-center gap-1 text-left text-sm text-brand-700 hover:underline"
              onClick={() => onCite(v.coverageCitation!, `${v.drugName}: reference coverage note`)}
            >
              <Quote className="h-4 w-4 shrink-0" aria-hidden /> Reference coverage note (
              {v.coverageCitation.section}, p.{v.coverageCitation.page})
            </button>
          ) : (
            <p className="text-xs text-slate-600">No supporting passage exists in the reference.</p>
          )}
        </div>
      )}

      {conflicts.length > 0 && (
        <ul className="mt-3 space-y-2" aria-label={`${v.drugName} conflicts`}>
          {conflicts.map((f) => (
            <FindingRow key={f.id} f={f} drug={v.drugName} onCite={onCite} />
          ))}
        </ul>
      )}
      {others.length > 0 && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="inline-flex items-center gap-1 text-xs font-medium text-slate-700 hover:text-slate-900"
            aria-expanded={open}
            aria-controls={`${verificationAnchor(v.id)}-checks`}
          >
            <ChevronDown
              className={cn(
                'h-4 w-4 transition-transform motion-reduce:transition-none',
                open && 'rotate-180',
              )}
              aria-hidden
            />
            {open ? 'Hide' : 'Show'} {others.length} other check{others.length === 1 ? '' : 's'}
          </button>
          <ul id={`${verificationAnchor(v.id)}-checks`} hidden={!open} className="mt-2 space-y-2">
            {others.map((f) => (
              <FindingRow key={f.id} f={f} drug={v.drugName} onCite={onCite} />
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

function FindingRow({ f, drug, onCite }: { f: FindingDto; drug: string; onCite: OnCite }) {
  const st = VERDICT_STYLE[f.verdict];
  return (
    <li
      className={cn(
        'rounded-lg border p-3 text-sm',
        f.verdict === 'conflict' ? 'border-rose-200 bg-rose-50/50' : 'border-slate-200',
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-slate-900">{FIELD_LABEL[f.field]}</span>
        <span className={cn('rounded px-1.5 py-0.5 text-xs font-medium', st.cls)}>{st.label}</span>
        <span className="text-xs text-slate-600">
          by {f.decidedBy} · {f.confidence} confidence
        </span>
      </div>
      {(f.prescribedValue || f.referenceConstraint) && (
        <dl className="mt-1 grid gap-x-3 text-xs text-slate-700 sm:grid-cols-[auto_1fr]">
          {f.prescribedValue && (
            <>
              <dt className="text-slate-500">Prescribed</dt>
              <dd>{f.prescribedValue}</dd>
            </>
          )}
          {f.referenceConstraint && (
            <>
              <dt className="text-slate-500">Reference</dt>
              <dd>{f.referenceConstraint}</dd>
            </>
          )}
        </dl>
      )}
      <p className="mt-1 text-slate-700">{f.explanation}</p>
      {f.citation && (
        <button
          type="button"
          onClick={() => onCite(f.citation!, `${drug}: ${FIELD_LABEL[f.field]}`)}
          className={cn(
            'mt-2 inline-flex items-start gap-1 text-left text-xs hover:underline',
            f.citation.quoteValid ? 'text-brand-700' : 'text-rose-700',
          )}
        >
          <Quote className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>
            {[f.citation.monographName, f.citation.fieldLabel].filter(Boolean).join(' › ')}, p.
            {f.citation.page}: “
            {f.citation.quote.length > 140
              ? `${f.citation.quote.slice(0, 140)}…`
              : f.citation.quote}
            ”{!f.citation.quoteValid && ' (evidence rejected)'}
          </span>
        </button>
      )}
    </li>
  );
}
