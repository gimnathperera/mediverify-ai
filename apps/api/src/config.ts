import { envNumber, resolveLlmProvider } from '@mediverify/shared';

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
  /** Self-service sign-up: always on unless ALLOW_SIGNUP=false (spend is capped by the job limits). */
  signupEnabled: boolean;
  /** Pipeline runs (uploads + retries) per user per rolling 24 h; 0 = unlimited. */
  dailyJobLimit: number;
  /** Pipeline runs across all users per rolling 24 h (spend cap for a hosted demo); 0 = unlimited. */
  globalDailyJobLimit: number;
  /** Express `trust proxy` hops (1 behind nginx / the Vite proxy) so rate limits see client IPs. */
  trustProxy: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const provider = resolveLlmProvider(env);
  const num = (name: string, fallback: number) => envNumber(env, name, fallback);
  const webPort = num('WEB_PORT', 8088);
  return {
    port: num('PORT', 3001),
    databaseUrl: env.DATABASE_URL ?? 'postgres://mediverify:mediverify@localhost:55432/mediverify',
    sessionTtlSeconds: num('SESSION_TTL_HOURS', 12) * 3600,
    allowedOrigins: (
      env.ALLOWED_ORIGINS ||
      `http://localhost:${webPort},http://127.0.0.1:${webPort},http://localhost:5173,http://127.0.0.1:5173`
    )
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    duplicateWindowSeconds: num('DUPLICATE_WINDOW_SECONDS', 300),
    secureCookies: env.COOKIE_SECURE === 'true',
    llmProvider: provider,
    llmModel: provider === 'fixture' ? 'fixture' : (env.OPENAI_MODEL ?? 'gpt-5.4-mini'),
    llmConfigured: provider === 'fixture' || Boolean(env.OPENAI_API_KEY),
    maxJobAttempts: num('JOB_MAX_ATTEMPTS', 3),
    signupEnabled: env.ALLOW_SIGNUP !== 'false',
    dailyJobLimit: num('DAILY_JOB_LIMIT', 20),
    globalDailyJobLimit: num('GLOBAL_DAILY_JOB_LIMIT', 200),
    trustProxy: num('TRUST_PROXY', 1),
  };
}
