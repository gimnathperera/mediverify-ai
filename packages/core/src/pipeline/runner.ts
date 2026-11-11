import { jobsRepo, LeaseLostError, withTransaction } from '@mediverify/db';
import { STAGES, type PipelineErrorCode, type StageName } from '@mediverify/shared';
import type { Logger } from 'pino';

import { LlmError, scopeLlm, type LlmUsage } from '../llm/types.js';

import {
  JobState,
  STAGE_IMPLEMENTATIONS,
  StageError,
  type JobContext,
  type PipelineDeps,
  type StageResult,
} from './stages.js';

/** USD cost of a stage's model usage; null when no prices are configured (never invented). */
function costOf(
  u: { promptTokens: number; completionTokens: number },
  pricing: RunnerOptions['llmPricing'],
): number | null {
  if (!pricing) return null;
  return (u.promptTokens * pricing.inputPerMTok + u.completionTokens * pricing.outputPerMTok) / 1e6;
}

export interface RunnerOptions {
  workerId: string;
  leaseSeconds: number;
  stageTimeoutMs: number;
  retryBaseDelaySeconds: number;
  /** Checked between stages; when true the job is released back to the queue. */
  shouldStop?: () => boolean;
  /** USD per million tokens; when set, model cost is computed and stored per job. */
  llmPricing?: { inputPerMTok: number; outputPerMTok: number } | undefined;
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

/**
 * Race the stage against its time limit. On timeout the stage's AbortController fires, so model
 * calls, LibreOffice and per-medication scheduling stop instead of running (and spending) on.
 */
async function withTimeout<T>(
  p: Promise<T>,
  ms: number,
  stage: StageName,
  controller: AbortController,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const err = new StageError(
        'STAGE_TIMEOUT',
        `Stage "${stage}" exceeded ${Math.round(ms / 1000)}s`,
        true,
      );
      controller.abort(err);
      reject(err);
    }, ms);
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
  const ctx: JobContext = {
    jobId: job.id,
    documentId: job.document_id,
    log,
    progress: async (message: string, data: Record<string, unknown> = {}) => {
      // A cancelled (timed-out) stage must not keep writing events for a job it no longer runs.
      const stage = currentStage;
      if (stage && !ctx.signal?.aborted)
        await withTransaction(pool, (c) =>
          jobsRepo.addStageProgress(c, job.id, stage, message, data),
        );
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
      const controller = new AbortController();
      ctx.signal = controller.signal;
      ctx.log = stageLog;
      const usage = { calls: 0, promptTokens: 0, completionTokens: 0 };
      const stageDeps: PipelineDeps = {
        ...deps,
        llm: scopeLlm(deps.llm, {
          signal: controller.signal,
          log: stageLog,
          onUsage: (u: LlmUsage) => {
            usage.calls++;
            usage.promptTokens += u.promptTokens;
            usage.completionTokens += u.completionTokens;
          },
        }),
      };
      let result: StageResult;
      try {
        result = await withTimeout(
          STAGE_IMPLEMENTATIONS[stage](stageDeps, state),
          opts.stageTimeoutMs,
          stage,
          controller,
        );
      } finally {
        // Spend is recorded even when the stage fails or times out.
        if (usage.calls > 0)
          await jobsRepo
            .addLlmUsage(pool, job.id, { ...usage, costUsd: costOf(usage, opts.llmPricing) })
            .catch((e: Error) =>
              stageLog.warn({ event: 'llm.usage_not_recorded', error: e.message }, e.message),
            );
      }
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
