/** Apply versioned SQL migrations from db/migrations (idempotent, advisory-locked). */
import path from 'node:path';

import { createPool, runMigrations } from '@mediverify/db';

const url =
  process.env.DATABASE_URL ?? 'postgres://mediverify:mediverify@localhost:55432/mediverify';
const pool = createPool(url, 2);
try {
  const dir = path.resolve(process.env.MIGRATIONS_DIR ?? 'db/migrations');
  const { applied, skipped } = await runMigrations(pool, dir);
  console.log(JSON.stringify({ event: 'migrations.done', applied, skipped: skipped.length }));
} finally {
  await pool.end();
}
