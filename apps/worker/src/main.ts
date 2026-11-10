import { writeFile } from 'node:fs/promises';

import {
  createEmbeddingProvider,
  createLlmProvider,
  ensureReferenceIndexed,
  runClaimedJob,
  type PipelineDeps,
} from '@mediverify/core';
import {
  createPool,
  jobsRepo,
  JOB_QUEUE_CHANNEL,
  referencesRepo,
  withTransaction,
} from '@mediverify/db';
import pino from 'pino';

import { config } from './config.js';
import { listenForJobs } from './queue-listener.js';

const log = pino({
  base: { service: 'worker', worker_id: config.workerId },
  level: process.env.LOG_LEVEL ?? 'info',
});

async function main() {
  // Each job slot can run up to `verifyConcurrency` verification queries at once, plus heartbeat,
  // claim and reaper connections.
  // (The LISTEN connection is separate from this pool.)
  const pool = createPool(
    config.databaseUrl,
    config.concurrency * (config.verifyConcurrency + 1) + 3,
  );
  const deps: PipelineDeps = {
    pool,
    llm: createLlmProvider(process.env, log),
    embedder: createEmbeddingProvider(process.env),
    config: {
      retrievalTopK: config.retrievalTopK,
      retrievalMinScore: config.retrievalMinScore,
      verifyConcurrency: config.verifyConcurrency,
      sofficeBin: config.sofficeBin,
    },
  };
  log.info(
    {
      event: 'worker.starting',
      llm_provider: deps.llm.name,
      llm_model: deps.llm.model,
      embedding_model: deps.embedder.model,
      concurrency: config.concurrency,
    },
    'worker starting',
  );
  if (deps.llm.name === 'fixture')
    log.warn(
      { event: 'worker.fixture_mode' },
      'FIXTURE MODE: LLM output comes from hand-authored fixtures, not a live model',
    );

  let stopping = false;
  let wake: (() => void) | null = null;
  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      const t = setTimeout(() => {
        wake = null;
        resolve();
      }, ms);
      wake = () => {
        clearTimeout(t);
        wake = null;
        resolve();
      };
    });

  // Load the embedding model now (not on the first job) so stage timings reflect real work.
  const warm = Date.now();
  await deps.embedder.embedQuery('warm-up');
  log.info(
    { event: 'embedder.ready', model: deps.embedder.model, duration_ms: Date.now() - warm },
    'embedding model loaded',
  );

  // Warm reference indexes so the first job reuses them (idempotent; failures are retried by jobs).
  for (const id of await referencesRepo.listReferenceIds(pool)) {
    try {
      const out = await ensureReferenceIndexed(pool, deps.embedder, id, log);
      log.info(
        {
          event: 'reference.ready',
          reference_id: id,
          reused: out.reused,
          chunks: out.chunkCount,
          monographs: out.monographCount,
        },
        'reference index ready',
      );
    } catch (err) {
      log.error(
        { event: 'reference.index_failed', reference_id: id, error: (err as Error).message },
        'reference indexing failed',
      );
    }
  }

  // LISTEN for new jobs (instant pickup); reconnects on its own, and polling remains as a fallback.
  const listener = await listenForJobs({
    connectionString: config.databaseUrl,
    channel: JOB_QUEUE_CHANNEL,
    onNotify: () => wake?.(),
    log,
  });

  const reaper = setInterval(() => {
    withTransaction(pool, (c) => jobsRepo.reapExpiredLeases(c, config.retryBaseDelaySeconds))
      .then((r) => {
        if (r.requeued.length || r.failed.length)
          log.warn({ event: 'reaper.recovered', ...r }, 'recovered jobs with expired leases');
      })
      .catch((err: Error) =>
        log.error({ event: 'reaper.error', error: err.message }, 'reaper failed'),
      );
  }, config.reaperSeconds * 1000);

  const alive = setInterval(() => {
    writeFile(config.heartbeatFile, String(Date.now())).catch(() => undefined);
  }, 5000);
  await writeFile(config.heartbeatFile, String(Date.now())).catch(() => undefined);

  const shutdown = (signal: string) => {
    if (stopping) return;
    stopping = true;
    log.info({ event: 'worker.stopping', signal }, 'shutdown requested; finishing current stage');
    wake?.();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  const loop = async (slot: number) => {
    while (!stopping) {
      let job: Awaited<ReturnType<typeof jobsRepo.claimNextJob>> = null;
      try {
        job = await withTransaction(pool, async (c) => {
          const claimed = await jobsRepo.claimNextJob(c, config.workerId, config.leaseSeconds);
          return claimed;
        });
      } catch (err) {
        log.error({ event: 'claim.error', slot, error: (err as Error).message }, 'claim failed');
      }
      if (!job) {
        await sleep(config.pollSeconds * 1000);
        continue;
      }
      const claimed = job;
      const hb = setInterval(() => {
        jobsRepo
          .heartbeat(pool, claimed.id, config.workerId, config.leaseSeconds)
          .then((ok) => {
            if (!ok)
              log.warn({ event: 'heartbeat.lost', job_id: claimed.id }, 'lease no longer held');
          })
          .catch((err: Error) =>
            log.error(
              { event: 'heartbeat.error', job_id: claimed.id, error: err.message },
              'heartbeat failed',
            ),
          );
      }, config.heartbeatSeconds * 1000);
      try {
        await runClaimedJob(
          deps,
          claimed,
          {
            workerId: config.workerId,
            leaseSeconds: config.leaseSeconds,
            stageTimeoutMs: config.stageTimeoutMs,
            retryBaseDelaySeconds: config.retryBaseDelaySeconds,
            shouldStop: () => stopping,
          },
          log,
        );
      } catch (err) {
        // Infrastructure failure (DB down mid-job): the lease will expire and the reaper recovers it.
        log.error(
          { event: 'job.crashed', job_id: claimed.id, error: (err as Error).message },
          'job processing crashed',
        );
      } finally {
        clearInterval(hb);
      }
    }
  };

  await Promise.all(Array.from({ length: config.concurrency }, (_, i) => loop(i)));
  clearInterval(reaper);
  clearInterval(alive);
  await listener.close();
  await pool.end();
  log.info({ event: 'worker.stopped' }, 'worker stopped');
}

main().catch((err: unknown) => {
  log.fatal(
    { event: 'worker.fatal', error: (err as Error).message, stack: (err as Error).stack },
    'worker crashed',
  );
  process.exit(1);
});
