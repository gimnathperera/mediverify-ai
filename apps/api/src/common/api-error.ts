import type { ErrorCode } from '@mediverify/shared';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  static notFound(what = 'Resource') {
    return new ApiError(404, 'NOT_FOUND', `${what} not found`);
  }
  static unauthenticated() {
    return new ApiError(401, 'UNAUTHENTICATED', 'Authentication required');
  }
}
