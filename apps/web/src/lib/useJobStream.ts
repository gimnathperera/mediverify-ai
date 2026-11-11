import {
  isTerminalJobStatus,
  type JobDto,
  type JobEventDto,
  type StageDto,
} from '@mediverify/shared/client';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { qk } from './queries';

export type StreamState = 'idle' | 'connecting' | 'live' | 'reconnecting' | 'ended' | 'error';

export interface ProgressNote {
  id: string;
  stage: string | null;
  message: string;
  at: string;
}

/** Apply one persisted event to the job snapshot (pure; mirrors the server's state transitions). */
export function applyEvent(job: JobDto, e: JobEventDto): JobDto {
  if (BigInt(e.id) <= BigInt(job.lastEventId || '0')) return job; // already reflected in snapshot
  const p = e.payload;
  const stages = job.stages.map((s): StageDto => {
    if (s.stage !== e.stage) return s;
    switch (e.type) {
      case 'stage.started':
        return {
          ...s,
          status: 'running',
          startedAt: e.createdAt,
          finishedAt: null,
          durationMs: null,
          errorCode: null,
          errorMessage: null,
          detail: null,
        };
      case 'stage.completed':
        return {
          ...s,
          status: 'completed',
          finishedAt: e.createdAt,
          durationMs: (p.durationMs as number | null) ?? null,
          detail: (p.detail as string | null) ?? null,
        };
      case 'stage.failed':
        return {
          ...s,
          status: 'failed',
          finishedAt: e.createdAt,
          errorCode: (p.errorCode as string) ?? null,
          errorMessage: (p.errorMessage as string) ?? null,
        };
      case 'stage.skipped':
        return { ...s, status: 'skipped' };
      case 'job.retrying':
        return s.status === 'running' ? { ...s, status: 'pending', startedAt: null } : s;
      default:
        return s;
    }
  });
  let { status, currentStage, errorCode, errorMessage, finishedAt } = job;
  if (e.type === 'stage.started') {
    status = 'running';
    currentStage = e.stage;
  } else if (e.type === 'job.retrying') status = 'queued';
  else if (e.type === 'job.completed') {
    status = 'completed';
    finishedAt = e.createdAt;
  } else if (e.type === 'job.failed') {
    status = 'failed';
    errorCode = (p.errorCode as string) ?? null;
    errorMessage = (p.errorMessage as string) ?? null;
    finishedAt = e.createdAt;
  }
  return {
    ...job,
    stages,
    status,
    currentStage,
    errorCode,
    errorMessage,
    finishedAt,
    lastEventId: e.id,
  };
}

/** Snapshot polling interval while the live stream is not connected (fallback). */
export const POLL_FALLBACK_MS = 5000;

/**
 * Live job progress over SSE. Starts from the persisted snapshot's lastEventId, so a page refresh
 * replays nothing twice and misses nothing; EventSource reconnects automatically with Last-Event-ID.
 * If the browser gives up (e.g. a 502 while the API restarts), the hook reconnects with backoff,
 * and while the stream is not live it polls the job snapshot so progress never freezes.
 */
export function useJobStream(job: JobDto | undefined) {
  const qc = useQueryClient();
  const [state, setState] = useState<StreamState>('idle');
  // Notes are keyed by job, so a retried job never shows the previous job's log.
  const [log, setLog] = useState<{ jobId: string | null; notes: ProgressNote[] }>({
    jobId: null,
    notes: [],
  });
  const [attempt, setAttempt] = useState(0);
  const startedFor = useRef<string | null>(null);
  const jobId = job?.id;
  const terminal = job ? isTerminalJobStatus(job.status) : false;
  const fromId = job?.lastEventId ?? '0';

  useEffect(() => {
    if (!jobId || terminal || startedFor.current === jobId) return;
    startedFor.current = jobId;
    setState('connecting');
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const es = new EventSource(
      `/api/jobs/${jobId}/events?lastEventId=${encodeURIComponent(fromId)}`,
      { withCredentials: true },
    );
    es.onopen = () => setState('live');
    es.onmessage = (msg) => {
      let e: JobEventDto;
      try {
        e = JSON.parse(msg.data as string) as JobEventDto;
      } catch {
        return; // malformed message: skip it (the snapshot poll/replay will catch up)
      }
      qc.setQueryData<JobDto>(qk.job(jobId), (prev) => (prev ? applyEvent(prev, e) : prev));
      if (e.type === 'stage.progress') {
        const note = {
          id: e.id,
          stage: e.stage,
          message: typeof e.payload.message === 'string' ? e.payload.message : '',
          at: e.createdAt,
        };
        setLog((l) => ({
          jobId,
          notes: [...(l.jobId === jobId ? l.notes : []).slice(-49), note],
        }));
      }
    };
    es.addEventListener('end', () => {
      setState('ended');
      es.close();
      startedFor.current = null;
      void qc.invalidateQueries({ queryKey: qk.job(jobId) });
      void qc.invalidateQueries({ queryKey: qk.results(jobId) });
      void qc.invalidateQueries({ queryKey: qk.documents });
    });
    es.onerror = () => {
      // CONNECTING → the browser is retrying (Last-Event-ID sent automatically).
      // CLOSED → it gave up (non-200 response): reconnect ourselves with capped backoff.
      if (es.readyState !== EventSource.CLOSED) {
        setState('reconnecting');
        return;
      }
      setState('error');
      startedFor.current = null;
      retryTimer = setTimeout(
        () => setAttempt((a) => a + 1),
        Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5)),
      );
    };
    return () => {
      clearTimeout(retryTimer);
      es.close();
      startedFor.current = null;
    };
    // fromId/attempt are read once per connection: reconnects resume from the latest snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, terminal, qc, attempt]);

  // Fallback: while not live, refresh the snapshot so stage progress keeps moving.
  useEffect(() => {
    if (!jobId || terminal || state === 'live') return;
    const t = setInterval(
      () => void qc.invalidateQueries({ queryKey: qk.job(jobId) }),
      POLL_FALLBACK_MS,
    );
    return () => clearInterval(t);
  }, [jobId, terminal, state, qc]);

  return { state, notes: log.jobId === jobId ? log.notes : [] };
}
