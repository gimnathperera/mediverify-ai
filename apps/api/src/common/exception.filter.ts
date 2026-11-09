import type { ApiErrorBody, ErrorCode } from '@mediverify/shared';
import { HttpException, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { Logger } from 'pino';

import { ApiError } from './api-error.js';

const STATUS_CODES: Record<number, ErrorCode> = {
  400: 'VALIDATION_FAILED',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN_ORIGIN',
  404: 'NOT_FOUND',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  429: 'RATE_LIMITED',
};

/** Centralized error mapping → `{ error: { code, message, details? } }`. Never leaks internals. */
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly log: Logger) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    let status = 500;
    let body: ApiErrorBody = { error: { code: 'INTERNAL', message: 'Internal server error' } };

    if (exception instanceof ApiError) {
      status = exception.status;
      body = {
        error: {
          code: exception.code,
          message: exception.message,
          ...(exception.details !== undefined ? { details: exception.details } : {}),
        },
      };
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      body = {
        error: {
          code: STATUS_CODES[status] ?? 'INTERNAL',
          message: status === 404 ? 'Route not found' : exception.message,
        },
      };
    } else if (isMulterError(exception)) {
      status = exception.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      body = {
        error: {
          code: status === 413 ? 'PAYLOAD_TOO_LARGE' : 'VALIDATION_FAILED',
          message: status === 413 ? 'File exceeds the 10 MB limit' : 'Invalid multipart upload',
        },
      };
    }
    if (status >= 500) {
      this.log.error(
        {
          event: 'http.error',
          method: req.method,
          path: req.path,
          err: (exception as Error)?.message,
          stack: (exception as Error)?.stack,
        },
        'unhandled error',
      );
    }
    if (res.headersSent) {
      res.end();
      return;
    }
    res.status(status).json(body);
  }
}

function isMulterError(e: unknown): e is { name: string; code: string } {
  return typeof e === 'object' && e !== null && (e as { name?: string }).name === 'MulterError';
}
