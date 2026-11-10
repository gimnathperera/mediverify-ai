import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';

import { type pg } from '@mediverify/db';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { signedInAgent, startApp, type TestApp } from '../helpers/app.js';
import { deps, referenceId, runJob, testPool } from '../helpers/db.js';
import { PRIMARY_PDF } from '../helpers/env.js';

let pool: pg.Pool;
let t: TestApp;
let app: INestApplication;
let refId: string;
let pdf: Buffer;

beforeAll(async () => {
  pool = testPool();
  t = await startApp(pool);
  app = t.app;
  refId = await referenceId(pool);
  pdf = await readFile(PRIMARY_PDF);
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

/** Unique bytes per upload (appending to a PDF keeps it a valid %PDF- file) to avoid duplicate detection. */
const uniquePdf = () => Buffer.concat([pdf, Buffer.from(`\n% test-${Math.random()}\n`)]);

function upload(
  agent: ReturnType<typeof request.agent>,
  bytes: Buffer = uniquePdf(),
  name = 'discharge.pdf',
) {
  return agent.post('/api/documents').field('referenceId', refId).attach('file', bytes, name);
}

describe('auth', () => {
  it('signup → me → logout revokes the session', async () => {
    const { agent, email } = await signedInAgent(app, 'auth');
    const me = await agent.get('/api/auth/me').expect(200);
    expect(me.body.email).toBe(email);
    const cookie = (await agent.get('/api/auth/me')).request.getHeader?.('cookie');
    await agent.post('/api/auth/logout').expect(204);
    await agent.get('/api/auth/me').expect(401);
    // The old token is revoked server-side, not just cleared client-side.
    if (typeof cookie === 'string') {
      await request(app.getHttpServer()).get('/api/auth/me').set('Cookie', cookie).expect(401);
    }
  });

  it('sets an HttpOnly, SameSite=Strict session cookie and stores no plaintext token', async () => {
    const email = `cookie-${Date.now()}@test.local`;
    const res = await request(app.getHttpServer())
      .post('/api/auth/signup')
      .send({ email, password: 'Sup3r-secret!' })
      .expect(201);
    const set = String(res.headers['set-cookie']);
    expect(set).toMatch(/HttpOnly/);
    expect(set).toMatch(/SameSite=Strict/);
    const token = /mv_session=([^;]+)/.exec(set)![1]!;
    const { rows } = await pool.query('SELECT 1 FROM sessions WHERE token_hash::text LIKE $1', [
      `%${token}%`,
    ]);
    expect(rows).toHaveLength(0);
    const { rows: u } = await pool.query<{ password_hash: string }>(
      'SELECT password_hash FROM users WHERE email = $1',
      [email],
    );
    expect(u[0]!.password_hash).toMatch(/^\$argon2id\$/);
  });

  it('rejects bad credentials, duplicate emails and invalid input with stable error codes', async () => {
    const { email } = await signedInAgent(app, 'dupe');
    const server = app.getHttpServer();
    expect(
      (await request(server).post('/api/auth/login').send({ email, password: 'wrong-password' }))
        .body.error.code,
    ).toBe('INVALID_CREDENTIALS');
    expect(
      (await request(server).post('/api/auth/signup').send({ email, password: 'Sup3r-secret!' }))
        .body.error.code,
    ).toBe('EMAIL_TAKEN');
    const bad = await request(server)
      .post('/api/auth/signup')
      .send({ email: 'not-an-email', password: 'x' })
      .expect(400);
    expect(bad.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('blocks state-changing requests from foreign origins (CSRF)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .set('Origin', 'https://evil.example')
      .send({})
      .expect(403);
    expect(res.body.error.code).toBe('FORBIDDEN_ORIGIN');
  });

  it('requires authentication on every user-owned route', async () => {
    const server = app.getHttpServer();
    const id = '00000000-0000-4000-8000-000000000000';
    for (const path of [
      '/api/documents',
      `/api/documents/${id}`,
      `/api/documents/${id}/file`,
      `/api/jobs/${id}`,
      `/api/jobs/${id}/events`,
      `/api/jobs/${id}/results`,
      '/api/references',
    ]) {
      const res = await request(server).get(path);
      expect(res.status, path).toBe(401);
    }
    await request(server).post('/api/documents').expect(401);
  });
});

describe('upload', () => {
  it('returns 202 with ids immediately and atomically creates document + job + 8 stages + event', async () => {
    const { agent } = await signedInAgent(app, 'upload');
    const started = Date.now();
    const res = await upload(agent).expect(202);
    expect(Date.now() - started).toBeLessThan(2000); // never awaits the pipeline
    const { documentId, jobId, duplicate } = res.body;
    expect(duplicate).toBe(false);
    const job = await pool.query('SELECT status FROM jobs WHERE id = $1 AND document_id = $2', [
      jobId,
      documentId,
    ]);
    expect(job.rows[0].status).toBe('queued');
    const stages = await pool.query<{ stage: string }>(
      "SELECT stage FROM job_stages WHERE job_id = $1 AND status = 'pending' ORDER BY ordinal",
      [jobId],
    );
    expect(stages.rows.map((r) => r.stage)).toEqual([
      'parsed',
      'chunked',
      'embedded',
      'summarized',
      'key_points_extracted',
      'entities_extracted',
      'verified',
      'done',
    ]);
    const ev = await pool.query<{ type: string }>('SELECT type FROM job_events WHERE job_id = $1', [
      jobId,
    ]);
    expect(ev.rows.map((r) => r.type)).toEqual(['job.queued']);
  });

  it('validates type by extension AND magic bytes, size, and reference', async () => {
    const { agent } = await signedInAgent(app, 'validate');
    const fake = await upload(agent, Buffer.from('not a pdf at all'), 'fake.pdf').expect(415);
    expect(fake.body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
    await upload(agent, uniquePdf(), 'notes.txt').expect(415);
    const tooBig = await upload(
      agent,
      Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(10 * 1024 * 1024 + 10)]),
    ).expect(413);
    expect(tooBig.body.error.code).toBe('PAYLOAD_TOO_LARGE');
    const noRef = await agent
      .post('/api/documents')
      .attach('file', uniquePdf(), 'a.pdf')
      .expect(400);
    expect(noRef.body.error.code).toBe('VALIDATION_FAILED');
    const badRef = await agent
      .post('/api/documents')
      .field('referenceId', '00000000-0000-4000-8000-000000000000')
      .attach('file', uniquePdf(), 'a.pdf')
      .expect(404);
    expect(badRef.body.error.code).toBe('REFERENCE_NOT_FOUND');
  });

  it('rolls back every record when a failure occurs mid-transaction (no partial upload)', async () => {
    const { agent, user } = await signedInAgent(app, 'rollback');
    t.fault.fn = () => Promise.reject(new Error('injected failure after inserts'));
    try {
      const res = await upload(agent).expect(500);
      expect(res.body.error.code).toBe('INTERNAL');
    } finally {
      t.fault.fn = null;
    }
    const counts = await pool.query(
      `SELECT (SELECT count(*) FROM documents WHERE owner_id = $1)::int AS docs,
              (SELECT count(*) FROM jobs WHERE owner_id = $1)::int AS jobs,
              (SELECT count(*) FROM job_stages s JOIN jobs j ON j.id = s.job_id WHERE j.owner_id = $1)::int AS stages,
              (SELECT count(*) FROM job_events e JOIN jobs j ON j.id = e.job_id WHERE j.owner_id = $1)::int AS events`,
      [user.id],
    );
    expect(counts.rows[0]).toEqual({ docs: 0, jobs: 0, stages: 0, events: 0 });
    // And the system is clean afterwards: the next upload succeeds normally.
    await upload(agent).expect(202);
  });

  it('returns the existing job for the same content within the duplicate window (per user)', async () => {
    const { agent } = await signedInAgent(app, 'dup');
    const bytes = uniquePdf();
    const first = await upload(agent, bytes).expect(202);
    const second = await upload(agent, bytes).expect(200);
    expect(second.body).toEqual({ ...first.body, duplicate: true });
    const { agent: other } = await signedInAgent(app, 'dup-other');
    const third = await upload(other, bytes).expect(202); // different user → not a duplicate
    expect(third.body.jobId).not.toBe(first.body.jobId);
  });
});

describe('authorization (IDOR)', () => {
  it("user B cannot read, download, stream or retry user A's document and job", async () => {
    const a = await signedInAgent(app, 'owner-a');
    const b = await signedInAgent(app, 'intruder-b');
    const { documentId, jobId } = (await upload(a.agent).expect(202)).body;
    await runJob(pool, jobId, deps(pool));

    // Owner can access everything.
    await a.agent.get(`/api/documents/${documentId}`).expect(200);
    await a.agent
      .get(`/api/documents/${documentId}/file`)
      .expect(200)
      .expect('Content-Type', /pdf/);
    await a.agent.get(`/api/jobs/${jobId}/results`).expect(200);

    for (const path of [
      `/api/documents/${documentId}`,
      `/api/documents/${documentId}/file`,
      `/api/documents/${documentId}/file?download=1`,
      `/api/jobs/${jobId}`,
      `/api/jobs/${jobId}/events`,
      `/api/jobs/${jobId}/results`,
    ]) {
      const res = await b.agent.get(path);
      expect(res.status, path).toBe(404); // indistinguishable from "does not exist"
      expect(res.body.error.code).toBe('NOT_FOUND');
    }
    await b.agent.post(`/api/jobs/${jobId}/retry`).expect(404);
    const list = await b.agent.get('/api/documents').expect(200);
    expect((list.body as Array<{ id: string }>).map((d) => d.id)).not.toContain(documentId);
    await b.agent.get('/api/documents/not-a-uuid').expect(404);
  });
});

describe('SSE job events', () => {
  function parseSse(text: string) {
    const events: { id?: string; event?: string; data?: unknown }[] = [];
    for (const block of text.split('\n\n')) {
      const e: { id?: string; event?: string; data?: unknown } = {};
      for (const line of block.split('\n')) {
        if (line.startsWith('id: ')) e.id = line.slice(4);
        else if (line.startsWith('event: ')) e.event = line.slice(7);
        else if (line.startsWith('data: ')) e.data = JSON.parse(line.slice(6));
      }
      if (e.data !== undefined) events.push(e);
    }
    return events;
  }
  const raw = (res: request.Response) =>
    typeof res.text === 'string' && res.text ? res.text : String(res.body);

  it('replays persisted history (survives refresh) and ends on terminal state', async () => {
    const { agent } = await signedInAgent(app, 'sse');
    const { jobId } = (await upload(agent, pdf).expect(202)).body;
    expect(await runJob(pool, jobId, deps(pool))).toBe('completed');
    const res = await agent
      .get(`/api/jobs/${jobId}/events`)
      .buffer(true)
      .parse((r, cb) => {
        let s = '';
        r.on('data', (c: Buffer) => (s += c.toString()));
        r.on('end', () => cb(null, s));
      })
      .expect(200)
      .expect('Content-Type', /text\/event-stream/);
    const events = parseSse(raw(res));
    const types = events.filter((e) => !e.event).map((e) => (e.data as { type: string }).type);
    expect(types[0]).toBe('job.queued');
    expect(types.filter((x) => x === 'stage.completed')).toHaveLength(8);
    expect(types.at(-1)).toBe('job.completed');
    expect(events.at(-1)!.event).toBe('end');
    const ids = events.filter((e) => e.id).map((e) => BigInt(e.id!));
    expect(ids).toEqual([...ids].sort((x, y) => (x < y ? -1 : 1))); // monotonic
  });

  it('resumes after Last-Event-ID without duplicates or gaps (reconnect)', async () => {
    const { agent } = await signedInAgent(app, 'sse-resume');
    const { jobId } = (await upload(agent).expect(202)).body;
    await runJob(pool, jobId, deps(pool));
    const all = await pool.query<{ id: string }>(
      'SELECT id::text FROM job_events WHERE job_id = $1 ORDER BY id',
      [jobId],
    );
    const cut = all.rows[5]!.id;
    const res = await agent
      .get(`/api/jobs/${jobId}/events`)
      .set('Last-Event-ID', cut)
      .buffer(true)
      .parse((r, cb) => {
        let s = '';
        r.on('data', (c: Buffer) => (s += c.toString()));
        r.on('end', () => cb(null, s));
      });
    const got = parseSse(raw(res))
      .filter((e) => e.id)
      .map((e) => e.id);
    expect(got).toEqual(all.rows.slice(6).map((r) => r.id));
  });

  it('streams live events while the worker runs, and the snapshot reconstructs state', async () => {
    const server = createServer(
      app.getHttpAdapter().getInstance() as Parameters<typeof createServer>[1],
    ).listen(0);
    await new Promise((r) => server.once('listening', r));
    const port = (server.address() as { port: number }).port;
    const { agent, email } = await signedInAgent(app, 'sse-live');
    const { jobId } = (await upload(agent, pdf).expect(202)).body;
    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password: 'Sup3r-secret!' })
      .expect(200);
    const cookie = String(login.headers['set-cookie']).split(';')[0]!;
    const snapshot = (await agent.get(`/api/jobs/${jobId}`).expect(200)).body;
    expect(snapshot.status).toBe('queued');
    const received: string[] = [];
    const stream = fetch(
      `http://127.0.0.1:${port}/api/jobs/${jobId}/events?lastEventId=${snapshot.lastEventId}`,
      { headers: { cookie } },
    ).then(async (r) => {
      const text = await r.text();
      for (const e of parseSse(text))
        if (e.data && (e.data as { type?: string }).type)
          received.push((e.data as { type: string }).type);
    });
    await new Promise((r) => setTimeout(r, 200));
    await runJob(pool, jobId, deps(pool));
    await stream;
    server.close();
    expect(received[0]).toBe('stage.started'); // nothing before the snapshot's lastEventId is replayed
    expect(received).toContain('stage.progress');
    expect(received.at(-1)).toBe('job.completed');
    const after = (await agent.get(`/api/jobs/${jobId}`).expect(200)).body as {
      status: string;
      stages: Array<{ status: string; durationMs: number | null }>;
    };
    expect(after.status).toBe('completed');
    expect(after.stages.every((s) => s.status === 'completed' && s.durationMs !== null)).toBe(true);
  });
});
