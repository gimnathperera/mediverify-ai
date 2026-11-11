/**
 * Robustness: prescription perturbations (fixtures/robustness.json), an adversarial model and an
 * injected extraction, against the real indexed formulary. Same runner as `pnpm eval`.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { ensureReferenceIndexed } from '@mediverify/core';
import type { pg } from '@mediverify/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runRobustness } from '../../scripts/lib/robustness.js';
import { deps, referenceId, silentLog, testPool } from '../helpers/db.js';
import { ROOT } from '../helpers/env.js';

let pool: pg.Pool;
let report: Awaited<ReturnType<typeof runRobustness>>;

beforeAll(async () => {
  pool = testPool();
  const d = deps(pool);
  const refId = await referenceId(pool);
  await ensureReferenceIndexed(pool, d.embedder, refId, silentLog);
  const golden = JSON.parse(await readFile(path.join(ROOT, 'fixtures/golden.json'), 'utf8')) as {
    medications: { drug: string; status: string }[];
  };
  report = await runRobustness({
    root: ROOT,
    pool,
    embedder: d.embedder,
    referenceId: refId,
    ...d.config,
    goldenStatus: Object.fromEntries(golden.medications.map((m) => [m.drug, m.status])),
  });
});

afterAll(async () => {
  await pool.end();
});

describe('robustness: prescription perturbations', () => {
  it('classifies every perturbation as expected', () => {
    const failures = report.perturbations.filter((p) => !p.ok);
    expect(failures).toEqual([]);
    expect(report.perturbations.length).toBeGreaterThanOrEqual(14);
  });
});

describe('robustness: adversarial model', () => {
  it.each(['yes-man', 'alarmist'])('%s: no fabricated claim is accepted', (name) => {
    const r = report.adversarial.find((a) => a.model === name)!;
    expect(r.modelClaims).toBeGreaterThan(0);
    expect(r.fabricatedClaimsAccepted).toBe(0);
    expect(r.contradictionsKept).toBe(true);
    expect(r.newContradictions).toBe(0);
  });
});

describe('robustness: injected extraction', () => {
  it('drops a medication that is not in the document', () => {
    expect(report.injectedDropped).toBe(true);
  });
});
