import type { pg } from '@mediverify/db';
import { DEMO_DISCLAIMER, MAX_UPLOAD_BYTES } from '@mediverify/shared';
import { Controller, Get, Inject } from '@nestjs/common';

import { Public } from '../common/auth.js';
import type { AppConfig } from '../config.js';
import { APP_CONFIG, PG_POOL } from '../tokens.js';

@Controller()
export class HealthController {
  constructor(
    @Inject(PG_POOL) private readonly pool: pg.Pool,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Public()
  @Get('health')
  async health() {
    await this.pool.query('SELECT 1');
    return { status: 'ok' };
  }

  /** Non-secret runtime info for the UI (fixture-mode banner, model-unavailable warning). */
  @Public()
  @Get('config')
  config_() {
    return {
      llmProvider: this.config.llmProvider,
      llmModel: this.config.llmModel,
      llmConfigured: this.config.llmConfigured,
      fixtureMode: this.config.llmProvider === 'fixture',
      maxUploadBytes: MAX_UPLOAD_BYTES,
      signupEnabled: this.config.signupEnabled,
      dailyJobLimit: this.config.dailyJobLimit,
      disclaimer: DEMO_DISCLAIMER,
    };
  }
}
