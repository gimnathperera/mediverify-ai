import type { Queryable } from '../pool.js';

export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
}

export async function createUser(q: Queryable, email: string, passwordHash: string) {
  const { rows } = await q.query<{ id: string; email: string }>(
    `INSERT INTO users(email, password_hash) VALUES ($1, $2)
     ON CONFLICT (email) DO NOTHING RETURNING id, email`,
    [email, passwordHash],
  );
  return rows[0] ?? null; // null => email taken
}

export async function findUserByEmail(q: Queryable, email: string): Promise<UserRow | null> {
  const { rows } = await q.query<UserRow>(
    'SELECT id, email, password_hash FROM users WHERE email = $1',
    [email],
  );
  return rows[0] ?? null;
}

export async function upsertUserPassword(q: Queryable, email: string, passwordHash: string) {
  const { rows } = await q.query<{ id: string }>(
    `INSERT INTO users(email, password_hash) VALUES ($1, $2)
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash RETURNING id`,
    [email, passwordHash],
  );
  return rows[0]!.id;
}

export async function createSession(
  q: Queryable,
  userId: string,
  tokenHash: Buffer,
  ttlSeconds: number,
) {
  await q.query(
    `INSERT INTO sessions(user_id, token_hash, expires_at)
     VALUES ($1, $2, now() + make_interval(secs => $3))`,
    [userId, tokenHash, ttlSeconds],
  );
}

export async function findSessionUser(q: Queryable, tokenHash: Buffer) {
  const { rows } = await q.query<{ id: string; email: string }>(
    `SELECT u.id, u.email FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()`,
    [tokenHash],
  );
  return rows[0] ?? null;
}

export async function revokeSession(q: Queryable, tokenHash: Buffer) {
  await q.query('UPDATE sessions SET revoked_at = now() WHERE token_hash = $1', [tokenHash]);
}
