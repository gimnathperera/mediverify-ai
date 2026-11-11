import os from 'node:os';

import { envNumber } from '@mediverify/shared';

const num = (name: string, fallback: number) => envNumber(process.env, name, fallback);

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
  verifyConcurrency: num('VERIFY_CONCURRENCY', 3),
  heartbeatFile: process.env.WORKER_HEARTBEAT_FILE ?? '/tmp/worker.heartbeat',
  sofficeBin: process.env.SOFFICE_BIN,
  maxDocumentPages: num('MAX_DOCUMENT_PAGES', 50),
  maxDocumentChars: num('MAX_DOCUMENT_CHARS', 150_000),
  // Prices are optional; without them cost is reported as unknown, never guessed.
  llmPricing:
    process.env.LLM_PRICE_INPUT_PER_MTOK && process.env.LLM_PRICE_OUTPUT_PER_MTOK
      ? {
          inputPerMTok: num('LLM_PRICE_INPUT_PER_MTOK', 0),
          outputPerMTok: num('LLM_PRICE_OUTPUT_PER_MTOK', 0),
        }
      : undefined,
  maintenanceSeconds: num('MAINTENANCE_INTERVAL_SECONDS', 3600),
  eventRetentionDays: num('EVENT_RETENTION_DAYS', 30),
  documentRetentionDays: num('DOCUMENT_RETENTION_DAYS', 0),
};
