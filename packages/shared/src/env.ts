/** Small env helpers shared by the API and worker (no zod, no node types needed). */
export type Env = Record<string, string | undefined>;

/** A numeric setting; empty/undefined → fallback, anything non-numeric fails fast at startup. */
export function envNumber(env: Env, name: string, fallback: number): number {
  const v = env[name];
  if (v === undefined || v.trim() === '') return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`Invalid number for ${name}: "${v}"`);
  return n;
}

/**
 * LLM provider: explicit `LLM_PROVIDER` wins; otherwise `openai` when a key is configured, else
 * the labelled `fixture` provider, so a fresh clone without a key still runs the bundled sample.
 */
export function resolveLlmProvider(env: Env): string {
  const explicit = env.LLM_PROVIDER?.trim().toLowerCase();
  if (explicit) return explicit;
  return env.OPENAI_API_KEY ? 'openai' : 'fixture';
}
