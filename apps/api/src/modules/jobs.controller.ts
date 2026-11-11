import { eventsRepo, jobsRepo, resultsRepo, withTransaction, type pg } from '@mediverify/db';
import type { JobDto, ResultsDto, UserDto } from '@mediverify/shared';
import { Controller, Get, HttpCode, Inject, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { Logger } from 'pino';

import { ApiError } from '../common/api-error.js';
import { CurrentUser, type AuthedRequest } from '../common/auth.js';
import { assertJobQuota, jobLimits } from '../common/quota.js';
import { uuidParam } from '../common/zod.js';
import type { AppConfig } from '../config.js';
import { APP_CONFIG, LOGGER, PG_POOL } from '../tokens.js';

import { EventsHub } from './events-hub.js';

const TERMINAL_EVENTS = new Set(['job.completed', 'job.failed']);
const HEARTBEAT_MS = 15_000;

@Controller('jobs')
export class JobsController {
  constructor(
    @Inject(PG_POOL) private readonly pool: pg.Pool,
    @Inject(EventsHub) private readonly hub: EventsHub,
    @Inject(LOGGER) private readonly log: Logger,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Get(':id')
  async get(@Param('id') id: string, @CurrentUser() user: UserDto): Promise<JobDto> {
    const job = await jobsRepo.getJobForOwner(this.pool, uuidParam(id, 'Job'), user.id);
    if (!job) throw ApiError.notFound('Job');
    return job;
  }

  @Get(':id/results')
  async results(@Param('id') id: string, @CurrentUser() user: UserDto): Promise<ResultsDto> {
    const r = await resultsRepo.getResultsForOwner(this.pool, uuidParam(id, 'Job'), user.id);
    if (!r) throw ApiError.notFound('Job');
    return r;
  }

  @Post(':id/retry')
  @HttpCode(202)
  async retry(@Param('id') id: string, @CurrentUser() user: UserDto) {
    const jobId = uuidParam(id, 'Job');
    const out = await withTransaction(this.pool, async (c) => {
      await assertJobQuota(c, user.id, jobLimits(this.config));
      return jobsRepo.createRetryJob(c, jobId, user.id);
    });
    if (out.kind === 'not_found') throw ApiError.notFound('Job');
    if (out.kind === 'not_retryable')
      throw new ApiError(409, 'JOB_NOT_RETRYABLE', 'Only failed jobs can be retried');
    this.log.info(
      {
        event: 'job.retry_requested',
        job_id: out.jobId,
        retry_of: id,
        document_id: out.documentId,
      },
      'retry queued',
    );
    return { jobId: out.jobId, documentId: out.documentId, duplicate: false };
  }

  /**
   * Server-Sent Events. Replays persisted events after `Last-Event-ID` (header, set automatically by
   * EventSource on reconnect) or `?lastEventId=`, then streams new ones. Ends with `event: end` once
   * the job reaches a terminal state. Ownership is checked before any byte is streamed.
   */
  @Get(':id/events')
  async events(
    @Param('id') id: string,
    @Query('lastEventId') lastEventIdQuery: string | undefined,
    @CurrentUser() user: UserDto,
    @Req() req: AuthedRequest,
    @Res() res: Response,
  ): Promise<void> {
    const jobId = uuidParam(id, 'Job');
    const job = await jobsRepo.getJobForOwner(this.pool, jobId, user.id);
    if (!job) throw ApiError.notFound('Job');

    const headerId = req.headers['last-event-id'];
    const raw = (Array.isArray(headerId) ? headerId[0] : headerId) ?? lastEventIdQuery ?? '0';
    let cursor = /^\d{1,18}$/.test(raw) ? raw : '0';

    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    res.write('retry: 3000\n\n');

    let closed = false;
    let busy = false;
    let again = false;
    const close = () => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      unsubscribe?.();
      res.end();
    };
    const flush = async (): Promise<void> => {
      if (closed) return;
      if (busy) {
        again = true;
        return;
      }
      busy = true;
      try {
        do {
          again = false;
          const events = await eventsRepo.listEventsSince(this.pool, jobId, cursor);
          for (const e of events) {
            res.write(`id: ${e.id}\ndata: ${JSON.stringify(e)}\n\n`);
            cursor = e.id;
            if (TERMINAL_EVENTS.has(e.type)) {
              res.write(
                `event: end\ndata: ${JSON.stringify({ status: e.type === 'job.completed' ? 'completed' : 'failed' })}\n\n`,
              );
              close();
              return;
            }
          }
        } while (again && !closed);
      } catch (err) {
        this.log.warn(
          { event: 'sse.flush_error', job_id: jobId, error: (err as Error).message },
          'SSE flush failed',
        );
        close();
      } finally {
        busy = false;
      }
    };
    // Register before any await: a client that leaves early must still release everything.
    req.on('close', close);
    const heartbeat = setInterval(() => {
      if (closed) return;
      res.write(': ping\n\n');
      // A deleted job (and its document) emits no terminal event: end the stream instead of
      // sending heartbeats forever.
      jobsRepo
        .getJobForOwner(this.pool, jobId, user.id)
        .then((j) => {
          if (j || closed) return;
          res.write(`event: end\ndata: ${JSON.stringify({ status: 'deleted' })}\n\n`);
          close();
        })
        .catch(() => undefined);
    }, HEARTBEAT_MS);
    // Subscribe BEFORE the initial replay so no event can slip between the two.
    let unsubscribe: (() => void) | null = null;
    try {
      unsubscribe = await this.hub.subscribe(jobId, () => {
        void flush();
      });
    } catch (err) {
      this.log.warn(
        { event: 'sse.subscribe_failed', job_id: jobId, error: (err as Error).message },
        'SSE subscribe failed',
      );
      close();
      return;
    }
    if (closed) {
      unsubscribe();
      return;
    }
    this.log.debug({ event: 'sse.open', job_id: jobId, from: cursor }, 'SSE stream opened');
    await flush();
  }
}
