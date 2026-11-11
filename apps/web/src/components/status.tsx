import type { JobStatus, StageStatus, VerificationStatus } from '@mediverify/shared/client';
import {
  CheckCircle2,
  CircleDashed,
  CircleSlash,
  HelpCircle,
  Loader2,
  XCircle,
  XOctagon,
} from 'lucide-react';

import { Badge } from './ui/primitives';

export const VERIFICATION_META: Record<
  VerificationStatus,
  {
    label: string;
    tone: 'success' | 'danger' | 'warning' | 'neutral';
    icon: typeof CheckCircle2;
    help: string;
  }
> = {
  supported: {
    label: 'Supported',
    tone: 'success',
    icon: CheckCircle2,
    help: 'A monograph exists and the checked prescribing parameters are consistent with it.',
  },
  contradicted: {
    label: 'Contradicted',
    tone: 'danger',
    icon: XOctagon,
    help: 'A monograph exists and at least one prescribing parameter conflicts with it.',
  },
  unsupported: {
    label: 'Unsupported',
    tone: 'warning',
    icon: HelpCircle,
    help: 'No monograph for this drug in the selected reference — a coverage gap, not proof of an error.',
  },
  incomplete: {
    label: 'Incomplete',
    tone: 'neutral',
    icon: CircleDashed,
    help: 'Verification could not be completed (insufficient evidence retrieved); not classified rather than guessed.',
  },
};

export function VerificationBadge({ status }: { status: VerificationStatus }) {
  const m = VERIFICATION_META[status];
  const Icon = m.icon;
  return (
    <Badge tone={m.tone} title={m.help}>
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {m.label}
    </Badge>
  );
}

export function JobStatusBadge({ status }: { status: JobStatus | 'uploading' }) {
  switch (status) {
    case 'completed':
      return (
        <Badge tone="success">
          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
          Completed
        </Badge>
      );
    case 'failed':
      return (
        <Badge tone="danger">
          <XCircle className="h-3.5 w-3.5" aria-hidden />
          Failed
        </Badge>
      );
    case 'running':
      return (
        <Badge tone="info">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          Processing
        </Badge>
      );
    case 'uploading':
      return (
        <Badge tone="brand">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          Uploading
        </Badge>
      );
    default:
      return (
        <Badge tone="neutral">
          <CircleDashed className="h-3.5 w-3.5" aria-hidden />
          Queued
        </Badge>
      );
  }
}

export function StageIcon({ status }: { status: StageStatus }) {
  switch (status) {
    case 'completed':
      return <CheckCircle2 className="h-5 w-5 text-emerald-600" aria-hidden />;
    case 'running':
      return <Loader2 className="h-5 w-5 animate-spin text-sky-600" aria-hidden />;
    case 'failed':
      return <XCircle className="h-5 w-5 text-rose-600" aria-hidden />;
    case 'skipped':
      return <CircleSlash className="h-5 w-5 text-slate-400" aria-hidden />;
    default:
      return <CircleDashed className="h-5 w-5 text-slate-300" aria-hidden />;
  }
}
