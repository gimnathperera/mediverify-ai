import { jobsRepo, type Queryable } from '@mediverify/db';

import { ApiError } from './api-error.js';

/**
 * Cap pipeline runs (uploads + retries) per rolling 24 h — per user, and across all users — so a
 * hosted demo backed by a paid model key can't be drained by one account or by many. Runs inside
 * the job-creating transaction under advisory locks. A limit `<= 0` disables that check.
 */
export async function assertJobQuota(
  q: Queryable,
  ownerId: string,
  limits: { perUser: number; global: number },
) {
  if (limits.perUser > 0) {
    const used = await jobsRepo.lockAndCountRecentJobs(q, ownerId);
    if (used >= limits.perUser) {
      throw new ApiError(
        429,
        'QUOTA_EXCEEDED',
        `Daily processing limit reached (${limits.perUser} documents per 24 hours). Try again later.`,
        { limit: limits.perUser, used },
      );
    }
  }
  if (limits.global > 0) {
    const used = await jobsRepo.lockAndCountRecentJobs(q, null);
    if (used >= limits.global) {
      throw new ApiError(
        429,
        'QUOTA_EXCEEDED',
        'This deployment has reached its daily processing budget. Try again later.',
        { scope: 'global' },
      );
    }
  }
}

/** The quota limits from app config (one place, used by upload and retry). */
export const jobLimits = (config: { dailyJobLimit: number; globalDailyJobLimit: number }) => ({
  perUser: config.dailyJobLimit,
  global: config.globalDailyJobLimit,
});
