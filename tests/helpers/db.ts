import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import {
  createEmbeddingProvider,
  FixtureProvider,
  runClaimedJob,
  type LlmProvider,
  type PipelineDeps,
  type RunnerOptions,
} from '@mediverify/core';
import {
  createPool,
  documentsRepo,
  jobsRepo,
  usersRepo,
  withTransaction,
  type pg,
} from '@mediverify/db';
import pino from 'pino';

import { FIXTURE_DIR, MODEL_CACHE, PRIMARY_PDF, TEST_DATABASE_URL } from './env.js';

export const silentLog = pino({ level: process.env.TEST_LOG_LEVEL ?? 'silent' });

export function testPool(): pg.Pool {
  return createPool(TEST_DATABASE_URL, 6);
}

export async function createUser(pool: pg.Pool, prefix = 'user') {
  const email = `${prefix}-${randomUUID()}@test.local`;
  const u = await usersRepo.createUser(pool, email, 'not-a-real-hash');
  return u!;
}

export async function referenceId(pool: pg.Pool) {
  const { rows } = await pool.query<{ id: string }>(
    "SELECT id FROM reference_documents WHERE slug = 'mbmc-formulary-digest' LIMIT 1",
  );
  return rows[0]!.id;
}

export async function uploadFile(
  pool: pg.Pool,
  ownerId: string,
  file = PRIMARY_PDF,
  bytes?: Buffer,
) {
  const data = bytes ?? (await readFile(file));
  const refId = await referenceId(pool);
  return withTransaction(pool, (c) =>
    documentsRepo.insertUploadRecords(c, {
      ownerId,
      referenceId: refId,
      filename: 'primary.pdf',
      mimeType: 'application/pdf',
      sizeBytes: data.length,
      sha256: createHash('sha256').update(data).digest('hex'),
      bytes: data,
      maxAttempts: 3,
    }),
  );
}

let embedder: ReturnType<typeof createEmbeddingProvider> | null = null;
export function deps(pool: pg.Pool, llm?: LlmProvider): PipelineDeps {
  embedder ??= createEmbeddingProvider({ ...process.env, EMBEDDING_CACHE_DIR: MODEL_CACHE });
  return {
    pool,
    llm: llm ?? new FixtureProvider(FIXTURE_DIR),
    embedder,
    config: { retrievalTopK: 6, retrievalMinScore: 0.35 },
  };
}

/** Claim the specific job (test isolation) and run it to a terminal/requeued outcome. */
export async function runJob(
  pool: pg.Pool,
  jobId: string,
  d: PipelineDeps,
  workerId = 'test-worker',
  overrides: Partial<RunnerOptions> = {},
) {
  const { rows } = await pool.query<{
    id: string;
    document_id: string;
    attempts: number;
    max_attempts: number;
  }>(
    `UPDATE jobs SET status = 'running', attempts = attempts + 1, lease_owner = $2,
            lease_expires_at = now() + interval '5 minutes', started_at = COALESCE(started_at, now())
      WHERE id = $1 AND status = 'queued' RETURNING id, document_id, attempts, max_attempts`,
    [jobId, workerId],
  );
  const job = rows[0];
  if (!job) throw new Error(`job ${jobId} not claimable`);
  return runClaimedJob(
    d,
    job,
    {
      workerId,
      leaseSeconds: 300,
      stageTimeoutMs: 120_000,
      retryBaseDelaySeconds: 0,
      ...overrides,
    },
    silentLog,
  );
}

export { jobsRepo };
