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
  /** Aborted when the stage times out: the provider stops the in-flight call and its retries. */
  signal?: AbortSignal | undefined;
  /** Job/stage-scoped logger (falls back to the provider's own). */
  log?: LlmLog | undefined;
  /** Called once per successful model call with its token usage. */
  onUsage?: ((usage: LlmUsage) => void) | undefined;
}

export interface LlmUsage {
  promptTokens: number;
  completionTokens: number;
}

/** The subset of a pino logger the providers use. */
export interface LlmLog {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
}

/**
 * Bind a job/stage scope (abort signal, logger, usage sink) to a provider, so task code keeps
 * calling `llm.generate(req)` unchanged while every call is cancellable, traceable and costed.
 */
export function scopeLlm(
  llm: LlmProvider,
  scope: Pick<LlmRequest<unknown>, 'signal' | 'log' | 'onUsage'>,
): LlmProvider {
  return {
    name: llm.name,
    model: llm.model,
    generate: (req) => llm.generate({ ...req, ...scope }),
  };
}

/** Rough token estimate (≈4 characters per token for English) used for pre-flight limits. */
export const estimateTokens = (text: string) => Math.ceil(text.length / 4);

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
