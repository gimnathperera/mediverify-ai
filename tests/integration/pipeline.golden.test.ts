/**
 * Golden end-to-end test: real parsing, chunking, pgvector retrieval, identity gating, deterministic
 * checks, quote validation and merge — with the deterministic fixture LLM (labeled, hand-authored).
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { quoteAppearsIn } from '@mediverify/core';
import { resultsRepo, type pg } from '@mediverify/db';
import type { ResultsDto } from '@mediverify/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createUser, deps, runJob, testPool, uploadFile } from '../helpers/db.js';
import { ROOT } from '../helpers/env.js';

interface GoldenMed {
  drug: string;
  doseValue: number;
  doseUnit: string;
  route: string;
  frequency: string;
  timing?: string;
  durationRaw: string;
  indication: string;
  sourcePage: number;
  status: string;
  conflictFields: string[];
  monograph: string | null;
  monographPage: number | null;
  similarNames?: string[];
  evidenceFields: string[];
}

let pool: pg.Pool;
let results: ResultsDto;
let golden: { medications: GoldenMed[]; distractorMonographs: string[] };

beforeAll(async () => {
  pool = testPool();
  golden = JSON.parse(await readFile(path.join(ROOT, 'fixtures/golden.json'), 'utf8'));
  const user = await createUser(pool, 'golden');
  const { jobId } = await uploadFile(pool, user.id);
  const outcome = await runJob(pool, jobId, deps(pool));
  expect(outcome).toBe('completed');
  results = (await resultsRepo.getResultsForOwner(pool, jobId, user.id))!;
});

afterAll(async () => {
  await pool.end();
});

describe('golden: extraction', () => {
  it('extracts exactly the six prescribed medications in table order', () => {
    expect(results.medications.map((m) => m.drugName)).toEqual(
      golden.medications.map((g) => g.drug),
    );
  });

  it.each([0, 1, 2, 3, 4, 5])('preserves table values and provenance for medication #%i', (i) => {
    const g = golden.medications[i]!;
    const m = results.medications[i]!;
    expect(m.doseValue).toBe(g.doseValue);
    expect(m.doseUnit).toBe(g.doseUnit);
    expect(m.route).toBe(g.route);
    expect(m.frequency).toBe(g.frequency);
    if (g.timing) expect(m.timing).toBe(g.timing);
    expect(m.durationRaw).toBe(g.durationRaw);
    expect(m.indication).toBe(g.indication);
    expect(m.sourcePage).toBe(g.sourcePage);
    expect(m.sourceQuoteValid).toBe(true);
  });
});

describe('golden: verification outcomes', () => {
  it.each(['Velantine', 'Cordizem-XR', 'Pravoxil', 'Etrazolam', 'Pranixol', 'Quintaxin'])(
    '%s gets the expected status, conflicting fields and monograph',
    (drug) => {
      const g = golden.medications.find((x) => x.drug === drug)!;
      const v = results.verifications.find((x) => x.drugName === drug)!;
      expect(v.status).toBe(g.status);
      expect(v.monographName).toBe(g.monograph);
      const conflicts = v.findings.filter((f) => f.verdict === 'conflict').map((f) => f.field);
      expect(conflicts.sort()).toEqual([...g.conflictFields].sort());
      for (const f of v.findings.filter((x) => x.verdict === 'conflict')) {
        expect(f.citation?.monographName).toBe(g.monograph);
        expect(f.citation?.page).toBe(g.monographPage);
        expect(g.evidenceFields).toContain(f.citation?.fieldLabel);
        expect(f.citation?.quoteValid).toBe(true);
      }
    },
  );

  it('Cordizem-XR is contradicted on the titration schedule, not on the 200 mg maximum', () => {
    const v = results.verifications.find((x) => x.drugName === 'Cordizem-XR')!;
    const dose = v.findings.find((f) => f.field === 'dose')!;
    expect(dose.citation?.quote).toMatch(
      /increments of 25 mg at intervals of no less than two weeks/,
    );
    expect(dose.explanation).toMatch(/50 mg/);
    expect(dose.confidence).not.toBe('high'); // interpretive (new start) — not overclaimed
  });

  it('Pranixol is unsupported (coverage gap), never matched to the similar-looking Pravoxil', () => {
    const v = results.verifications.find((x) => x.drugName === 'Pranixol')!;
    expect(v.status).toBe('unsupported');
    expect(v.monographName).toBeNull();
    expect(v.similarNames).toContain('Pravoxil');
    expect(v.findings.every((f) => f.verdict !== 'conflict' && f.verdict !== 'consistent')).toBe(
      true,
    );
    expect(v.coverageCitation?.section).toMatch(/Drugs not in this digest/);
    expect(v.coverageCitation?.page).toBe(10);
  });

  it('distractor monographs never appear in any finding', () => {
    const cited = results.verifications.flatMap((v) =>
      v.findings.map((f) => f.citation?.monographName),
    );
    for (const d of golden.distractorMonographs) expect(cited).not.toContain(d);
  });
});

describe('golden: hallucination controls', () => {
  it('every cited quote appears verbatim in the cited reference chunk of the matched monograph', async () => {
    for (const v of results.verifications) {
      for (const f of v.findings) {
        if (!f.citation) continue;
        const { rows } = await pool.query<{ text: string; name: string | null }>(
          `SELECT c.text, m.name FROM reference_chunks c LEFT JOIN reference_monographs m ON m.id = c.monograph_id WHERE c.id = $1`,
          [f.citation.chunkId],
        );
        expect(rows[0]).toBeDefined();
        expect(quoteAppearsIn(f.citation.quote, rows[0]!.text)).toBe(f.citation.quoteValid);
        if (f.verdict === 'conflict' || f.verdict === 'consistent') {
          expect(f.citation.quoteValid).toBe(true);
          expect(rows[0]!.name).toBe(v.monographName);
        }
      }
    }
  });

  it('every critical point has a validated primary-document quote and page', () => {
    expect(results.criticalPoints.length).toBeGreaterThanOrEqual(5);
    for (const p of results.criticalPoints) {
      expect(p.sources.length).toBeGreaterThan(0);
      for (const s of p.sources) {
        expect(s.quoteValid).toBe(true);
        expect(s.page).toBeGreaterThan(0);
      }
    }
  });

  it('preserves the psychiatry follow-up discrepancy instead of smoothing it over', () => {
    const d = results.criticalPoints.find((p) => p.category === 'document_discrepancy');
    expect(d).toBeDefined();
    expect(d!.sources.length).toBeGreaterThanOrEqual(2);
    expect(d!.sources.map((s) => s.quote).join(' ')).toMatch(/two weeks[\s\S]*8-week/);
  });

  it('critical points restate the primary document (Pravoxil morning) without formulary rewriting', () => {
    const p = results.criticalPoints.find(
      (x) => x.relatedMedication === 'Pravoxil' && x.category === 'administration_timing',
    );
    expect(p?.text).toMatch(/morning/i);
    expect(p?.text).not.toMatch(/bedtime/i);
  });

  it('summary exists and passes the faithfulness guard', () => {
    expect(results.summary?.text.length).toBeGreaterThan(200);
    expect(results.summary?.warnings).toEqual([]);
  });
});
