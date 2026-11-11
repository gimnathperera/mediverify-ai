import 'reflect-metadata';

import { createPool } from '@mediverify/db';
import pino from 'pino';

import { createApp } from './app.js';
import { loadConfig } from './config.js';

const logger = pino({ base: { service: 'api' }, level: process.env.LOG_LEVEL ?? 'info' });

async function main() {
  const config = loadConfig();
  const pool = createPool(config.databaseUrl, 10);
  const app = await createApp({ pool, config, logger });
  await app.listen(config.port, '0.0.0.0');
  logger.info(
    {
      event: 'api.started',
      port: config.port,
      llm_provider: config.llmProvider,
      llm_configured: config.llmConfigured,
    },
    'API listening',
  );
  if (process.env.NODE_ENV === 'production' && !config.secureCookies)
    logger.warn(
      { event: 'config.insecure_cookies' },
      'COOKIE_SECURE is false: set it to true when serving over HTTPS',
    );
  if (config.signupEnabled && config.llmProvider !== 'fixture' && config.llmConfigured)
    logger.warn(
      { event: 'config.open_signup' },
      'Self-service sign-up is enabled with a paid model key; rely on DAILY_JOB_LIMIT and GLOBAL_DAILY_JOB_LIMIT',
    );
  const stop = async () => {
    await app.close();
    await pool.end();
    process.exit(0);
  };
  process.on('SIGTERM', () => void stop());
  process.on('SIGINT', () => void stop());
}

main().catch((err: unknown) => {
  logger.fatal(
    { event: 'api.fatal', error: (err as Error).message, stack: (err as Error).stack },
    'API failed to start',
  );
  process.exit(1);
});
