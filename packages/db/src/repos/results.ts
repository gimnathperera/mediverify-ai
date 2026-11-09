import type {
  CitationDto,
  CriticalPointDto,
  FindingDto,
  JobStatus,
  MedicationDto,
  ResultsDto,
  VerificationDto,
} from '@mediverify/shared';

import { toVectorLiteral, type Queryable } from '../pool.js';

// ───────────── document chunks ─────────────
export interface DocumentChunkInput {
  ordinal: number;
  kind: 'prose' | 'table' | 'table_row' | 'heading';
  pageStart: number;
  pageEnd: number;
  sectionTitle: string | null;
  text: string;
  data: unknown;
}

export async function replaceDocumentChunks(
  q: Queryable,
  jobId: string,
  documentId: string,
  chunks: DocumentChunkInput[],
) {
  await q.query('DELETE FROM document_chunks WHERE job_id = $1', [jobId]);
  for (const c of chunks) {
    await q.query(
      `INSERT INTO document_chunks(job_id, document_id, ordinal, kind, page_start, page_end, section_title, text, data)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        jobId,
        documentId,
        c.ordinal,
        c.kind,
        c.pageStart,
        c.pageEnd,
        c.sectionTitle,
        c.text,
        c.data === undefined ? null : JSON.stringify(c.data),
      ],
    );
  }
}

export interface DocumentChunkRow {
  id: string;
  ordinal: number;
  kind: DocumentChunkInput['kind'];
  page_start: number;
  page_end: number;
  section_title: string | null;
  text: string;
  data: unknown;
}

export async function getDocumentChunks(q: Queryable, jobId: string) {
  const { rows } = await q.query<DocumentChunkRow>(
    `SELECT id, ordinal, kind, page_start, page_end, section_title, text, data
       FROM document_chunks WHERE job_id = $1 ORDER BY ordinal`,
    [jobId],
  );
  return rows;
}

export async function setDocumentChunkEmbeddings(
  q: Queryable,
  items: { id: string; embedding: number[] }[],
  model: string,
) {
  for (const it of items) {
    await q.query('UPDATE document_chunks SET embedding = $2, embedding_model = $3 WHERE id = $1', [
      it.id,
      toVectorLiteral(it.embedding),
      model,
    ]);
  }
}

// ───────────── summary & critical points ─────────────
export async function saveSummary(
  q: Queryable,
  jobId: string,
  text: string,
  warnings: string[],
  model: string,
) {
  await q.query(
    `INSERT INTO document_summaries(job_id, text, warnings, model) VALUES ($1,$2,$3,$4)
     ON CONFLICT (job_id) DO UPDATE SET text = EXCLUDED.text, warnings = EXCLUDED.warnings,
       model = EXCLUDED.model, created_at = now()`,
    [jobId, text, warnings, model],
  );
}

export type CriticalPointInput = Omit<CriticalPointDto, 'id'>;

export async function replaceCriticalPoints(
  q: Queryable,
  jobId: string,
  points: CriticalPointInput[],
) {
  await q.query('DELETE FROM critical_points WHERE job_id = $1', [jobId]);
  for (const p of points) {
    await q.query(
      `INSERT INTO critical_points(job_id, rank, category, severity, text, related_medication, sources)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        jobId,
        p.rank,
        p.category,
        p.severity,
        p.text,
        p.relatedMedication,
        JSON.stringify(p.sources),
      ],
    );
  }
}

// ───────────── medications ─────────────
export interface MedicationInput extends Omit<MedicationDto, 'id'> {
  drugNameNormalized: string;
  isNewStart: boolean | null;
}

