import { pg } from '@mediverify/db';
import type { Logger } from 'pino';

export interface QueueListener {
  close(): Promise<void>;
}

/**
 * LISTEN on the job-queue channel over a dedicated connection, so new jobs are picked up instantly.
 *
 * A LISTEN connection sits idle between notifications, so when the database restarts or the
 * connection drops, pg emits `error` on the client; with no handler that crashes the process. Here a
 * lost connection is logged and re-established with exponential backoff, and `onNotify` is called
 * once on reconnect so anything queued during the outage is claimed. The worker's polling loop
 * keeps claiming jobs meanwhile, so an outage only delays pickup and loses no jobs.
 */
export function listenForJobs(opts: {
  connectionString: string;
  channel: string;
  onNotify: () => void;
  log: Logger;
  retryMs?: number;
  maxRetryMs?: number;
}): Promise<QueueListener> {
  const { connectionString, channel, onNotify, log } = opts;
  const baseDelay = opts.retryMs ?? 1000;
  const maxDelay = opts.maxRetryMs ?? 30_000;
  let client: pg.Client | null = null;
  let closed = false;
  let timer: NodeJS.Timeout | null = null;
  let failures = 0;

  const scheduleReconnect = () => {
    if (closed || timer) return;
    const delay = Math.min(maxDelay, baseDelay * 2 ** Math.min(failures, 10));
    failures++;
    timer = setTimeout(() => {
      timer = null;
      connect()
        .then(() => {
          log.info({ event: 'queue.listen_restored', attempts: failures }, 'LISTEN restored');
          failures = 0;
          onNotify(); // claim anything enqueued while we were disconnected
        })
        .catch((err: Error) => {
          log.warn(
            { event: 'queue.listen_retry_failed', error: err.message, retry_in_ms: delay },
            'LISTEN reconnect failed; retrying',
          );
          scheduleReconnect();
        });
    }, delay);
  };

  async function connect(): Promise<void> {
    const c = new pg.Client({ connectionString });
    // Attach before connecting: an error at any point must never be unhandled.
    c.on('error', (err) => {
      if (client !== c) return; // already replaced or closing
      client = null;
      log.warn(
        { event: 'queue.listen_error', error: err.message },
        'LISTEN connection lost; reconnecting (polling continues meanwhile)',
      );
      c.end().catch(() => undefined);
      scheduleReconnect();
    });
    c.on('notification', () => onNotify());
    try {
      await c.connect();
      await c.query(`LISTEN ${channel}`);
    } catch (err) {
      await c.end().catch(() => undefined);
      throw err;
    }
    if (closed) {
      await c.end().catch(() => undefined);
      return;
    }
    client = c;
  }

  return connect().then(() => ({
    async close() {
      closed = true;
      if (timer) clearTimeout(timer);
      const c = client;
      client = null;
      await c?.end().catch(() => undefined);
    },
  }));
}
