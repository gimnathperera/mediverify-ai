/**
 * API mock for component tests. Default handlers return responses captured from a real fixture-mode
 * run of the bundled sample (test/fixtures/*.json), so the DTO shapes match the server exactly.
 * Individual tests override handlers with `server.use(...)`.
 */
import type {
  DocumentDto,
  JobDto,
  ReferenceDto,
  ResultsDto,
  StageDto,
  UserDto,
} from '@mediverify/shared';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import type { RuntimeConfig } from '../src/lib/api';

import configJson from './fixtures/config.json';
import documentJson from './fixtures/document.json';
import jobJson from './fixtures/job.json';
import referencesJson from './fixtures/references.json';
import resultsJson from './fixtures/results.json';

const clone = <T>(v: unknown): T => structuredClone(v) as T;

export const fx = {
  config: () => clone<RuntimeConfig>(configJson),
  document: () => clone<DocumentDto>(documentJson),
  job: () => clone<JobDto>(jobJson),
  references: () => clone<ReferenceDto[]>(referencesJson),
  results: () => clone<ResultsDto>(resultsJson),
  user: (): UserDto => ({ id: 'u-1', email: 'reviewer@mediverify.test' }),
};

export const DOC_ID = fx.document().id;
export const JOB_ID = fx.job().id;

/** A job paused mid-pipeline: stages before `running` completed, the rest pending. */
export function runningJob(running: StageDto['stage'] = 'embedded', lastEventId = '100'): JobDto {
  const job = fx.job();
  const idx = job.stages.findIndex((s) => s.stage === running);
  job.stages = job.stages.map((s, i) =>
    i < idx
      ? s
      : i === idx
        ? { ...s, status: 'running', finishedAt: null, durationMs: null, detail: null }
        : {
            ...s,
            status: 'pending',
            startedAt: null,
            finishedAt: null,
            durationMs: null,
            detail: null,
          },
  );
  return {
    ...job,
    status: 'running',
    currentStage: running,
    finishedAt: null,
    lastEventId,
  };
}

export function failedJob(errorCode: string, errorMessage: string): JobDto {
  const job = fx.job();
  job.stages = job.stages.map((s) =>
    s.stage === 'summarized'
      ? { ...s, status: 'failed', errorCode, errorMessage }
      : s.ordinal > 4
        ? { ...s, status: 'skipped', startedAt: null, finishedAt: null, durationMs: null }
        : s,
  );
  return { ...job, status: 'failed', currentStage: 'summarized', errorCode, errorMessage };
}

export const handlers = [
  http.get('/api/config', () => HttpResponse.json(fx.config())),
  http.get('/api/auth/me', () => HttpResponse.json(fx.user())),
  http.get('/api/references', () => HttpResponse.json(fx.references())),
  http.get('/api/documents', () => HttpResponse.json([fx.document()])),
  http.get('/api/documents/:id', ({ params }) =>
    params.id === DOC_ID
      ? HttpResponse.json(fx.document())
      : HttpResponse.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, { status: 404 }),
  ),
  http.get('/api/jobs/:id', () => HttpResponse.json(fx.job())),
  http.get('/api/jobs/:id/results', () => HttpResponse.json(fx.results())),
];

export const server = setupServer(...handlers);

export const apiError = (status: number, code: string, message: string) =>
  HttpResponse.json({ error: { code, message } }, { status });