export async function replaceMedications(q: Queryable, jobId: string, meds: MedicationInput[]) {
  // verification_results cascade from medication_entities.
  await q.query('DELETE FROM medication_entities WHERE job_id = $1', [jobId]);
  for (const m of meds) {
    await q.query(
      `INSERT INTO medication_entities(job_id, ordinal, drug_name, drug_name_normalized, dose_value, dose_unit,
              dose_raw, route, route_raw, frequency, frequency_raw, timing, duration_value, duration_unit,
              duration_raw, indication, is_new_start, source_page, source_quote, source_quote_valid, ambiguities)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
      [
        jobId,
        m.ordinal,
        m.drugName,
        m.drugNameNormalized,
        m.doseValue,
        m.doseUnit,
        m.doseRaw,
        m.route,
        m.routeRaw,
        m.frequency,
        m.frequencyRaw,
        m.timing,
        m.durationValue,
        m.durationUnit,
        m.durationRaw,
        m.indication,
        m.isNewStart,
        m.sourcePage,
        m.sourceQuote,
        m.sourceQuoteValid,
        m.ambiguities,
      ],
    );
  }
}

interface MedRow {
  id: string;
  ordinal: number;
  drug_name: string;
  drug_name_normalized: string;
  dose_value: number | null;
  dose_unit: string | null;
  dose_raw: string | null;
  route: string | null;
  route_raw: string | null;
  frequency: string | null;
  frequency_raw: string | null;
  timing: string | null;
  duration_value: number | null;
  duration_unit: string | null;
  duration_raw: string | null;
  indication: string | null;
  is_new_start: boolean | null;
  source_page: number | null;
  source_quote: string | null;
  source_quote_valid: boolean;
  ambiguities: string[];
}

function toMedication(r: MedRow): MedicationInput & { id: string } {
  return {
    id: r.id,
    ordinal: r.ordinal,
    drugName: r.drug_name,
    drugNameNormalized: r.drug_name_normalized,
    doseValue: r.dose_value,
    doseUnit: r.dose_unit,
    doseRaw: r.dose_raw,
    route: r.route,
    routeRaw: r.route_raw,
    frequency: r.frequency,
    frequencyRaw: r.frequency_raw,
    timing: r.timing,
    durationValue: r.duration_value,
    durationUnit: r.duration_unit,
    durationRaw: r.duration_raw,
    indication: r.indication,
    isNewStart: r.is_new_start,
    sourcePage: r.source_page,
    sourceQuote: r.source_quote,
    sourceQuoteValid: r.source_quote_valid,
    ambiguities: r.ambiguities,
  };
}

export async function getMedications(q: Queryable, jobId: string) {
  const { rows } = await q.query<MedRow>(
    'SELECT * FROM medication_entities WHERE job_id = $1 ORDER BY ordinal',
    [jobId],
  );
  return rows.map(toMedication);
}

// ───────────── verification ─────────────
export interface FindingInput {
  field: FindingDto['field'];
  verdict: FindingDto['verdict'];
  prescribedValue: string | null;
  referenceConstraint: string | null;
  explanation: string;
  decidedBy: FindingDto['decidedBy'];
  confidence: FindingDto['confidence'];
  chunkId: string | null;
  quote: string | null;
  quoteValid: boolean;
}

export interface VerificationInput {
  medicationId: string;
  status: VerificationDto['status'];
  monographId: string | null;
  summary: string;
  similarNames: string[];
  coverageChunkId: string | null;
  retrieval: unknown;
  findings: FindingInput[];
}

export async function replaceVerifications(
  q: Queryable,
  jobId: string,
  results: VerificationInput[],
) {
  await q.query('DELETE FROM verification_results WHERE job_id = $1', [jobId]);
  for (const r of results) {
    const { rows } = await q.query<{ id: string }>(
      `INSERT INTO verification_results(job_id, medication_entity_id, status, monograph_id, summary,
              similar_names, coverage_chunk_id, retrieval)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [
        jobId,
        r.medicationId,
        r.status,
        r.monographId,
        r.summary,
        r.similarNames,
        r.coverageChunkId,
        JSON.stringify(r.retrieval ?? {}),
      ],
    );
    const resultId = rows[0]!.id;
    let ordinal = 0;
    for (const f of r.findings) {
      await q.query(
        `INSERT INTO verification_findings(verification_result_id, field, verdict, prescribed_value,
                reference_constraint, explanation, decided_by, confidence, chunk_id, quote, quote_valid, ordinal)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          resultId,
          f.field,
          f.verdict,
          f.prescribedValue,
          f.referenceConstraint,
          f.explanation,
          f.decidedBy,
          f.confidence,
          f.chunkId,
          f.quote,
          f.quoteValid,
          ordinal++,
        ],
      );
    }
  }
}

// ───────────── read model (owner-scoped) ─────────────
interface CitationRow {
  chunk_id: string | null;
  reference_document_id: string | null;
  monograph_name: string | null;
  c_section: string | null;
  c_field: string | null;
  c_page: number | null;
}

function toCitation(r: CitationRow, quote: string | null, quoteValid: boolean): CitationDto | null {
  if (!r.chunk_id || !r.reference_document_id) return null;
  return {
    chunkId: r.chunk_id,
    referenceId: r.reference_document_id,
    monographName: r.monograph_name,
    section: r.c_section,
    fieldLabel: r.c_field,
    page: r.c_page,
    quote: quote ?? '',
    quoteValid,
  };
}

export async function getResultsForOwner(
  q: Queryable,
  jobId: string,
  ownerId: string,
): Promise<ResultsDto | null> {
  const job = await q.query<{
    id: string;
    document_id: string;
    status: JobStatus;
    llm_provider: string | null;
    llm_model: string | null;
  }>(
    'SELECT id, document_id, status, llm_provider, llm_model FROM jobs WHERE id = $1 AND owner_id = $2',
    [jobId, ownerId],
  );
  const j = job.rows[0];
  if (!j) return null;

  const summary = await q.query<{ text: string; warnings: string[]; model: string }>(
    'SELECT text, warnings, model FROM document_summaries WHERE job_id = $1',
    [jobId],
  );
  const points = await q.query<{
    id: string;
    rank: number;
    category: CriticalPointDto['category'];
    severity: CriticalPointDto['severity'];
    text: string;
    related_medication: string | null;
    sources: CriticalPointDto['sources'];
  }>('SELECT * FROM critical_points WHERE job_id = $1 ORDER BY rank', [jobId]);
  const meds = await getMedications(q, jobId);

  const vr = await q.query<
    {
      id: string;
      medication_entity_id: string;
      status: VerificationDto['status'];
      summary: string;
      similar_names: string[];
      monograph_name: string | null;
      cov_quote: string | null;
    } & CitationRow
  >(
    `SELECT v.id, v.medication_entity_id, v.status, v.summary, v.similar_names, m.name AS monograph_name,
            c.id AS chunk_id, c.reference_document_id, NULL::text AS monograph_name_c,
            c.section_title AS c_section, c.field_label AS c_field, c.page_start AS c_page, c.text AS cov_quote
       FROM verification_results v
       LEFT JOIN reference_monographs m ON m.id = v.monograph_id
       LEFT JOIN reference_chunks c ON c.id = v.coverage_chunk_id
      WHERE v.job_id = $1`,
    [jobId],
  );
  const findings = await q.query<
    {
      id: string;
      verification_result_id: string;
      field: FindingDto['field'];
      verdict: FindingDto['verdict'];
      prescribed_value: string | null;
      reference_constraint: string | null;
      explanation: string;
      decided_by: FindingDto['decidedBy'];
      confidence: FindingDto['confidence'];
      quote: string | null;
      quote_valid: boolean;
    } & CitationRow
  >(
    `SELECT f.id, f.verification_result_id, f.field, f.verdict, f.prescribed_value, f.reference_constraint,
            f.explanation, f.decided_by, f.confidence, f.quote, f.quote_valid,
            c.id AS chunk_id, c.reference_document_id, m.name AS monograph_name,
            c.section_title AS c_section, c.field_label AS c_field, c.page_start AS c_page
       FROM verification_findings f
       JOIN verification_results v ON v.id = f.verification_result_id
       LEFT JOIN reference_chunks c ON c.id = f.chunk_id
       LEFT JOIN reference_monographs m ON m.id = c.monograph_id
      WHERE v.job_id = $1 ORDER BY f.ordinal`,
    [jobId],
  );

  const medName = new Map(meds.map((m) => [m.id, { name: m.drugName, ordinal: m.ordinal }]));
  const verifications: VerificationDto[] = vr.rows
    .map((v) => ({
      id: v.id,
      medicationId: v.medication_entity_id,
      drugName: medName.get(v.medication_entity_id)?.name ?? '',
      status: v.status,
      monographName: v.monograph_name,
      summary: v.summary,
      similarNames: v.similar_names,
      coverageCitation: toCitation(
        { ...v, monograph_name: null },
        v.cov_quote,
        v.cov_quote !== null,
      ),
      findings: findings.rows
        .filter((f) => f.verification_result_id === v.id)
        .map((f): FindingDto => ({
          id: f.id,
          field: f.field,
          verdict: f.verdict,
          prescribedValue: f.prescribed_value,
          referenceConstraint: f.reference_constraint,
          explanation: f.explanation,
          decidedBy: f.decided_by,
          confidence: f.confidence,
          citation: toCitation(f, f.quote, f.quote_valid),
        })),
    }))
    .sort(
      (a, b) =>
        (medName.get(a.medicationId)?.ordinal ?? 0) - (medName.get(b.medicationId)?.ordinal ?? 0),
    );

  const s = summary.rows[0];
  return {
    jobId: j.id,
    documentId: j.document_id,
    status: j.status,
    llm: j.llm_provider ? { provider: j.llm_provider, model: j.llm_model ?? '' } : null,
    summary: s ? { text: s.text, warnings: s.warnings, model: s.model } : null,
    criticalPoints: points.rows.map((p) => ({
      id: p.id,
      rank: p.rank,
      category: p.category,
      severity: p.severity,
      text: p.text,
      relatedMedication: p.related_medication,
      sources: p.sources,
    })),
    medications: meds.map(({ drugNameNormalized: _n, isNewStart: _s, ...m }) => m),
    verifications,
  };
}

/** Primary-document context for a medication: chunks naming it, ranked by similarity to the query. */
export async function searchDocumentChunksByName(
  q: Queryable,
  jobId: string,
  name: string,
  queryEmbedding: number[] | null,
  limit: number,
) {
  const { rows } = await q.query<{ text: string; page_start: number }>(
    `SELECT text, page_start FROM document_chunks
      WHERE job_id = $1 AND kind = 'prose' AND text ILIKE '%' || $2 || '%'
      ORDER BY CASE WHEN $3::vector IS NULL OR embedding IS NULL THEN 0 ELSE embedding <=> $3::vector END, ordinal
      LIMIT $4`,
    [jobId, name, queryEmbedding ? toVectorLiteral(queryEmbedding) : null, limit],
  );
  return rows;
}
