import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import OpenAI from 'openai';
import type { Logger } from 'pino';

import { toStrictJsonSchema } from './json-schema.js';
import { estimateTokens, LlmError, type LlmProvider, type LlmRequest } from './types.js';

export interface OpenAiConfig {
  apiKey: string;
  model: string;
  baseURL?: string | undefined;
  timeoutMs: number;
  maxRetries: number;
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high' | undefined;
  temperature?: number | undefined;
  recordDir?: string | undefined;
  logger?: Logger | undefined;
  /** Refuse prompts estimated above this many tokens (protects cost and the context window). */
  maxPromptTokens?: number | undefined;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * OpenAI Chat Completions with strict JSON-schema structured output. Handles refusals, truncation,
 * schema-invalid output (re-validated with zod), timeouts, 429/5xx with exponential backoff.
 */
export class OpenAiProvider implements LlmProvider {
  readonly name = 'openai';
  readonly model: string;
  private readonly client: OpenAI;

  constructor(private readonly cfg: OpenAiConfig) {
    this.model = cfg.model;
    this.client = new OpenAI({
      apiKey: cfg.apiKey,
      baseURL: cfg.baseURL,
      timeout: cfg.timeoutMs,
      maxRetries: 0, // retries handled below so they are logged and classified
    });
  }

  async generate<T>(req: LlmRequest<T>): Promise<T> {
    const log = req.log ?? this.cfg.logger;
    const promptTokens = estimateTokens(req.system + req.user);
    if (this.cfg.maxPromptTokens && promptTokens > this.cfg.maxPromptTokens)
      throw new LlmError(
        'DOCUMENT_TOO_LARGE',
        `The document is too large to process (≈${promptTokens} prompt tokens; limit ${this.cfg.maxPromptTokens}).`,
      );
    const jsonSchema = toStrictJsonSchema(req.schema);
    let maxTokens = req.maxOutputTokens ?? 4000;
    let lastError: LlmError | null = null;
    for (let attempt = 1; attempt <= this.cfg.maxRetries + 1; attempt++) {
      const started = Date.now();
      try {
        const completion = await this.client.chat.completions.create(
          {
            model: this.model,
            messages: [
              { role: 'system', content: req.system },
              { role: 'user', content: req.user },
            ],
            response_format: {
              type: 'json_schema',
              json_schema: { name: req.schemaName, strict: true, schema: jsonSchema },
            },
            max_completion_tokens: maxTokens,
            ...(this.cfg.reasoningEffort ? { reasoning_effort: this.cfg.reasoningEffort } : {}),
            ...(this.cfg.temperature !== undefined ? { temperature: this.cfg.temperature } : {}),
          },
          { signal: req.signal },
        );
        const choice = completion.choices[0];
        const usage = completion.usage;
        req.onUsage?.({
          promptTokens: usage?.prompt_tokens ?? 0,
          completionTokens: usage?.completion_tokens ?? 0,
        });
        log?.info(
          {
            event: 'llm.call',
            task: req.task,
            model: this.model,
            attempt,
            duration_ms: Date.now() - started,
            finish_reason: choice?.finish_reason,
            prompt_tokens: usage?.prompt_tokens,
            completion_tokens: usage?.completion_tokens,
            reasoning_tokens: usage?.completion_tokens_details?.reasoning_tokens,
          },
          'llm call completed',
        );
        if (!choice) throw new LlmError('MODEL_OUTPUT_INVALID', 'Model returned no choices');
        if (choice.message.refusal) {
          throw new LlmError('MODEL_REFUSED', 'Model refused to produce the requested output');
        }
        if (choice.finish_reason === 'length') {
          throw new LlmError(
            'MODEL_OUTPUT_TRUNCATED',
            'Model output was truncated (token limit)',
            true,
          );
        }
        const content = choice.message.content ?? '';
        let parsed: unknown;
        try {
          parsed = JSON.parse(content);
        } catch {
          throw new LlmError('MODEL_OUTPUT_INVALID', 'Model output was not valid JSON', true);
        }
        const result = req.schema.safeParse(parsed);
        if (!result.success) {
          throw new LlmError(
            'MODEL_OUTPUT_INVALID',
            `Model output failed schema validation: ${result.error.issues[0]?.message ?? 'unknown'}`,
            true,
          );
        }
        if (this.cfg.recordDir) await this.record(req.fixtureKey, result.data);
        return result.data;
      } catch (err) {
        // Stage timed out: stop now — no classification, no retries, no further spend.
        if (req.signal?.aborted) throw new LlmError('STAGE_TIMEOUT', 'Model call cancelled');
        lastError = classifyOpenAiError(err);
        log?.warn(
          {
            event: 'llm.error',
            task: req.task,
            attempt,
            code: lastError.code,
            retryable: lastError.retryable,
          },
          lastError.message,
        );
        if (!lastError.retryable || attempt > this.cfg.maxRetries) break;
        // Truncated output won't fit next time either: give the retry a larger budget (once).
        if (lastError.code === 'MODEL_OUTPUT_TRUNCATED')
          maxTokens = Math.min(maxTokens * 2, 16_000);
        await sleep(Math.min(8000, 500 * 2 ** (attempt - 1)) + Math.random() * 250);
      }
    }
    throw lastError ?? new LlmError('MODEL_UNAVAILABLE', 'Model call failed');
  }

  private async record(key: string, data: unknown) {
    const file = path.join(this.cfg.recordDir!, `${key}.json`);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, `${JSON.stringify(data, null, 2)}\n`);
  }
}

/** Map provider errors to pipeline codes; only transient failures are retryable. */
export function classifyOpenAiError(err: unknown): LlmError {
  if (err instanceof LlmError) return err;
  if (err instanceof OpenAI.APIError) {
    const status: number = typeof err.status === 'number' ? err.status : 0;
    if (status === 401 || status === 403)
      return new LlmError('MODEL_NOT_CONFIGURED', 'Model provider rejected the API key', false);
    if (status === 404)
      return new LlmError('MODEL_NOT_CONFIGURED', 'Configured model was not found', false);
    if (
      status === 400 &&
      (err.code === 'context_length_exceeded' ||
        /context length|maximum context/i.test(err.message))
    )
      return new LlmError(
        'DOCUMENT_TOO_LARGE',
        'The document exceeds the model context window',
        false,
      );
    if (status === 400)
      return new LlmError('MODEL_OUTPUT_INVALID', `Model request rejected: ${err.message}`, false);
    // A 429 can mean "slow down" (retry) or "no credit/quota left" (retrying cannot help).
    if (status === 429 && (err.code === 'insufficient_quota' || err.type === 'insufficient_quota'))
      return new LlmError(
        'MODEL_QUOTA_EXCEEDED',
        'Model provider account has no remaining credit or quota (HTTP 429 insufficient_quota)',
        false,
      );
    if (status === 429 || status >= 500 || status === 0)
      return new LlmError(
        'MODEL_UNAVAILABLE',
        `Model provider unavailable (HTTP ${status || 'network'})`,
        true,
      );
  }
  if (
    err instanceof Error &&
    /timeout|timed out|ECONNRESET|ENOTFOUND|fetch failed/i.test(err.message)
  ) {
    return new LlmError('MODEL_UNAVAILABLE', 'Model provider timed out or is unreachable', true);
  }
  return new LlmError(
    'MODEL_UNAVAILABLE',
    err instanceof Error ? err.message : 'Unknown model error',
    true,
  );
}
