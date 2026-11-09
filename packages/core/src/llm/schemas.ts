import { CRITICAL_CATEGORIES } from '@mediverify/shared';
import { z } from 'zod';

// All optional values are nullable (strict structured outputs require every key to be present).

export const summaryOutput = z.object({
  summary: z.string(),
});
export type SummaryOutput = z.infer<typeof summaryOutput>;

export const criticalPointsOutput = z.object({
  points: z.array(
    z.object({
      category: z.enum(CRITICAL_CATEGORIES),
      severity: z.enum(['high', 'medium', 'low']),
      text: z.string(),
      related_medication: z.string().nullable(),
      sources: z.array(z.object({ page: z.number().int().nullable(), quote: z.string() })),
    }),
  ),
});
export type CriticalPointsOutput = z.infer<typeof criticalPointsOutput>;

export const entitiesOutput = z.object({
  medications: z.array(
    z.object({
      drug_name: z.string(),
      dose_raw: z.string().nullable(),
      dose_value: z.number().nullable(),
      dose_unit: z.string().nullable(),
      route_raw: z.string().nullable(),
      frequency_raw: z.string().nullable(),
      timing_raw: z.string().nullable(),
      duration_raw: z.string().nullable(),
      indication: z.string().nullable(),
      is_new_start: z.boolean().nullable(),
      new_start_evidence: z.string().nullable(),
      source_page: z.number().int().nullable(),
      source_quote: z.string(),
      ambiguities: z.array(z.string()),
    }),
  ),
});
export type EntitiesOutput = z.infer<typeof entitiesOutput>;
export type ExtractedMedication = EntitiesOutput['medications'][number];

export const LLM_VERIFIED_FIELDS = [
  'dose',
  'unit',
  'route',
  'frequency',
  'timing',
  'duration',
  'indication',
] as const;

export const verifyOutput = z.object({
  fields: z.array(
    z.object({
      field: z.enum(LLM_VERIFIED_FIELDS),
      verdict: z.enum(['consistent', 'conflict', 'not_addressed']),
      prescribed: z.string().nullable(),
      reference_constraint: z.string().nullable(),
      explanation: z.string(),
      passage_id: z.string().nullable(),
      quote: z.string().nullable(),
    }),
  ),
  overall_explanation: z.string(),
});
export type VerifyOutput = z.infer<typeof verifyOutput>;
