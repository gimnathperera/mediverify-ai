export interface AppConfig {
  port: number;
  databaseUrl: string;
  sessionTtlSeconds: number;
  allowedOrigins: string[];
  duplicateWindowSeconds: number;
  secureCookies: boolean;
  llmProvider: string;
  llmModel: string;
  llmConfigured: boolean;
  maxJobAttempts: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const provider = (env.LLM_PROVIDER ?? 'openai').toLowerCase();
  return {
    port: Number(env.PORT ?? 3001),
    databaseUrl: env.DATABASE_URL ?? 'postgres://mediverify:mediverify@localhost:55432/mediverify',
    sessionTtlSeconds: Number(env.SESSION_TTL_HOURS ?? 12) * 3600,
    allowedOrigins: (env.ALLOWED_ORIGINS ?? 'http://localhost:8088,http://localhost:5173')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    duplicateWindowSeconds: Number(env.DUPLICATE_WINDOW_SECONDS ?? 300),
    secureCookies: env.COOKIE_SECURE === 'true',
    llmProvider: provider,
    llmModel: provider === 'fixture' ? 'fixture' : (env.OPENAI_MODEL ?? 'gpt-5.4-mini'),
    llmConfigured: provider === 'fixture' || Boolean(env.OPENAI_API_KEY),
    maxJobAttempts: Number(env.JOB_MAX_ATTEMPTS ?? 3),
  };
}
