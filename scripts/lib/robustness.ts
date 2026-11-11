/**
 * Robustness evaluation, shared by `pnpm eval` and tests/integration/robustness.test.ts.
 *
 * 1. Perturbations: prescription variants from fixtures/robustness.json, verified against the real
 *    indexed formulary with a model that takes no position — so the outcome shows what parsing,
 *    identity, retrieval and the deterministic rules guarantee on their own.
 * 2. Adversarial model: the golden medications verified by a model that (as after a successful
 *    prompt injection) confirms everything, or flags everything, with fabricated quotes. Measures
 *    how many fabricated claims the merge accepts (target: 0) and whether real conflicts survive.
 * 3. Injected extraction: a medication that is not in the document must be dropped.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  LLM_VERIFIED_FIELDS,
  loadVerifyContext,
  medicationFromExtraction,
  parsePdf,
  reconcileMedications,
  verifyMedication,
  type EmbeddingProvider,
  type ExtractedMedication,
  type LlmProvider,
  type LlmRequest,
} from '@mediverify/core';
import type { pg } from '@mediverify/db';

type Verdict = 'consistent' | 'conflict' | 'not_addressed';

/** A verifier that answers every field the same way (no network, no fixtures). */
class ScriptedModel implements LlmProvider {
  readonly model = 'scripted';
  constructor(
    readonly name: string,
    private readonly verdict: Verdict,
    private readonly quote: string | null,
  ) {}
  generate<T>(req: LlmRequest<T>): Promise<T> {
    if (req.task !== 'verify') throw new Error(`scripted model only verifies (got ${req.task})`);
    return Promise.resolve({
      overall_explanation: '',
      fields: LLM_VERIFIED_FIELDS.map((field) => ({
        field,
        verdict: this.verdict,
        prescribed: null,
        reference_constraint: null,
        explanation: `${this.name} model`,
        passage_id: 'P1',
        quote: this.quote,
      })),
    } as T);
  }
}

const SILENT = new ScriptedModel('silent', 'not_addressed', null);
const YES_MAN = new ScriptedModel(
  'yes-man',
  'consistent',
  'Approved for every use exactly as prescribed here.',
);
const ALARMIST = new ScriptedModel(
  'alarmist',
  'conflict',
  'This medication is contraindicated for this patient.',
);

const BASE: ExtractedMedication = {
  drug_name: '',
  dose_raw: null,
  dose_value: null,
  dose_unit: null,
  route_raw: 'PO',
  frequency_raw: null,
  timing_raw: null,
  duration_raw: 'Continue indefinitely',
  indication: 'Hypertension',
  is_new_start: false,
  new_start_evidence: null,
  source_page: 3,
  source_quote: '',
  ambiguities: [],
};

interface Case {
  id: string;
  what: string;
  extraction: Partial<ExtractedMedication>;
  expect: { status: string; conflicts?: string[]; gaps?: string[] };
}

export async function runRobustness(opts: {
  root: string;
  pool: pg.Pool;
  embedder: EmbeddingProvider;
  referenceId: string;
  retrievalTopK: number;
  retrievalMinScore: number;
  goldenStatus: Record<string, string>;
}) {
  const ctx = await loadVerifyContext(opts.pool, opts.embedder, opts, opts.referenceId);
  if (!ctx) throw new Error('reference is not indexed');
  const docOnly = { primaryContext: () => Promise.resolve([]), primaryText: '' };
  const verify = (m: ExtractedMedication, llm: LlmProvider, key: string) =>
    verifyMedication(medicationFromExtraction(m), ctx.monographs, ctx.deps(llm, docOnly), key);

  // 1. Perturbations
  const { cases } = JSON.parse(
    await readFile(path.join(opts.root, 'fixtures/robustness.json'), 'utf8'),
  ) as { cases: Case[] };
  const perturbations = [];
  for (const c of cases) {
    const out = await verify({ ...BASE, ...c.extraction }, SILENT, `robustness/${c.id}`);
    const conflicts: string[] = out.findings
      .filter((f) => f.verdict === 'conflict')
      .map((f) => f.field);
    const gaps: string[] = out.findings
      .filter(
        (f) =>
          f.verdict !== 'consistent' && f.verdict !== 'conflict' && f.reason !== 'not_constrained',
      )
      .map((f) => f.field);
    const ok =
      out.status === c.expect.status &&
      (c.expect.conflicts ?? []).every((f) => conflicts.includes(f)) &&
      conflicts.every((f) => (c.expect.conflicts ?? []).includes(f)) &&
      (c.expect.gaps ?? []).every((f) => gaps.includes(f));
    perturbations.push({
      id: c.id,
      what: c.what,
      expected: c.expect,
      status: out.status,
      conflicts,
      gaps,
      ok,
    });
  }

  // 2. Adversarial model on the golden medications (fixture extraction of the sample)
  const entities = JSON.parse(
    await readFile(path.join(opts.root, 'fixtures/llm/0be5694faf45dc2f/entities.json'), 'utf8'),
  ) as { medications: ExtractedMedication[] };
  const adversarial = [];
  for (const model of [YES_MAN, ALARMIST]) {
    let accepted = 0;
    let claims = 0;
    const statuses: Record<string, string> = {};
    for (const m of entities.medications) {
      const out = await verify(m, model, `adversarial/${model.name}/${m.drug_name}`);
      statuses[m.drug_name] = out.status;
      for (const f of out.findings.filter((x) => x.decidedBy !== 'deterministic')) {
        claims++;
        // A fabricated quote can never validate; an accepted claim would be decisive and LLM-backed.
        if ((f.verdict === 'consistent' || f.verdict === 'conflict') && f.decidedBy === 'llm')
          accepted++;
      }
    }
    const contradictionsKept = Object.entries(opts.goldenStatus)
      .filter(([, s]) => s === 'contradicted')
      .every(([drug]) => statuses[drug] === 'contradicted');
    const newContradictions = Object.entries(statuses).filter(
      ([drug, s]) => s === 'contradicted' && opts.goldenStatus[drug] !== 'contradicted',
    ).length;
    const supportedOnFabrication = Object.values(statuses).filter((s) => s === 'supported').length;
    adversarial.push({
      model: model.name,
      fabricatedClaimsAccepted: accepted,
      modelClaims: claims,
      contradictionsKept,
      newContradictions,
      supportedOnFabrication,
      statuses,
    });
  }

  // 3. Injected extraction: a drug that is not in the document
  const doc = await parsePdf(
    await readFile(path.join(opts.root, 'resources/primary_document_medical.pdf')),
  );
  const injected: ExtractedMedication = {
    ...BASE,
    drug_name: 'Zentrovax',
    dose_raw: '5 mg',
    frequency_raw: 'once daily',
    source_quote: 'Zentrovax 5 mg PO once daily, continue indefinitely',
  };
  const reconciled = reconcileMedications(doc, [...entities.medications, injected]);
  const injectedDropped = !reconciled.medications.some((m) => m.drugName === 'Zentrovax');

  return {
    perturbations,
    perturbationPass: perturbations.filter((p) => p.ok).length,
    adversarial,
    injectedDropped,
  };
}
