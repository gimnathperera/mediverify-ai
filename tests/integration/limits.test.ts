/**
 * Deployment guards for a hosted demo backed by a paid model key: sign-up can be switched off, and
 * each user gets a rolling 24 h budget of pipeline runs (uploads + retries). Duplicates are free.
 */
import { readFile } from 'node:fs/promises';

import { usersRepo, type pg } from '@mediverify/db';
import { hash } from '@node-rs/argon2';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startApp, type TestApp } from '../helpers/app.js';
import { referenceId, testPool } from '../helpers/db.js';
import { PRIMARY_PDF } from '../helpers/env.js';

let pool: pg.Pool;
let t: TestApp;
let refId: string;
let pdf: Buffer;

beforeAll(async () => {
  pool = testPool();
  t = await startApp(pool, { ALLOW_SIGNUP: 'false', DAILY_JOB_LIMIT: '2' });
  refId = await referenceId(pool);
  pdf = await readFile(PRIMARY_PDF);
});
afterAll(async () => {
  await t.app.close();
  await pool.end();
});

const uniquePdf = () => Buffer.concat([pdf, Buffer.from(`\n% limits-${Math.random()}\n`)]);

async function seededAgent() {
  const email = `limits-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`;
  await usersRepo.createUser(pool, email, await hash('Sup3r-secret!'));
  const agent = request.agent(t.app.getHttpServer());
  await agent.post('/api/auth/login').send({ email, password: 'Sup3r-secret!' }).expect(200);
  return agent;
}

const upload = (agent: ReturnType<typeof request.agent>, bytes: Buffer) =>
  agent.post('/api/documents').field('referenceId', refId).attach('file', bytes, 'discharge.pdf');

describe('deployment limits', () => {
  it('rejects sign-up when disabled and tells the UI', async () => {
    const res = await request(t.app.getHttpServer())
      .post('/api/auth/signup')
      .send({ email: 'nobody@test.local', password: 'Sup3r-secret!' })
      .expect(403);
    expect(res.body.error.code).toBe('SIGNUP_DISABLED');
    const cfg = await request(t.app.getHttpServer()).get('/api/config').expect(200);
    expect(cfg.body).toMatchObject({ signupEnabled: false, dailyJobLimit: 2 });
  });

  it('caps pipeline runs per user per day; duplicates are free; retries count', async () => {
    const agent = await seededAgent();
    const first = uniquePdf();
    const a = (await upload(agent, first).expect(202)).body as { jobId: string };
    await upload(agent, uniquePdf()).expect(202);

    const over = await upload(agent, uniquePdf()).expect(429);
    expect(over.body.error.code).toBe('QUOTA_EXCEEDED');
    expect(over.body.error.details).toMatchObject({ limit: 2, used: 2 });

    // Re-uploading the same bytes inside the duplicate window returns the existing job, no new run.
    const dup = await upload(agent, first).expect(200);
    expect(dup.body).toMatchObject({ jobId: a.jobId, duplicate: true });

    await pool.query("UPDATE jobs SET status = 'failed' WHERE id = $1", [a.jobId]);
    const retry = await agent.post(`/api/jobs/${a.jobId}/retry`).expect(429);
    expect(retry.body.error.code).toBe('QUOTA_EXCEEDED');

    // The budget is per user: someone else is unaffected.
    await upload(await seededAgent(), uniquePdf()).expect(202);
  });

  it('caps pipeline runs across all users (app-wide daily budget)', async () => {
    const { rows } = await pool.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM jobs WHERE created_at > now() - interval '24 hours'",
    );
    const g = await startApp(pool, {
      DAILY_JOB_LIMIT: '0',
      GLOBAL_DAILY_JOB_LIMIT: String(rows[0]!.n + 1),
    });
    try {
      const agent = request.agent(g.app.getHttpServer());
      const email = `global-${Date.now()}@test.local`;
      await usersRepo.createUser(pool, email, await hash('Sup3r-secret!'));
      await agent.post('/api/auth/login').send({ email, password: 'Sup3r-secret!' }).expect(200);
      const send = (bytes: Buffer) =>
        agent.post('/api/documents').field('referenceId', refId).attach('file', bytes, 'd.pdf');
      await send(uniquePdf()).expect(202);
      const over = await send(uniquePdf()).expect(429);
      expect(over.body.error).toMatchObject({
        code: 'QUOTA_EXCEEDED',
        details: { scope: 'global' },
      });
    } finally {
      await g.app.close();
    }
  });

  it('keeps sign-up on with a paid model key (only ALLOW_SIGNUP=false closes it)', async () => {
    const paid = await startApp(pool, {
      LLM_PROVIDER: 'openai',
      OPENAI_API_KEY: 'sk-test-not-used',
    });
    try {
      const cfg = await request(paid.app.getHttpServer()).get('/api/config').expect(200);
      expect(cfg.body).toMatchObject({ signupEnabled: true });
    } finally {
      await paid.app.close();
    }
  });
});
