import path from 'node:path';

import type { Logger } from 'pino';

import { LocalEmbeddingProvider } from '../embeddings/local.js';
import { FixtureProvider } from '../llm/fixture.js';
import { OpenAiProvider } from '../llm/openai.js';
import { LlmError, type EmbeddingProvider, type LlmProvider } from '../llm/types.js';

/** Provider used when no API key is configured: every call fails with a clear, surfaced error. */
export class UnconfiguredProvider implements LlmProvider {
  readonly name = 'openai';
  constructor(readonly model: string) {}
  generate<T>(): Promise<T> {
    return Promise.reject(
      new LlmError(
        'MODEL_NOT_CONFIGURED',
        'No LLM is configured: set OPENAI_API_KEY (or LLM_PROVIDER=fixture for the bundled sample) and retry.',
      ),
    );
  }
}

export function createLlmProvider(env: NodeJS.ProcessEnv, logger?: Logger): LlmProvider {
  const provider = (env.LLM_PROVIDER ?? 'openai').toLowerCase();
  if (provider === 'fixture') {
    return new FixtureProvider(env.LLM_FIXTURE_DIR ?? path.resolve('fixtures/llm'));
  }
  const model = env.OPENAI_MODEL ?? 'gpt-5.4-mini';
  if (!env.OPENAI_API_KEY) return new UnconfiguredProvider(model);
  const effort = env.OPENAI_REASONING_EFFORT as 'minimal' | 'low' | 'medium' | 'high' | undefined;
  return new OpenAiProvider({
    apiKey: env.OPENAI_API_KEY,
    model,
    baseURL: env.OPENAI_BASE_URL || undefined,
    timeoutMs: Number(env.LLM_TIMEOUT_MS ?? 90_000),
    maxRetries: Number(env.LLM_MAX_RETRIES ?? 3),
    reasoningEffort: effort || undefined,
    temperature: env.OPENAI_TEMPERATURE ? Number(env.OPENAI_TEMPERATURE) : undefined,
    recordDir: env.LLM_RECORD_DIR || undefined,
    logger,
  });
}

export function createEmbeddingProvider(env: NodeJS.ProcessEnv): EmbeddingProvider {
  return new LocalEmbeddingProvider(
    env.EMBEDDING_MODEL ?? 'Xenova/bge-small-en-v1.5',
    env.EMBEDDING_CACHE_DIR ?? path.resolve('.model-cache'),
  );
}
