import type { pg } from '@mediverify/db';
import type { INestApplication } from '@nestjs/common';
import pino from 'pino';
import request from 'supertest';

import { createApp } from '../../apps/api/src/app.js';
import { loadConfig } from '../../apps/api/src/config.js';

import { TEST_DATABASE_URL } from './env.js';

export interface TestApp {
  app: INestApplication;
  fault: { fn: (() => Promise<void>) | null };
}

export async function startApp(pool: pg.Pool): Promise<TestApp> {
  const fault: TestApp['fault'] = { fn: null };
  const app = await createApp({
    pool,
    config: loadConfig({
      DATABASE_URL: TEST_DATABASE_URL,
      LLM_PROVIDER: 'fixture',
      ALLOWED_ORIGINS: 'http://localhost:8088',
      DUPLICATE_WINDOW_SECONDS: '300',
    }),
    logger: pino({ level: 'silent' }),
    uploadFaultHook: () => (fault.fn ? fault.fn() : Promise.resolve()),
  });
  await app.init();
  return { app, fault };
}

/** Sign up a fresh user and return a cookie-carrying agent. */
export async function signedInAgent(app: INestApplication, label: string) {
  const agent = request.agent(app.getHttpServer());
  const email = `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`;
  const res = await agent
    .post('/api/auth/signup')
    .send({ email, password: 'Sup3r-secret!' })
    .expect(201);
  return { agent, user: res.body as { id: string; email: string }, email };
}
