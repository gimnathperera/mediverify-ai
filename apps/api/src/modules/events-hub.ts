import { JOB_EVENTS_CHANNEL, pg } from '@mediverify/db';
import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import type { Logger } from 'pino';

import type { AppConfig } from '../config.js';
import { APP_CONFIG, LOGGER } from '../tokens.js';

type Listener = () => void;

/**
 * One dedicated LISTEN connection per API process fans out `job_events` NOTIFYs to SSE streams.
 * The NOTIFY payload is only the job id; streams then read the persisted events (source of truth),
 * so a dropped notification can never lose an event — at worst it delays it until the next one.
 * On reconnect all subscribers are poked so they re-read anything missed during the outage.
 */
@Injectable()
export class EventsHub implements OnModuleDestroy {
  private readonly listeners = new Map<string, Set<Listener>>();
  private client: pg.Client | null = null;
  private connecting: Promise<void> | null = null;
  private closed = false;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(LOGGER) private readonly log: Logger,
  ) {}

  private async connect(): Promise<void> {
    if (this.client || this.closed) return;
    this.connecting ??= (async () => {
      const client = new pg.Client({ connectionString: this.config.databaseUrl });
      client.on('notification', (msg) => {
        if (msg.payload) this.poke(msg.payload);
      });
      client.on('error', (err) => {
        this.log.warn(
          { event: 'sse.listen_error', error: err.message },
          'LISTEN connection lost; reconnecting',
        );
        this.client = null;
        client.end().catch(() => undefined);
        setTimeout(() => {
          this.connect()
            .then(() => this.pokeAll())
            .catch(() => undefined);
        }, 1000);
      });
      await client.connect();
      await client.query(`LISTEN ${JOB_EVENTS_CHANNEL}`);
      this.client = client;
    })().finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  async subscribe(jobId: string, listener: Listener): Promise<() => void> {
    await this.connect();
    let set = this.listeners.get(jobId);
    if (!set) this.listeners.set(jobId, (set = new Set()));
    set.add(listener);
    return () => {
      set.delete(listener);
      if (set.size === 0) this.listeners.delete(jobId);
    };
  }

  private poke(jobId: string) {
    for (const l of this.listeners.get(jobId) ?? []) l();
  }

  private pokeAll() {
    for (const set of this.listeners.values()) for (const l of set) l();
  }

  async onModuleDestroy() {
    this.closed = true;
    await this.client?.end().catch(() => undefined);
  }
}
