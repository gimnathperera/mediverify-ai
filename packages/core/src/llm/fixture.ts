import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { LlmError, type LlmProvider, type LlmRequest } from './types.js';

/**
 * Deterministic provider for tests and offline demos. Reads `<fixtureDir>/<fixtureKey>.json`
 * and validates it against the same schema as real model output. Unknown documents fail with
 * FIXTURE_NOT_FOUND — this provider never fabricates output. Clearly labeled in UI and logs.
 */
export class FixtureProvider implements LlmProvider {
  readonly name = 'fixture';
  readonly model = 'fixture';

  constructor(private readonly fixtureDir: string) {}

  async generate<T>(req: LlmRequest<T>): Promise<T> {
    const file = path.join(this.fixtureDir, `${req.fixtureKey}.json`);
    let raw: string;
    try {
      raw = await readFile(file, 'utf8');
    } catch {
      throw new LlmError(
        'FIXTURE_NOT_FOUND',
        `No fixture output exists for this document (${req.task}). Fixture mode only supports the bundled sample; configure OPENAI_API_KEY for real inference.`,
      );
    }
    const result = req.schema.safeParse(JSON.parse(raw));
    if (!result.success) {
      throw new LlmError('MODEL_OUTPUT_INVALID', `Fixture ${req.fixtureKey} does not match schema`);
    }
    req.onUsage?.({ promptTokens: 0, completionTokens: 0 }); // counted as a call, no tokens
    return result.data;
  }
}
