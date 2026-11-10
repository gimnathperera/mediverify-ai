import { jobsRepo, type Queryable } from '@mediverify/db';

import { ApiError } from './api-error.js';

/**
 * Cap pipeline runs (uploads + retries) per user per rolling 24 h, so a hosted demo backed by a paid
 * model key can't be drained by one account. Runs inside the job-creating transaction under a
 * per-user advisory lock. `limit <= 0` disables the check.
 */
export async function assertJobQuota(q: Queryable, ownerId: string, limit: number) {
  if (limit <= 0) return;
  const used = await jobsRepo.lockAndCountRecentJobs(q, ownerId);
  if (used >= limit) {
    throw new ApiError(
      429,
      'QUOTA_EXCEEDED',
      `Daily processing limit reached (${limit} documents per 24 hours). Try again later.`,
      { limit, used },
    );
  }
}
