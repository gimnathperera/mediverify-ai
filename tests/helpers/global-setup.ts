import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { createEmbeddingProvider, ensureReferenceIndexed } from '@mediverify/core';
import { createPool, referencesRepo, runMigrations } from '@mediverify/db';
import pino from 'pino';

import { ADMIN_DATABASE_URL, MODEL_CACHE, REFERENCE_PDF, ROOT, TEST_DATABASE_URL } from './env.js';

/** Create (if needed) and migrate the test database, register + index the reference once. */
export default async function setup() {
  const dbName = new URL(TEST_DATABASE_URL).pathname.slice(1);
  const admin = createPool(ADMIN_DATABASE_URL, 1);
  try {
    const { rowCount } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [
      dbName,
    ]);
    if (!rowCount) await admin.query(`CREATE DATABASE "${dbName.replace(/"/g, '')}"`);
  } finally {
    await admin.end();
  }
  const pool = createPool(TEST_DATABASE_URL, 2);
  try {
    await runMigrations(pool, path.join(ROOT, 'db/migrations'));
    const bytes = await readFile(REFERENCE_PDF);
    const id = await referencesRepo.upsertReference(pool, {
      slug: 'mbmc-formulary-digest',
      title: 'Meridian Bay Medical Center — Institutional Formulary Digest',
      versionLabel: '8.2',
      filename: 'reference_document_medical.pdf',
      mimeType: 'application/pdf',
      sha256: createHash('sha256').update(bytes).digest('hex'),
      bytes,
    });
    const embedder = createEmbeddingProvider({ ...process.env, EMBEDDING_CACHE_DIR: MODEL_CACHE });
    await ensureReferenceIndexed(pool, embedder, id, pino({ level: 'silent' }));
  } finally {
    await pool.end();
  }
}
