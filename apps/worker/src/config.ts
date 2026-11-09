import os from 'node:os';

function num(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`Invalid number for ${name}`);
  return n;
}

export const config = {
  databaseUrl:
    process.env.DATABASE_URL ?? 'postgres://mediverify:mediverify@localhost:55432/mediverify',
  workerId: process.env.WORKER_ID ?? `${os.hostname()}-${process.pid}`,
  concurrency: num('WORKER_CONCURRENCY', 1),
  leaseSeconds: num('JOB_LEASE_SECONDS', 60),
  heartbeatSeconds: num('JOB_HEARTBEAT_SECONDS', 15),
  pollSeconds: num('WORKER_POLL_SECONDS', 5),
  reaperSeconds: num('REAPER_INTERVAL_SECONDS', 20),
  stageTimeoutMs: num('STAGE_TIMEOUT_MS', 180_000),
  retryBaseDelaySeconds: num('RETRY_BASE_DELAY_SECONDS', 5),
  retrievalTopK: num('RETRIEVAL_TOP_K', 6),
  retrievalMinScore: num('RETRIEVAL_MIN_SCORE', 0.35),
  heartbeatFile: process.env.WORKER_HEARTBEAT_FILE ?? '/tmp/worker.heartbeat',
  sofficeBin: process.env.SOFFICE_BIN,
};
