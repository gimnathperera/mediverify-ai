import pg from 'pg';

export type Queryable = Pick<pg.Pool | pg.PoolClient, 'query'>;
export type { PoolClient } from 'pg';

// Return bigint (int8) as string — used for job_events ids (SSE ids) to avoid precision loss.
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => v);
// numeric → number (dose values are small decimals).
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => Number(v));

export function createPool(connectionString: string, max = 10): pg.Pool {
  const pool = new pg.Pool({ connectionString, max, idleTimeoutMillis: 30_000 });
  // Idle client errors (e.g. DB restart) must not crash the process.
  pool.on('error', () => undefined);
  return pool;
}

/**
 * Run `fn` inside a single transaction. Rolls back on any thrown error and re-throws.
 * Keep the body short — never await model calls inside.
 */
export async function withTransaction<T>(
  pool: pg.Pool,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export function toVectorLiteral(values: readonly number[]): string {
  return `[${values.join(',')}]`;
}

export { pg };
