import pg from 'pg';

/** The subset of a pino logger the listener needs. */
export interface ListenerLog {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
}

export interface Listener {
  close(): Promise<void>;
}

/**
 * LISTEN on a channel over a dedicated connection that survives database restarts.
 *
 * A LISTEN connection sits idle between notifications, so when the connection drops pg emits
 * `error` on the client; with no handler that crashes the process. Here a lost connection is
 * logged and re-established with exponential backoff (capped), and `onRestore` runs after each
 * reconnect so callers can catch up on anything missed during the outage (the worker polls for
 * queued jobs; the API re-reads persisted events for open SSE streams).
 *
 * Used by the worker (job queue) and the API (job events fan-out).
 */
export function listenWithReconnect(opts: {
  connectionString: string;
  channel: string;
  onNotify: (payload: string | undefined) => void;
  onRestore?: () => void;
  log: ListenerLog;
  /** Log event prefix, e.g. `queue` → `queue.listen_error`. */
  eventPrefix?: string;
  retryMs?: number;
  maxRetryMs?: number;
}): Promise<Listener> {
  const { connectionString, channel, onNotify, log } = opts;
  const onRestore = opts.onRestore ?? (() => onNotify(undefined));
  const prefix = opts.eventPrefix ?? 'listen';
  const baseDelay = opts.retryMs ?? 1000;
  const maxDelay = opts.maxRetryMs ?? 30_000;
  let client: pg.Client | null = null;
  let closed = false;
  let timer: NodeJS.Timeout | null = null;
  let failures = 0;

  const nextDelay = () => Math.min(maxDelay, baseDelay * 2 ** Math.min(failures, 10));

  const scheduleReconnect = () => {
    if (closed || timer) return;
    const delay = nextDelay();
    failures++;
    timer = setTimeout(() => {
      timer = null;
      connect()
        .then(() => {
          log.info({ event: `${prefix}.listen_restored`, attempts: failures }, 'LISTEN restored');
          failures = 0;
          onRestore();
        })
        .catch((err: Error) => {
          log.warn(
            {
              event: `${prefix}.listen_retry_failed`,
              error: err.message,
              retry_in_ms: nextDelay(),
            },
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
        { event: `${prefix}.listen_error`, error: err.message },
        'LISTEN connection lost; reconnecting',
      );
      c.end().catch(() => undefined);
      scheduleReconnect();
    });
    c.on('notification', (msg) => onNotify(msg.payload));
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
