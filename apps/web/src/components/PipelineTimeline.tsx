import { STAGE_LABELS, type JobDto } from '@mediverify/shared/client';
import { ChevronDown, Radio, WifiOff } from 'lucide-react';
import { useId, useState } from 'react';

import type { ProgressNote, StreamState } from '../lib/useJobStream';
import { cn, formatDuration, formatTime, formatUsage } from '../lib/utils';

import { JobStatusBadge, StageIcon } from './status';
import { Card } from './ui/primitives';

const STREAM_LABEL: Record<StreamState, { text: string; tone: string }> = {
  idle: { text: 'Not live', tone: 'text-slate-500' },
  connecting: { text: 'Connecting…', tone: 'text-slate-500' },
  live: { text: 'Live', tone: 'text-emerald-700' },
  reconnecting: { text: 'Reconnecting… (progress is saved on the server)', tone: 'text-amber-700' },
  ended: { text: 'Stream closed', tone: 'text-slate-500' },
  error: { text: 'Live updates unavailable — refresh to retry', tone: 'text-rose-700' },
};

export function PipelineTimeline({
  job,
  stream,
  notes,
  compact,
}: {
  job: JobDto;
  stream: StreamState;
  notes: ProgressNote[];
  compact?: boolean;
}) {
  const done = job.stages.filter((s) => s.status === 'completed').length;
  const s = STREAM_LABEL[stream];
  const running = job.stages.find((st) => st.status === 'running');
  const announcement =
    job.status === 'completed'
      ? 'Processing complete.'
      : job.status === 'failed'
        ? 'Processing failed.'
        : running
          ? `${STAGE_LABELS[running.stage]}: ${done} of ${job.stages.length} stages done.`
          : '';
  return (
    <Card className="p-4">
      {!compact && (
        <p className="sr-only" aria-live="polite" aria-atomic="true">
          {announcement}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="font-semibold text-slate-900">Processing pipeline</h2>
          <JobStatusBadge status={job.status} />
        </div>
        {job.status !== 'completed' && job.status !== 'failed' && (
          <span className={cn('inline-flex items-center gap-1 text-xs', s.tone)}>
            {stream === 'reconnecting' || stream === 'error' ? (
              <WifiOff className="h-3.5 w-3.5" aria-hidden />
            ) : (
              <Radio className="h-3.5 w-3.5" aria-hidden />
            )}
            {s.text}
          </span>
        )}
      </div>
      <div
        className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={job.stages.length}
        aria-valuenow={done}
        aria-label="Stages completed"
      >
        <div
          className={cn(
            'h-full transition-all motion-reduce:transition-none',
            job.status === 'failed' ? 'bg-rose-500' : 'bg-brand-600',
          )}
          style={{ width: `${(done / job.stages.length) * 100}%` }}
        />
      </div>
      <StageList job={job} compact={compact} className="mt-4" />
      {notes.length > 0 && !compact && (
        <details className="mt-3 text-xs text-slate-600">
          <summary className="cursor-pointer select-none">Live log ({notes.length})</summary>
          <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto font-mono">
            {notes.map((n) => (
              <li key={n.id}>
                {formatTime(n.at)} [{n.stage}] {n.message}
              </li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}

/** One row per stage: status icon, time and duration, detail, and the error of a failed stage. */
function StageList({
  job,
  compact,
  className,
}: {
  job: JobDto;
  compact?: boolean | undefined;
  className?: string;
}) {
  return (
    <ol
      className={cn('grid gap-1', compact && 'sm:grid-cols-2 xl:grid-cols-4', className)}
      aria-label="Pipeline stages"
    >
      {job.stages.map((st) => (
        <li
          key={st.stage}
          className={cn(
            'flex gap-3 rounded-lg px-2 py-2',
            st.status === 'running' && 'bg-sky-50',
            st.status === 'failed' && 'bg-rose-50',
          )}
        >
          <div className="pt-0.5">
            <StageIcon status={st.status} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <p className="text-sm font-medium text-slate-900">
                {STAGE_LABELS[st.stage]} <span className="sr-only">— {st.status}</span>
              </p>
              <p className="text-xs tabular-nums text-slate-500">
                {st.startedAt
                  ? formatTime(st.startedAt)
                  : st.status === 'skipped'
                    ? 'skipped'
                    : 'pending'}
                {st.durationMs !== null && ` · ${formatDuration(st.durationMs)}`}
              </p>
            </div>
            {st.detail && <p className="mt-0.5 text-xs text-slate-600">{st.detail}</p>}
            {st.errorMessage && (
              <p className="mt-1 text-xs font-medium text-rose-700">
                {st.errorCode}: {st.errorMessage}
              </p>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

/**
 * Finished pipeline (completed or failed) as a collapsible summary: status, stages done, total
 * time and model usage in the header; the stage list expands below. A failed pipeline opens by
 * default so the failing stage and its error are visible.
 */
export function PipelineAccordion({ job }: { job: JobDto }) {
  const failed = job.status === 'failed';
  const [open, setOpen] = useState(failed);
  const bodyId = useId();
  const done = job.stages.filter((st) => st.status === 'completed').length;
  const failedStage = job.stages.find((st) => st.status === 'failed');
  const totalMs = job.stages.reduce((n, st) => n + (st.durationMs ?? 0), 0);
  return (
    <section
      className={cn(
        'rounded-xl border bg-white text-sm',
        failed ? 'border-rose-200' : 'border-slate-200',
      )}
      aria-label="Processing pipeline"
    >
      <h2>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left transition-colors hover:bg-slate-50"
        >
          <StageIcon status={failed ? 'failed' : 'completed'} />
          <span className="min-w-0 flex-1">
            <span className="font-medium text-slate-900">
              {failed
                ? `Pipeline failed${failedStage ? ` at ${STAGE_LABELS[failedStage.stage]}` : ''}`
                : 'Pipeline completed'}
            </span>
            {/* The separator sits between the spans so the accessible name keeps its spaces. */}
            {' — '}
            <span className="text-slate-600">
              {done}/{job.stages.length} stages
              {totalMs > 0 && ` in ${formatDuration(totalMs)}`}
              {formatUsage(job.llmUsage, job.llmProvider)}
            </span>
          </span>
          <ChevronDown
            className={cn(
              'h-4 w-4 shrink-0 text-slate-500 transition-transform duration-200 motion-reduce:transition-none',
              open && 'rotate-180',
            )}
            aria-hidden
          />
        </button>
      </h2>
      {/* Height animates via grid rows (0fr → 1fr); collapsed content is inert (not focusable). */}
      <div
        id={bodyId}
        className={cn(
          'grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none',
          open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
        )}
        inert={!open}
        aria-hidden={!open || undefined}
      >
        <div className="min-h-0 overflow-hidden">
          <StageList job={job} compact className="border-t border-slate-100 px-2 py-3" />
        </div>
      </div>
    </section>
  );
}
