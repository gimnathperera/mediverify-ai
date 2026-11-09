/** Pipeline stages in execution order. Names are part of the public contract (brief §2.1). */
export const STAGES = [
  'parsed',
  'chunked',
  'embedded',
  'summarized',
  'key_points_extracted',
  'entities_extracted',
  'verified',
  'done',
] as const;
export type StageName = (typeof STAGES)[number];

export const STAGE_LABELS: Record<StageName, string> = {
  parsed: 'Parsed',
  chunked: 'Chunked',
  embedded: 'Embedded',
  summarized: 'Summarized',
  key_points_extracted: 'Key points extracted',
  entities_extracted: 'Entities extracted',
  verified: 'Verified',
  done: 'Done',
};

export const STAGE_STATUSES = ['pending', 'running', 'completed', 'failed', 'skipped'] as const;
export type StageStatus = (typeof STAGE_STATUSES)[number];

export const JOB_STATUSES = ['queued', 'running', 'completed', 'failed'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const TERMINAL_JOB_STATUSES: readonly JobStatus[] = ['completed', 'failed'];

export function isTerminalJobStatus(status: JobStatus): boolean {
  return TERMINAL_JOB_STATUSES.includes(status);
}

export const JOB_EVENT_TYPES = [
  'job.queued',
  'job.started',
  'job.retrying',
  'job.completed',
  'job.failed',
  'stage.started',
  'stage.progress',
  'stage.completed',
  'stage.failed',
  'stage.skipped',
] as const;
export type JobEventType = (typeof JOB_EVENT_TYPES)[number];
