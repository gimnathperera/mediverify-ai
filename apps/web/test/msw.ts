/**
 * API mock for component tests. Default handlers return responses captured from a real fixture-mode
 * run of the bundled sample (test/fixtures/*.json), so the DTO shapes match the server exactly.
 * Individual tests override handlers with `server.use(...)`.
 */
import type {
  DocumentDto,
  DocumentPageDto,
  DocumentStatusFilter,
  JobDto,
  ReferenceDto,
  ResultsDto,
  StageDto,
  UserDto,
} from '@mediverify/shared/client';
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

const statusOf = (d: DocumentDto): Exclude<DocumentStatusFilter, 'all'> =>
  d.latestJob?.status === 'completed'
    ? 'completed'
    : d.latestJob?.status === 'failed'
      ? 'failed'
      : 'processing';

/**
 * Serve `docs` like the API: filtered by `status`/`q`, paged by `limit` with an opaque cursor
 * (here simply the next offset), with per-status counts for the current search.
 */
export function documentsHandler(docs: DocumentDto[]) {
  return http.get('/api/documents', ({ request }) => {
    const url = new URL(request.url);
    const status = (url.searchParams.get('status') ?? 'all') as DocumentStatusFilter;
    const q = (url.searchParams.get('q') ?? '').toLowerCase();
    const limit = Number(url.searchParams.get('limit') ?? 25);
    const offset = Number(url.searchParams.get('cursor') ?? 0);
    const matching = docs.filter((d) => !q || d.filename.toLowerCase().includes(q));
    const filtered = matching.filter((d) => status === 'all' || statusOf(d) === status);
    const page: DocumentPageDto = {
      items: filtered.slice(offset, offset + limit),
      nextCursor: offset + limit < filtered.length ? String(offset + limit) : null,
      counts: {
        all: matching.length,
        processing: matching.filter((d) => statusOf(d) === 'processing').length,
        completed: matching.filter((d) => statusOf(d) === 'completed').length,
        failed: matching.filter((d) => statusOf(d) === 'failed').length,
      },
    };
    return HttpResponse.json(page);
  });
}

export const handlers = [
  http.get('/api/config', () => HttpResponse.json(fx.config())),
  http.get('/api/auth/me', () => HttpResponse.json(fx.user())),
  http.get('/api/references', () => HttpResponse.json(fx.references())),
  documentsHandler([fx.document()]),
  http.delete('/api/documents/:id', () => new HttpResponse(null, { status: 204 })),
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
