/** Dev helper: (re)index all registered references. Idempotent — reuses an existing index. */
import { createEmbeddingProvider, ensureReferenceIndexed } from '@mediverify/core';
import { createPool, referencesRepo } from '@mediverify/db';
import pino from 'pino';

const log = pino({ base: { service: 'index-reference' } });
const pool = createPool(
  process.env.DATABASE_URL ?? 'postgres://mediverify:mediverify@localhost:55432/mediverify',
);
try {
  const embedder = createEmbeddingProvider(process.env);
  for (const id of await referencesRepo.listReferenceIds(pool)) {
    const out = await ensureReferenceIndexed(pool, embedder, id, log);
    console.log(JSON.stringify({ referenceId: id, ...out }));
  }
} finally {
  await pool.end();
}
