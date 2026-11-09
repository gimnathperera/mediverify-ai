/**
 * Reproducible RAG evaluation. Measures — never assumes — the following:
 *  1. Identity gate: correct monograph for known drugs; correct NEGATIVE for absent / look-alike names.
 *  2. Naive (ungated) vector retrieval over the whole reference: hit@1/hit@3 for known drugs, and what it
 *     returns for absent drugs (shows why identity gating is required).
 *  3. Targeted within-monograph hybrid retrieval: Recall@3 / Recall@K of the evidence fields each golden
 *     finding depends on.
 *  4. End-to-end pipeline run on the golden document: per-medication status accuracy, conflict-field
 *     precision/recall, extraction accuracy by field, citation validity.
 *
 * Usage: pnpm eval [--live] [--out report.json]
 *   default LLM = fixture (hand-authored outputs, deterministic); --live uses OpenAI (needs OPENAI_API_KEY).
 */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  createEmbeddingProvider,
  createLlmProvider,
  ensureReferenceIndexed,
  matchMonograph,
  retrievalQuery,
  runClaimedJob,
  type MedicationForCheck,
} from '@mediverify/core';
import {
  createPool,
  documentsRepo,
  referencesRepo,
  resultsRepo,
  runMigrations,
  usersRepo,
  withTransaction,
} from '@mediverify/db';
import pino from 'pino';

const args = process.argv.slice(2);
const live = args.includes('--live');
if (live && !process.env.OPENAI_API_KEY) {
  console.error('eval --live needs OPENAI_API_KEY (set it in .env or the environment).');
  process.exit(1);
}
const outIdx = args.indexOf('--out');
const outFile = outIdx >= 0 ? args[outIdx + 1] : undefined;
const K = Number(process.env.RETRIEVAL_TOP_K ?? 6);
const ROOT = process.cwd();

interface Golden {
  medications: {
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
    evidenceFields: string[];
  }[];
  distractorMonographs: string[];
}

const NEGATIVE_NAMES = [
  'Pranixol',
  'Velantina',
  'Quintaxol',
  'Etrazepam',
  'Floranex',
  'Sumavastin',
  'Cordizem',
];

const log = pino({ level: process.env.LOG_LEVEL ?? 'warn' });
const pool = createPool(
  process.env.DATABASE_URL ?? 'postgres://mediverify:mediverify@localhost:55432/mediverify',
  4,
);
const pct = (n: number, d: number) => (d === 0 ? 'n/a' : `${((100 * n) / d).toFixed(1)}%`);

