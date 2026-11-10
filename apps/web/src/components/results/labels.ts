import type {
  CriticalPointDto,
  FindingDto,
  MedicationDto,
  VerificationStatus,
} from '@mediverify/shared';

export const CATEGORY_LABEL: Record<CriticalPointDto['category'], string> = {
  serious_side_effect: 'Side effect to report',
  administration_timing: 'How / when to take',
  duration_limit: 'Duration',
  follow_up: 'Follow-up',
  safety_precaution: 'Safety',
  document_discrepancy: 'Inconsistency in document',
  other: 'Other',
};

export const FIELD_LABEL: Record<FindingDto['field'], string> = {
  identity: 'Monograph',
  dose: 'Dose',
  unit: 'Unit',
  route: 'Route',
  frequency: 'Frequency',
  timing: 'Timing',
  duration: 'Duration',
  indication: 'Indication',
};

export const VERDICT_STYLE: Record<FindingDto['verdict'], { label: string; cls: string }> = {
  conflict: { label: 'Conflict', cls: 'bg-rose-100 text-rose-800' },
  consistent: { label: 'Consistent', cls: 'bg-emerald-100 text-emerald-800' },
  not_addressed: { label: 'Not addressed', cls: 'bg-slate-100 text-slate-600' },
  unknown: { label: 'Unverified', cls: 'bg-slate-100 text-slate-600' },
};

/** Display order: what needs attention first. */
export const STATUS_ORDER: VerificationStatus[] = [
  'contradicted',
  'unsupported',
  'incomplete',
  'supported',
];

export const STATUS_SURFACE: Record<VerificationStatus, string> = {
  supported: 'border-emerald-200 bg-emerald-50',
  contradicted: 'border-rose-200 bg-rose-50',
  unsupported: 'border-amber-200 bg-amber-50',
  incomplete: 'border-slate-200 bg-white',
};

export const STATUS_ACCENT: Record<VerificationStatus, string> = {
  supported: 'border-l-emerald-500',
  contradicted: 'border-l-rose-500',
  unsupported: 'border-l-amber-500',
  incomplete: 'border-l-slate-400',
};

/** One-line prescription as written in the document (deduplicated raw values). */
export function prescribedLine(m: MedicationDto | undefined): string {
  if (!m) return '';
  const parts = [m.doseRaw, m.routeRaw ?? m.route, m.frequencyRaw, m.durationRaw].filter(
    (x): x is string => Boolean(x),
  );
  return [...new Set(parts)].join(' · ');
}

export const verificationAnchor = (id: string) => `verification-${id}`;
