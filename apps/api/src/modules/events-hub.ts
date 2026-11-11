import {
  JOB_EVENTS_CHANNEL,
  listenWithReconnect,
  type Listener as DbListener,
} from '@mediverify/db';
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
  private listener: DbListener | null = null;
  private connecting: Promise<void> | null = null;
  private closed = false;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(LOGGER) private readonly log: Logger,
  ) {}

  /** One LISTEN connection per process; it reconnects with backoff and pokes every stream after. */
  private async connect(): Promise<void> {
    if (this.listener || this.closed) return;
    this.connecting ??= listenWithReconnect({
      connectionString: this.config.databaseUrl,
      channel: JOB_EVENTS_CHANNEL,
      onNotify: (jobId) => {
        if (jobId) this.poke(jobId);
      },
      onRestore: () => this.pokeAll(),
      log: this.log,
      eventPrefix: 'sse',
    })
      .then((l) => {
        this.listener = l;
      })
      .finally(() => {
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
    await this.listener?.close();
  }
}
