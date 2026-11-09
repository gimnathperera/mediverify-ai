import type { z } from 'zod';

import { ApiError } from './api-error.js';

/** Validate untrusted input against a shared zod schema; 400 VALIDATION_FAILED with field issues. */
export function parseOrThrow<T>(schema: z.ZodType<T>, input: unknown): T {
  const r = schema.safeParse(input);
  if (!r.success) {
    throw new ApiError(
      400,
      'VALIDATION_FAILED',
      'Request validation failed',
      r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  return r.data;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Malformed ids are indistinguishable from missing/foreign ones (404) — no oracle for IDOR probing. */
export function uuidParam(value: string, what: string): string {
  if (!UUID_RE.test(value)) throw ApiError.notFound(what);
  return value;
}
