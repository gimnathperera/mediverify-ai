/** Stable API error codes. Response shape: `{ error: { code, message, details? } }`. */
export const ERROR_CODES = [
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'FORBIDDEN_ORIGIN',
  'INVALID_CREDENTIALS',
  'EMAIL_TAKEN',
  'NOT_FOUND',
  'UNSUPPORTED_MEDIA_TYPE',
  'PAYLOAD_TOO_LARGE',
  'REFERENCE_NOT_FOUND',
  'JOB_NOT_RETRYABLE',
  'RATE_LIMITED',
  'SIGNUP_DISABLED',
  'QUOTA_EXCEEDED',
  'INTERNAL',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ApiErrorBody {
  error: { code: ErrorCode; message: string; details?: unknown };
}

/** Pipeline (worker) failure codes surfaced on jobs/stages. */
export const PIPELINE_ERROR_CODES = [
  'PARSE_FAILED',
  'UNSUPPORTED_DOCUMENT',
  'CONVERSION_FAILED',
  'REFERENCE_INDEX_FAILED',
  'EMBEDDING_FAILED',
  'MODEL_UNAVAILABLE',
  'MODEL_NOT_CONFIGURED',
  'MODEL_QUOTA_EXCEEDED',
  'MODEL_REFUSED',
  'MODEL_OUTPUT_INVALID',
  'MODEL_OUTPUT_TRUNCATED',
  'FIXTURE_NOT_FOUND',
  'STAGE_TIMEOUT',
  'DOCUMENT_TOO_LARGE',
  'WORKER_LOST',
  'INTERNAL',
] as const;
export type PipelineErrorCode = (typeof PIPELINE_ERROR_CODES)[number];