try {
  await runMigrations(pool, path.join(ROOT, 'db/migrations'));
  const refBytes = await readFile(path.join(ROOT, 'resources/reference_document_medical.pdf'));
  const refId = await referencesRepo.upsertReference(pool, {
    slug: 'mbmc-formulary-digest',
    title: 'Meridian Bay Medical Center — Institutional Formulary Digest',
    versionLabel: '8.2',
    filename: 'reference_document_medical.pdf',
    mimeType: 'application/pdf',
    sha256: createHash('sha256').update(refBytes).digest('hex'),
    bytes: refBytes,
  });
  const embedder = createEmbeddingProvider(process.env);
  await ensureReferenceIndexed(pool, embedder, refId, log);
  const golden = JSON.parse(
    await readFile(path.join(ROOT, 'fixtures/golden.json'), 'utf8'),
  ) as Golden;
  const monographs = (await referencesRepo.listMonographs(pool, refId)).map((m) => ({
    id: m.id,
    name: m.name,
    nameNormalized: m.name_normalized,
    aliases: m.aliases,
  }));

  // ── 1. identity gate ──
  const known = golden.medications.filter((m) => m.monograph);
  const identityPos = known.map((m) => ({
    drug: m.drug,
    matched: matchMonograph(m.drug, monographs)?.name ?? null,
    ok: matchMonograph(m.drug, monographs)?.name === m.monograph,
  }));
  const negatives = [
    ...new Set([
      ...golden.medications.filter((m) => !m.monograph).map((m) => m.drug),
      ...NEGATIVE_NAMES,
    ]),
  ];
  const identityNeg = negatives.map((d) => ({
    drug: d,
    matched: matchMonograph(d, monographs)?.name ?? null,
    ok: matchMonograph(d, monographs) === null,
  }));

  // ── 2. naive ungated vector retrieval (diagnostic) ──
  const naive = [];
  for (const name of [...known.map((m) => m.drug), ...negatives]) {
    const qv = await embedder.embedQuery(`${name} standard adult dose frequency`);
    const rows = await referencesRepo.searchReferenceChunks(pool, refId, qv, 3);
    const top = rows.map((r) => ({
      monograph:
        monographs.find((m) => m.id === r.monograph_id)?.name ??
        `(${r.medication_name_normalized ?? 'non-monograph'})`,
      score: Number(r.vector_score.toFixed(3)),
    }));
    const expected = known.find((m) => m.drug === name)?.monograph ?? null;
    naive.push({
      query: name,
      expected,
      top1: top[0]?.monograph,
      top1Score: top[0]?.score,
      hit1: expected ? top[0]?.monograph === expected : null,
      hit3: expected ? top.some((t) => t.monograph === expected) : null,
    });
  }

  // ── 3. targeted within-monograph retrieval ──
  const targeted = [];
  for (const g of known) {
    const mono = matchMonograph(g.drug, monographs)!;
    const med: MedicationForCheck = {
      drugName: g.drug,
      doseValue: g.doseValue,
      doseUnit: g.doseUnit,
      doseRaw: `${g.doseValue} ${g.doseUnit}`,
      route: g.route,
      frequency: g.frequency,
      frequencyRaw: g.frequency.replace('_', ' '),
      timing: g.timing ?? null,
      durationValue: null,
      durationUnit: null,
      durationRaw: g.durationRaw,
      indication: g.indication,
      isNewStart: true,
    };
    const q = retrievalQuery(med);
    const qv = await embedder.embedQuery(q);
    const rows = await referencesRepo.searchMonographChunks(pool, mono.id, qv, q, K);
    const labels = rows.map((r) => r.field_label);
    const need = g.evidenceFields;
    targeted.push({
      drug: g.drug,
      expectedFields: need,
      retrieved: labels,
      recallAt3: need.filter((f) => labels.slice(0, 3).includes(f)).length / need.length,
      recallAtK: need.filter((f) => labels.includes(f)).length / need.length,
      allFromMatchedMonograph: rows.every((r) => r.monograph_id === mono.id),
    });
  }

  // ── 4. end-to-end pipeline on the golden document ──
  const llm = createLlmProvider(
    {
      ...process.env,
      // Deterministic by default, even if .env selects openai for the app; --live opts in.
      LLM_PROVIDER: live ? 'openai' : 'fixture',
      LLM_FIXTURE_DIR: path.join(ROOT, 'fixtures/llm'),
    },
    log,
  );
  const primary = await readFile(path.join(ROOT, 'resources/primary_document_medical.pdf'));
  const user = (await usersRepo.createUser(pool, `eval-${Date.now()}@eval.local`, 'n/a'))!;
  const { jobId } = await withTransaction(pool, (c) =>
    documentsRepo.insertUploadRecords(c, {
      ownerId: user.id,
      referenceId: refId,
      filename: 'primary.pdf',
      mimeType: 'application/pdf',
      sizeBytes: primary.length,
      sha256: createHash('sha256').update(primary).digest('hex'),
      bytes: primary,
      maxAttempts: 1,
    }),
  );
  const claimed = await pool.query<{
    id: string;
    document_id: string;
    attempts: number;
    max_attempts: number;
  }>(
    `UPDATE jobs SET status='running', attempts=1, lease_owner='eval', lease_expires_at=now()+interval '30 minutes', started_at=now()
      WHERE id=$1 RETURNING id, document_id, attempts, max_attempts`,
    [jobId],
  );
  const started = Date.now();
  const outcome = await runClaimedJob(
    {
      pool,
      llm,
      embedder,
      config: {
        retrievalTopK: K,
        retrievalMinScore: Number(process.env.RETRIEVAL_MIN_SCORE ?? 0.35),
      },
    },
    claimed.rows[0]!,
    { workerId: 'eval', leaseSeconds: 1800, stageTimeoutMs: 600_000, retryBaseDelaySeconds: 0 },
    log,
  );
  const e2eMs = Date.now() - started;
  const results = await resultsRepo.getResultsForOwner(pool, jobId, user.id);
  const jobRow = await pool.query<{ error_code: string | null; error_message: string | null }>(
    'SELECT error_code, error_message FROM jobs WHERE id=$1',
    [jobId],
  );

  const perMed = golden.medications.map((g) => {
    const m = results?.medications.find((x) => x.drugName.toLowerCase() === g.drug.toLowerCase());
    const v = results?.verifications.find((x) => x.drugName.toLowerCase() === g.drug.toLowerCase());
    const conflicts: string[] =
      v?.findings.filter((f) => f.verdict === 'conflict').map((f) => f.field) ?? [];
    return {
      drug: g.drug,
      expectedStatus: g.status,
      actualStatus: v?.status ?? '(missing)',
      statusOk: v?.status === g.status,
      expectedConflicts: g.conflictFields,
      actualConflicts: conflicts,
      extraction: m
        ? {
            dose: m.doseValue === g.doseValue && m.doseUnit === g.doseUnit,
            route: m.route === g.route,
            frequency: m.frequency === g.frequency,
            timing: g.timing ? m.timing === g.timing : true,
            duration: m.durationRaw === g.durationRaw,
            indication: m.indication === g.indication,
            sourcePage: m.sourcePage === g.sourcePage,
          }
        : null,
    };
  });
  const tp = perMed.reduce(
    (n, p) => n + p.actualConflicts.filter((f) => p.expectedConflicts.includes(f)).length,
    0,
  );
  const fp = perMed.reduce(
    (n, p) => n + p.actualConflicts.filter((f) => !p.expectedConflicts.includes(f)).length,
    0,
  );
  const fn = perMed.reduce(
    (n, p) => n + p.expectedConflicts.filter((f) => !p.actualConflicts.includes(f)).length,
    0,
  );
  const extractionFields = [
    'dose',
    'route',
    'frequency',
    'timing',
    'duration',
    'indication',
    'sourcePage',
  ] as const;
  const extractionAcc = Object.fromEntries(
    extractionFields.map((f) => [
      f,
      pct(perMed.filter((p) => p.extraction?.[f]).length, golden.medications.length),
    ]),
  );
  const citations =
    results?.verifications.flatMap((v) => v.findings.map((f) => f.citation).filter(Boolean)) ?? [];
  const decisive =
    results?.verifications.flatMap((v) =>
      v.findings.filter((f) => f.verdict === 'conflict' || f.verdict === 'consistent'),
    ) ?? [];
  const cpSources = results?.criticalPoints.flatMap((p) => p.sources) ?? [];
  const distractorFindings = citations.filter((c) =>
    golden.distractorMonographs.includes(c!.monographName ?? ''),
  ).length;

  const report = {
    generatedAt: new Date().toISOString(),
    llm: {
      provider: llm.name,
      model: llm.model,
      mode: live
        ? 'LIVE model inference'
        : llm.name === 'fixture'
          ? 'FIXTURE (hand-authored LLM outputs; retrieval/checks are real)'
          : 'live',
    },
    embeddingModel: embedder.model,
    topK: K,
    identityGate: {
      positiveAccuracy: pct(identityPos.filter((x) => x.ok).length, identityPos.length),
      negativeAccuracy: pct(identityNeg.filter((x) => x.ok).length, identityNeg.length),
      positives: identityPos,
      negatives: identityNeg,
    },
    naiveVectorRetrieval: {
      note: 'Ungated similarity over all chunks — diagnostic only, NOT used for identity.',
      hitAt1: pct(naive.filter((n) => n.hit1).length, known.length),
      hitAt3: pct(naive.filter((n) => n.hit3).length, known.length),
      rows: naive,
    },
    targetedRetrieval: {
      meanRecallAt3: (targeted.reduce((s, t) => s + t.recallAt3, 0) / targeted.length).toFixed(3),
      meanRecallAtK: (targeted.reduce((s, t) => s + t.recallAtK, 0) / targeted.length).toFixed(3),
      allPassagesFromMatchedMonograph: targeted.every((t) => t.allFromMatchedMonograph),
      rows: targeted,
    },
    endToEnd: {
      outcome,
      jobError: jobRow.rows[0]?.error_code
        ? `${jobRow.rows[0].error_code}: ${jobRow.rows[0].error_message}`
        : null,
      durationMs: e2eMs,
      medicationsExtracted: results?.medications.length ?? 0,
      statusAccuracy: pct(perMed.filter((p) => p.statusOk).length, perMed.length),
      conflictFieldPrecision: pct(tp, tp + fp),
      conflictFieldRecall: pct(tp, tp + fn),
      extractionAccuracyByField: extractionAcc,
      citationValidity: pct(citations.filter((c) => c!.quoteValid).length, citations.length),
      decisiveFindingsWithValidEvidence: pct(
        decisive.filter((f) => f.citation?.quoteValid).length,
        decisive.length,
      ),
      criticalPointQuoteValidity: pct(
        cpSources.filter((s) => s.quoteValid).length,
        cpSources.length,
      ),
      criticalPoints: results?.criticalPoints.length ?? 0,
      distractorMonographFindings: distractorFindings,
      perMedication: perMed,
    },
  };

  const lines = [
    `# Evaluation (${report.llm.mode}; ${report.llm.provider}:${report.llm.model}; embeddings ${report.embeddingModel}; K=${K})`,
    `identity gate: positives ${report.identityGate.positiveAccuracy}, negatives ${report.identityGate.negativeAccuracy}`,
    `naive ungated retrieval: hit@1 ${report.naiveVectorRetrieval.hitAt1}, hit@3 ${report.naiveVectorRetrieval.hitAt3}; absent-drug top-1: ${naive
      .filter((n) => !n.expected)
      .map((n) => `${n.query}→${n.top1} (${n.top1Score})`)
      .join(', ')}`,
    `targeted retrieval: mean Recall@3 ${report.targetedRetrieval.meanRecallAt3}, Recall@${K} ${report.targetedRetrieval.meanRecallAtK}`,
    `end-to-end (${outcome}, ${e2eMs} ms): status ${report.endToEnd.statusAccuracy}, conflict-field P ${report.endToEnd.conflictFieldPrecision} / R ${report.endToEnd.conflictFieldRecall}, citations valid ${report.endToEnd.citationValidity}, critical-point quotes valid ${report.endToEnd.criticalPointQuoteValidity}, distractor findings ${distractorFindings}`,
    `extraction accuracy: ${Object.entries(extractionAcc)
      .map(([k, v]) => `${k} ${v}`)
      .join(', ')}`,
    ...perMed.map(
      (p) =>
        `  ${p.statusOk ? '✓' : '✗'} ${p.drug}: expected ${p.expectedStatus} [${p.expectedConflicts.join(',')}] → got ${p.actualStatus} [${p.actualConflicts.join(',')}]`,
    ),
  ];
  console.log(lines.join('\n'));
  if (report.endToEnd.jobError) console.log(`job error: ${report.endToEnd.jobError}`);
  if (outFile) await writeFile(outFile, `${JSON.stringify(report, null, 2)}\n`);
} finally {
  await pool.end();
}
