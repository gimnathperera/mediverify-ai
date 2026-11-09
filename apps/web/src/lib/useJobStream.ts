import {
  isTerminalJobStatus,
  type JobDto,
  type JobEventDto,
  type StageDto,
} from '@mediverify/shared';
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

/**
 * Live job progress over SSE. Starts from the persisted snapshot's lastEventId, so a page refresh
 * replays nothing twice and misses nothing; EventSource reconnects automatically with Last-Event-ID.
 */
export function useJobStream(job: JobDto | undefined) {
  const qc = useQueryClient();
  const [state, setState] = useState<StreamState>('idle');
  const [notes, setNotes] = useState<ProgressNote[]>([]);
  const startedFor = useRef<string | null>(null);
  const jobId = job?.id;
  const terminal = job ? isTerminalJobStatus(job.status) : false;
  const fromId = job?.lastEventId ?? '0';

  useEffect(() => {
    if (!jobId || terminal || startedFor.current === jobId) return;
    startedFor.current = jobId;
    setState('connecting');
    const es = new EventSource(
      `/api/jobs/${jobId}/events?lastEventId=${encodeURIComponent(fromId)}`,
      { withCredentials: true },
    );
    es.onopen = () => setState('live');
    es.onmessage = (msg) => {
      const e = JSON.parse(msg.data as string) as JobEventDto;
      qc.setQueryData<JobDto>(qk.job(jobId), (prev) => (prev ? applyEvent(prev, e) : prev));
      if (e.type === 'stage.progress') {
        setNotes((n) => [
          ...n.slice(-49),
          {
            id: e.id,
            stage: e.stage,
            message: typeof e.payload.message === 'string' ? e.payload.message : '',
            at: e.createdAt,
          },
        ]);
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
      // CONNECTING → browser is retrying (Last-Event-ID sent automatically). CLOSED → gave up (e.g. 401/404).
      setState(es.readyState === EventSource.CLOSED ? 'error' : 'reconnecting');
      if (es.readyState === EventSource.CLOSED) startedFor.current = null;
    };
    return () => {
      es.close();
      startedFor.current = null;
    };
    // fromId intentionally read once per connection: reconnects use the browser's Last-Event-ID.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, terminal, qc]);

  return { state, notes };
}
