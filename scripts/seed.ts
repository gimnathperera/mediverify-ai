/**
 * Seed demo users and register the provided reference document (idempotent).
 * Reference *indexing* (chunk + embed) is done by the worker on startup / first job.
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { createPool, referencesRepo, usersRepo } from '@mediverify/db';
import { PDF_MIME } from '@mediverify/shared';
import { hash } from '@node-rs/argon2';

const url =
  process.env.DATABASE_URL ?? 'postgres://mediverify:mediverify@localhost:55432/mediverify';
const pool = createPool(url, 2);

const users = [
  {
    email: process.env.SEED_USER_EMAIL ?? 'reviewer@mediverify.test',
    password: process.env.SEED_USER_PASSWORD ?? 'Reviewer#2026',
  },
  {
    email: process.env.SEED_USER2_EMAIL ?? 'second.user@mediverify.test',
    password: process.env.SEED_USER2_PASSWORD ?? 'SecondUser#2026',
  },
];

try {
  for (const u of users) {
    await usersRepo.upsertUserPassword(pool, u.email.toLowerCase(), await hash(u.password));
  }
  const file = path.resolve(
    process.env.SEED_REFERENCE_PATH ?? 'resources/reference_document_medical.pdf',
  );
  const bytes = await readFile(file);
  const id = await referencesRepo.upsertReference(pool, {
    slug: 'mbmc-formulary-digest',
    title: 'Meridian Bay Medical Center — Institutional Formulary Digest',
    versionLabel: '8.2',
    filename: path.basename(file),
    mimeType: PDF_MIME,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    bytes,
  });
  console.log(
    JSON.stringify({ event: 'seed.done', users: users.map((u) => u.email), referenceId: id }),
  );
} finally {
  await pool.end();
}
