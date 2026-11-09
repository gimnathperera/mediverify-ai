import type { PipelineErrorCode } from '@mediverify/shared';
import type { z } from 'zod';

export type LlmTask = 'summary' | 'critical_points' | 'entities' | 'verify';

export interface LlmRequest<T> {
  task: LlmTask;
  schemaName: string;
  schema: z.ZodType<T>;
  system: string;
  user: string;
  /** Stable key for fixture lookup / recording, e.g. `<docSha16>/verify--pravoxil`. */
  fixtureKey: string;
  maxOutputTokens?: number;
}

export interface LlmProvider {
  readonly name: string;
  readonly model: string;
  generate<T>(req: LlmRequest<T>): Promise<T>;
}

export class LlmError extends Error {
  constructor(
    readonly code: PipelineErrorCode,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'LlmError';
  }
}

export interface EmbeddingProvider {
  readonly model: string;
  readonly dimensions: number;
  embedDocuments(texts: string[]): Promise<number[][]>;
  embedQuery(text: string): Promise<number[]>;
}
