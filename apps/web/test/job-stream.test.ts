import { STAGES, type JobDto, type JobEventDto } from '@mediverify/shared/client';
import { describe, expect, it } from 'vitest';

import { applyEvent } from '../src/lib/useJobStream';

const JOB = '00000000-0000-4000-8000-000000000001';

function snapshot(lastEventId = '10'): JobDto {
  return {
    id: JOB,
    documentId: '00000000-0000-4000-8000-000000000002',
    status: 'queued',
    currentStage: null,
    attempts: 0,
    maxAttempts: 3,
    errorCode: null,
    errorMessage: null,
    createdAt: '2026-11-10T00:00:00Z',
    startedAt: null,
    finishedAt: null,
    lastEventId,
    llmProvider: 'fixture',
    llmUsage: { calls: 0, promptTokens: 0, completionTokens: 0, costUsd: null },
    stages: STAGES.map((stage, ordinal) => ({
      stage,
      ordinal,
      status: 'pending' as const,
      startedAt: null,
      finishedAt: null,
      durationMs: null,
      errorCode: null,
      errorMessage: null,
      detail: null,
    })),
  };
}

let seq = 10;
const ev = (
  type: string,
  stage: JobEventDto['stage'],
  payload: Record<string, unknown> = {},
): JobEventDto => ({
  id: String(++seq),
  jobId: JOB,
  stage,
  type,
  payload,
  createdAt: `2026-11-10T00:00:${String(seq).padStart(2, '0')}Z`,
});
const stageOf = (j: JobDto, name: string) => j.stages.find((s) => s.stage === name)!;

describe('applyEvent (live progress reducer)', () => {
  it('advances a stage from running to completed with duration and detail', () => {
    let j = applyEvent(snapshot(), ev('stage.started', 'parsed'));
    expect(j.status).toBe('running');
    expect(j.currentStage).toBe('parsed');
    expect(stageOf(j, 'parsed').status).toBe('running');
    j = applyEvent(j, ev('stage.completed', 'parsed', { durationMs: 270, detail: '5 pages' }));
    expect(stageOf(j, 'parsed')).toMatchObject({
      status: 'completed',
      durationMs: 270,
      detail: '5 pages',
    });
    expect(j.lastEventId).toBe(String(seq));
  });

  it('ignores events already contained in the snapshot (refresh / reconnect replay)', () => {
    const snap = applyEvent(snapshot('10'), ev('stage.started', 'parsed'));
    const replayed: JobEventDto = { ...ev('stage.failed', 'parsed'), id: '5' };
    expect(applyEvent(snap, replayed)).toBe(snap); // same object: nothing applied twice
  });

  it('records a stage failure, skipped stages and the failed job', () => {
    let j = applyEvent(snapshot(), ev('stage.started', 'summarized'));
    j = applyEvent(
      j,
      ev('stage.failed', 'summarized', {
        errorCode: 'MODEL_QUOTA_EXCEEDED',
        errorMessage: 'no credit',
      }),
    );
    j = applyEvent(j, ev('stage.skipped', 'verified'));
    j = applyEvent(
      j,
      ev('job.failed', null, { errorCode: 'MODEL_QUOTA_EXCEEDED', errorMessage: 'no credit' }),
    );
    expect(stageOf(j, 'summarized')).toMatchObject({
      status: 'failed',
      errorCode: 'MODEL_QUOTA_EXCEEDED',
    });
    expect(stageOf(j, 'verified').status).toBe('skipped');
    expect(j).toMatchObject({ status: 'failed', errorMessage: 'no credit' });
    expect(j.finishedAt).not.toBeNull();
  });

  it('puts a running stage back to pending when the job is requeued for retry', () => {
    let j = applyEvent(snapshot(), ev('stage.started', 'embedded'));
    j = applyEvent(j, ev('job.retrying', 'embedded'));
    expect(j.status).toBe('queued');
    expect(stageOf(j, 'embedded')).toMatchObject({ status: 'pending', startedAt: null });
  });

  it('marks the job completed on job.completed', () => {
    const j = applyEvent(snapshot(), ev('job.completed', null));
    expect(j.status).toBe('completed');
    expect(j.finishedAt).not.toBeNull();
  });
});
