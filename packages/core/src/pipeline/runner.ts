import { jobsRepo, LeaseLostError, withTransaction } from '@mediverify/db';
import { STAGES, type PipelineErrorCode, type StageName } from '@mediverify/shared';
import type { Logger } from 'pino';

import { LlmError } from '../llm/types.js';

import { JobState, STAGE_IMPLEMENTATIONS, StageError, type PipelineDeps } from './stages.js';

export interface RunnerOptions {
  workerId: string;
  leaseSeconds: number;
  stageTimeoutMs: number;
  retryBaseDelaySeconds: number;
  /** Checked between stages; when true the job is released back to the queue. */
  shouldStop?: () => boolean;
}

export interface ClaimedJobLike {
  id: string;
  document_id: string;
  attempts: number;
  max_attempts: number;
}

export type RunOutcome = 'completed' | 'failed' | 'requeued' | 'lease_lost';

function classify(err: unknown): { code: PipelineErrorCode; message: string; retryable: boolean } {
  if (err instanceof StageError || err instanceof LlmError)
    return { code: err.code, message: err.message, retryable: err.retryable };
  return {
    code: 'INTERNAL',
    message: 'Unexpected internal error while processing this stage',
    retryable: true,
  };
}

async function withTimeout<T>(p: Promise<T>, ms: number, stage: StageName): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new StageError(
            'STAGE_TIMEOUT',
            `Stage "${stage}" exceeded ${Math.round(ms / 1000)}s`,
            true,
          ),
        ),
      ms,
    );
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Execute a claimed job stage by stage. Each stage = short tx (running + event) → work outside any
 * transaction → short tx (assert lease, persist results, completed + event). Completed stages are
 * skipped, so a requeued job resumes where it stopped. Errors become terminal failures or
 * requeues with exponential backoff; the job can never be left 'running' without a live lease.
 */
export async function runClaimedJob(
  deps: PipelineDeps,
  job: ClaimedJobLike,
  opts: RunnerOptions,
  baseLog: Logger,
): Promise<RunOutcome> {
  const { pool } = deps;
  const log = baseLog.child({
    job_id: job.id,
    document_id: job.document_id,
    attempt: job.attempts,
  });
  const jobStarted = Date.now();
  let currentStage: StageName | null = null;
  const ctx = {
    jobId: job.id,
    documentId: job.document_id,
    log,
    progress: async (message: string, data: Record<string, unknown> = {}) => {
      if (currentStage) await jobsRepo.addStageProgress(pool, job.id, currentStage, message, data);
    },
  };
  const state = new JobState(deps, ctx);
  log.info(
    { event: 'job.started', llm_provider: deps.llm.name, llm_model: deps.llm.model },
    'job started',
  );
  await jobsRepo.setJobLlm(pool, job.id, deps.llm.name, deps.llm.model);

  try {
    const statuses = await jobsRepo.getStageStatuses(pool, job.id);
    for (const stage of STAGES) {
      if (statuses.get(stage) === 'completed') continue;
      if (opts.shouldStop?.()) {
        await withTransaction(pool, async (c) => {
          await jobsRepo.assertLease(c, job.id, opts.workerId);
          await jobsRepo.requeueJob(c, job.id, null, 0, 'worker shutting down');
        });
        log.info({ event: 'job.released', stage }, 'job released for shutdown');
        return 'requeued';
      }
      currentStage = stage;
      const stageLog = log.child({ stage });
      await withTransaction(pool, async (c) => {
        await jobsRepo.assertLease(c, job.id, opts.workerId);
        await jobsRepo.markStageRunning(c, job.id, stage, job.attempts);
      });
      stageLog.info({ event: 'stage.started' }, `stage ${stage} started`);
      const started = Date.now();
      const result = await withTimeout(
        STAGE_IMPLEMENTATIONS[stage](deps, state),
        opts.stageTimeoutMs,
        stage,
      );
      await withTransaction(pool, async (c) => {
        await jobsRepo.assertLease(c, job.id, opts.workerId);
        if (result.persist) await result.persist(c);
        await jobsRepo.markStageCompleted(c, job.id, stage, result.detail, result.metadata ?? {});
        if (stage === 'done') await jobsRepo.completeJob(c, job.id);
      });
      stageLog.info(
        { event: 'stage.completed', duration_ms: Date.now() - started, detail: result.detail },
        `stage ${stage} completed`,
      );
    }
    log.info({ event: 'job.completed', duration_ms: Date.now() - jobStarted }, 'job completed');
    return 'completed';
  } catch (err) {
    if (err instanceof LeaseLostError) {
      log.warn(
        { event: 'job.lease_lost', stage: currentStage },
        'lease lost; abandoning job (another worker or the reaper owns it)',
      );
      return 'lease_lost';
    }
    const { code, message, retryable } = classify(err);
    const canRetry = retryable && job.attempts < job.max_attempts;
    log.error(
      {
        event: canRetry ? 'stage.retrying' : 'stage.failed',
        stage: currentStage,
        error_code: code,
        error: message,
        retryable,
        // Internal errors: log the stack (no document content) for diagnosis.
        ...(code === 'INTERNAL' && err instanceof Error ? { stack: err.stack } : {}),
      },
      `stage ${currentStage ?? '?'} failed`,
    );
    try {
      await withTransaction(pool, async (c) => {
        await jobsRepo.assertLease(c, job.id, opts.workerId);
        if (canRetry) {
          const delay = opts.retryBaseDelaySeconds * 2 ** (job.attempts - 1);
          await jobsRepo.requeueJob(c, job.id, currentStage, delay, `${code}: ${message}`);
        } else {
          await jobsRepo.failJob(c, job.id, currentStage, code, message);
        }
      });
    } catch (txErr) {
      if (txErr instanceof LeaseLostError) return 'lease_lost';
      throw txErr;
    }
    return canRetry ? 'requeued' : 'failed';
  }
}
