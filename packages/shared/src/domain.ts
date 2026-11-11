/**
 * Domain vocabularies shared by the API, worker and web app. Kept free of zod so the web app can
 * import them (via `@mediverify/shared/client`) without bundling the schema library.
 */
export const VERIFICATION_STATUSES = [
  'supported',
  'contradicted',
  'unsupported',
  'incomplete',
] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export const VERIFIED_FIELDS = [
  'identity',
  'dose',
  'unit',
  'route',
  'frequency',
  'timing',
  'duration',
  'indication',
] as const;
export type VerifiedField = (typeof VERIFIED_FIELDS)[number];

export const FIELD_VERDICTS = ['consistent', 'conflict', 'not_addressed', 'unknown'] as const;
export type FieldVerdict = (typeof FIELD_VERDICTS)[number];

/**
 * Why a field is not `consistent`/`conflict`. Lets the status rules and the UI tell "nothing to
 * check" apart from "could not be checked":
 * - not_constrained: the matched monograph sets no rule for this field (nothing to verify);
 * - not_stated: the prescription does not state the value;
 * - insufficient_evidence: a rule may apply but the evidence to decide was not retrieved/documented;
 * - unverified: a model claim was rejected because its quote did not validate.
 */
export const FINDING_REASONS = [
  'not_constrained',
  'not_stated',
  'insufficient_evidence',
  'unverified',
] as const;
export type FindingReason = (typeof FINDING_REASONS)[number];

/** Fields that must be confirmed `consistent` for a medication to be `supported`. */
export const CORE_VERIFIED_FIELDS = ['dose', 'route', 'frequency'] as const;

/** Document-list status filter: `processing` groups queued and running jobs. */
export const DOCUMENT_STATUS_FILTERS = ['all', 'processing', 'completed', 'failed'] as const;
export type DocumentStatusFilter = (typeof DOCUMENT_STATUS_FILTERS)[number];
export const DOCUMENT_PAGE_SIZE = 25;
