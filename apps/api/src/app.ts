import 'reflect-metadata';

import type { pg } from '@mediverify/db';
import { Module, type DynamicModule, type INestApplication } from '@nestjs/common';
import { APP_GUARD, NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';
import type { Logger } from 'pino';

import { AuthGuard, type AuthedRequest } from './common/auth.js';
import { AllExceptionsFilter } from './common/exception.filter.js';
import type { AppConfig } from './config.js';
import { AuthController } from './modules/auth.controller.js';
import { DocumentsController } from './modules/documents.controller.js';
import { EventsHub } from './modules/events-hub.js';
import { HealthController } from './modules/health.controller.js';
import { JobsController } from './modules/jobs.controller.js';
import { ReferencesController } from './modules/references.controller.js';
import { APP_CONFIG, LOGGER, PG_POOL, UPLOAD_FAULT_HOOK, type UploadFaultHook } from './tokens.js';

export interface AppDeps {
  pool: pg.Pool;
  config: AppConfig;
  logger: Logger;
  uploadFaultHook?: UploadFaultHook;
}

@Module({})
class AppModule {
  static forRoot(deps: AppDeps): DynamicModule {
    return {
      module: AppModule,
      controllers: [
        AuthController,
        DocumentsController,
        JobsController,
        ReferencesController,
        HealthController,
      ],
      providers: [
        { provide: PG_POOL, useValue: deps.pool },
        { provide: APP_CONFIG, useValue: deps.config },
        { provide: LOGGER, useValue: deps.logger },
        { provide: UPLOAD_FAULT_HOOK, useValue: deps.uploadFaultHook ?? null },
        EventsHub,
        { provide: APP_GUARD, useClass: AuthGuard },
      ],
    };
  }
}

/** Structured access log: method, route, status, duration, user. Never bodies, cookies or queries. */
function accessLog(log: Logger) {
  return (req: Request, res: Response, next: NextFunction) => {
    const started = Date.now();
    res.on('finish', () => {
      if (req.path === '/api/health') return;
      log.info(
        {
          event: 'http.request',
          method: req.method,
          path: req.path,
          status: res.statusCode,
          duration_ms: Date.now() - started,
          user_id: (req as AuthedRequest).user?.id,
        },
        'request',
      );
    });
    next();
  };
}

export async function createApp(deps: AppDeps): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule.forRoot(deps), {
    logger: ['error', 'warn'],
    bodyParser: true,
    // Close open SSE streams on shutdown instead of waiting for them (they can last an hour).
    forceCloseConnections: true,
  });
  // Behind nginx / the Vite proxy: use X-Forwarded-For so per-IP rate limits see real clients.
  (app.getHttpAdapter().getInstance() as { set(k: string, v: unknown): void }).set(
    'trust proxy',
    deps.config.trustProxy,
  );
  app.setGlobalPrefix('api');
  app.use(cookieParser());
  app.use(accessLog(deps.logger));
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    next();
  });
  app.useGlobalFilters(new AllExceptionsFilter(deps.logger));
  // Shutdown is driven by main.ts (one path: close the app, then the pool).
  return app;
}
