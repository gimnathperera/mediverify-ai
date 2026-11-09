import { z } from 'zod';

import { JOB_STATUSES, STAGES, STAGE_STATUSES } from './stages.js';

// ---------- auth ----------
export const credentialsSchema = z.object({
  email: z
    .email()
    .max(254)
    .transform((e) => e.trim().toLowerCase()),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
});
export type Credentials = z.infer<typeof credentialsSchema>;

export const userSchema = z.object({ id: z.uuid(), email: z.string() });
export type UserDto = z.infer<typeof userSchema>;

// ---------- references ----------
export const referenceSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  title: z.string(),
  versionLabel: z.string(),
  pageCount: z.number().int().nullable(),
  indexStatus: z.enum(['pending', 'indexing', 'ready', 'failed']),
  monographCount: z.number().int(),
  createdAt: z.string(),
});
export type ReferenceDto = z.infer<typeof referenceSchema>;

// ---------- documents & jobs ----------
export const uploadFieldsSchema = z.object({ referenceId: z.uuid() });

export const uploadResponseSchema = z.object({
  documentId: z.uuid(),
  jobId: z.uuid(),
  duplicate: z.boolean(),
});
export type UploadResponse = z.infer<typeof uploadResponseSchema>;

export const stageSchema = z.object({
  stage: z.enum(STAGES),
  ordinal: z.number().int(),
  status: z.enum(STAGE_STATUSES),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  durationMs: z.number().int().nullable(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  detail: z.string().nullable(),
});
export type StageDto = z.infer<typeof stageSchema>;

export const jobSchema = z.object({
  id: z.uuid(),
  documentId: z.uuid(),
  status: z.enum(JOB_STATUSES),
  currentStage: z.enum(STAGES).nullable(),
  attempts: z.number().int(),
  maxAttempts: z.number().int(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  createdAt: z.string(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  stages: z.array(stageSchema),
  lastEventId: z.string(),
  llmProvider: z.string().nullable(),
});
export type JobDto = z.infer<typeof jobSchema>;

export const jobEventSchema = z.object({
  id: z.string(),
  jobId: z.uuid(),
  stage: z.enum(STAGES).nullable(),
  type: z.string(),
  payload: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
});
export type JobEventDto = z.infer<typeof jobEventSchema>;

export const documentSchema = z.object({
  id: z.uuid(),
  filename: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int(),
  pageCount: z.number().int().nullable(),
  createdAt: z.string(),
  reference: z.object({ id: z.uuid(), title: z.string(), versionLabel: z.string() }),
  latestJob: z
    .object({
      id: z.uuid(),
      status: z.enum(JOB_STATUSES),
      currentStage: z.enum(STAGES).nullable(),
      errorMessage: z.string().nullable(),
    })
    .nullable(),
});
export type DocumentDto = z.infer<typeof documentSchema>;

// ---------- results ----------
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

export const citationSchema = z.object({
  chunkId: z.uuid(),
  referenceId: z.uuid(),
  monographName: z.string().nullable(),
  section: z.string().nullable(),
  fieldLabel: z.string().nullable(),
  page: z.number().int().nullable(),
  quote: z.string(),
  quoteValid: z.boolean(),
});
export type CitationDto = z.infer<typeof citationSchema>;

export const findingSchema = z.object({
  id: z.uuid(),
  field: z.enum(VERIFIED_FIELDS),
  verdict: z.enum(FIELD_VERDICTS),
  prescribedValue: z.string().nullable(),
  referenceConstraint: z.string().nullable(),
  explanation: z.string(),
  decidedBy: z.enum(['deterministic', 'llm', 'both']),
  confidence: z.enum(['high', 'medium', 'low']),
  citation: citationSchema.nullable(),
});
export type FindingDto = z.infer<typeof findingSchema>;

export const medicationSchema = z.object({
  id: z.uuid(),
  ordinal: z.number().int(),
  drugName: z.string(),
  doseValue: z.number().nullable(),
  doseUnit: z.string().nullable(),
  doseRaw: z.string().nullable(),
  route: z.string().nullable(),
  routeRaw: z.string().nullable(),
  frequency: z.string().nullable(),
  frequencyRaw: z.string().nullable(),
  timing: z.string().nullable(),
  durationValue: z.number().nullable(),
  durationUnit: z.string().nullable(),
  durationRaw: z.string().nullable(),
  indication: z.string().nullable(),
  sourcePage: z.number().int().nullable(),
  sourceQuote: z.string().nullable(),
  sourceQuoteValid: z.boolean(),
  ambiguities: z.array(z.string()),
});
export type MedicationDto = z.infer<typeof medicationSchema>;

export const verificationSchema = z.object({
  id: z.uuid(),
  medicationId: z.uuid(),
  drugName: z.string(),
  status: z.enum(VERIFICATION_STATUSES),
  monographName: z.string().nullable(),
  summary: z.string(),
  similarNames: z.array(z.string()),
  findings: z.array(findingSchema),
  coverageCitation: citationSchema.nullable(),
});
export type VerificationDto = z.infer<typeof verificationSchema>;

export const CRITICAL_CATEGORIES = [
  'serious_side_effect',
  'administration_timing',
  'duration_limit',
  'follow_up',
  'safety_precaution',
  'document_discrepancy',
  'other',
] as const;
export type CriticalCategory = (typeof CRITICAL_CATEGORIES)[number];

export const criticalPointSchema = z.object({
  id: z.uuid(),
  rank: z.number().int(),
  category: z.enum(CRITICAL_CATEGORIES),
  severity: z.enum(['high', 'medium', 'low']),
  text: z.string(),
  relatedMedication: z.string().nullable(),
  sources: z.array(
    z.object({ page: z.number().int().nullable(), quote: z.string(), quoteValid: z.boolean() }),
  ),
});
export type CriticalPointDto = z.infer<typeof criticalPointSchema>;

export const resultsSchema = z.object({
  jobId: z.uuid(),
  documentId: z.uuid(),
  status: z.enum(JOB_STATUSES),
  llm: z.object({ provider: z.string(), model: z.string() }).nullable(),
  summary: z
    .object({ text: z.string(), warnings: z.array(z.string()), model: z.string() })
    .nullable(),
  criticalPoints: z.array(criticalPointSchema),
  medications: z.array(medicationSchema),
  verifications: z.array(verificationSchema),
});
export type ResultsDto = z.infer<typeof resultsSchema>;
