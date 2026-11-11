import { renderForPrompt } from '../chunking/primary.js';
import { ENTITIES_SYSTEM, entitiesUser } from '../llm/prompts.js';
import { entitiesOutput, type ExtractedMedication } from '../llm/schemas.js';
import type { LlmProvider } from '../llm/types.js';
import type { ParsedDocument, TableRow } from '../parsing/types.js';
import {
  isAmbiguousDose,
  parseDose,
  parseDuration,
  parseFrequency,
  parseRoute,
  parseTiming,
  FREQUENCY_LABEL,
  TIMING_LABEL,
} from '../rules/normalize.js';
import { drugIdentityKey, quoteAppearsIn } from '../text.js';

import { locateQuote } from './critical-points.js';

export interface MedicationRecord {
  ordinal: number;
  drugName: string;
  drugNameNormalized: string;
  doseValue: number | null;
  doseUnit: string | null;
  doseRaw: string | null;
  route: string | null;
  routeRaw: string | null;
  frequency: string | null;
  frequencyRaw: string | null;
  timing: string | null;
  durationValue: number | null;
  durationUnit: string | null;
  durationRaw: string | null;
  indication: string | null;
  isNewStart: boolean | null;
  sourcePage: number | null;
  sourceQuote: string | null;
  sourceQuoteValid: boolean;
  ambiguities: string[];
}

interface MedTable {
  rows: TableRow[];
  col: Partial<
    Record<'name' | 'dose' | 'route' | 'frequency' | 'duration' | 'indication', string | undefined>
  >;
}

/** Find a medication table and map its columns by header semantics (not position). */
export function findMedicationTable(doc: ParsedDocument): MedTable | null {
  for (const b of doc.blocks) {
    if (b.kind !== 'table' || !b.table) continue;
    const h = b.table.headers;
    const find = (re: RegExp) => h.find((x) => re.test(x));
    const name = find(/medication|drug|medicine/i);
    if (!name) continue;
    return {
      rows: b.table.rows,
      col: {
        name,
        dose: find(/dose|strength/i),
        route: find(/route/i),
        frequency: find(/freq|sig|schedule/i),
        duration: find(/duration|length/i),
        indication: find(/indication|reason|purpose/i),
      },
    };
  }
  return null;
}

const cell = (row: TableRow, header: string | undefined) =>
  header ? (row.cells[header] ?? '').trim() || null : null;

/**
 * LLM extraction (primary), reconciled against the deterministically parsed medication table:
 * table cells are the literal source, so they win on disagreement (recorded as an ambiguity);
 * rows the model missed are added from the table; non-table items need a validated quote.
 */
export async function extractMedications(
  llm: LlmProvider,
  doc: ParsedDocument,
  fixturePrefix: string,
): Promise<{ medications: MedicationRecord[]; notes: string[] }> {
  const out = await llm.generate({
    task: 'entities',
    schemaName: 'medications',
    schema: entitiesOutput,
    system: ENTITIES_SYSTEM,
    user: entitiesUser(renderForPrompt(doc)),
    fixtureKey: `${fixturePrefix}/entities`,
    maxOutputTokens: 4000,
  });
  return reconcileMedications(doc, out.medications);
}

export function reconcileMedications(doc: ParsedDocument, extracted: ExtractedMedication[]) {
  const notes: string[] = [];
  const table = findMedicationTable(doc);
  const rowByName = new Map<string, TableRow>();
  if (table)
    for (const r of table.rows) rowByName.set(drugIdentityKey(cell(r, table.col.name) ?? ''), r);
  const used = new Set<string>();
  const records: MedicationRecord[] = [];

  for (const m of extracted) {
    const key = drugIdentityKey(m.drug_name);
    if (!key) continue;
    if (used.has(key)) {
      // A second entry for the same drug (split dose, taper): keep it visible, never drop silently.
      records
        .find((r) => r.drugNameNormalized === key)
        ?.ambiguities.push(
          `Listed more than once (${m.dose_raw ?? 'dose not stated'}${m.frequency_raw ? `, ${m.frequency_raw}` : ''}); only the first entry is verified.`,
        );
      continue;
    }
    const row = rowByName.get(key);
    const rec = buildRecord(m, key);
    // "New start" decides titration checks, so it needs a quote that validates in the document.
    if (rec.isNewStart !== null && !locateQuote(doc, m.new_start_evidence ?? '', null).valid) {
      rec.isNewStart = null;
      rec.ambiguities.push('Whether this is a new start is not supported by a document quote.');
    }
    if (row && table) {
      applyTableRow(rec, row, table);
    } else {
      const loc = locateQuote(doc, m.source_quote, m.source_page);
      rec.sourceQuoteValid = loc.valid;
      rec.sourcePage = loc.page;
      // Hallucination control: a medication must be traceable to the document text.
      if (!loc.valid) {
        notes.push(
          `Dropped "${m.drug_name}": ${table ? 'not in the medication table and ' : ''}quote not found in document`,
        );
        continue;
      }
    }
    used.add(key);
    records.push(rec);
  }
  if (table) {
    for (const [key, row] of rowByName) {
      if (used.has(key) || !key) continue;
      const rec = buildRecord(
        {
          drug_name: cell(row, table.col.name) ?? key,
          dose_raw: null,
          dose_value: null,
          dose_unit: null,
          route_raw: null,
          frequency_raw: null,
          timing_raw: null,
          duration_raw: null,
          indication: null,
          is_new_start: null,
          new_start_evidence: null,
          source_page: row.page,
          source_quote: '',
          ambiguities: [],
        },
        key,
      );
      applyTableRow(rec, row, table);
      rec.ambiguities.push('Not returned by the model; added from the medication table');
      notes.push(`Added "${rec.drugName}" from table (model omitted it)`);
      used.add(key);
      records.push(rec);
    }
  }
  records.forEach((r, i) => (r.ordinal = i + 1));
  return { medications: records, notes };
}

/** A medication record from one extracted entry, with the pipeline's normalisation (no document checks). */
export function medicationFromExtraction(m: ExtractedMedication): MedicationRecord {
  return buildRecord(m, drugIdentityKey(m.drug_name));
}

function buildRecord(m: ExtractedMedication, key: string): MedicationRecord {
  const ambiguities = [...m.ambiguities];
  // The model's numeric dose must agree with the dose text it was read from; ranges and combination
  // strengths are never collapsed to one value.
  const parsed = parseDose(m.dose_raw);
  let dose: { value: number; unit: string } | null =
    m.dose_value !== null && m.dose_unit
      ? { value: m.dose_value, unit: m.dose_unit.toLowerCase() }
      : parsed;
  if (isAmbiguousDose(m.dose_raw)) {
    dose = null;
    ambiguities.push(`Dose "${m.dose_raw}" is a range or combination; not reduced to one value.`);
  } else if (dose && parsed && (parsed.value !== dose.value || parsed.unit !== dose.unit)) {
    dose = parsed;
    ambiguities.push(
      `Extracted dose disagreed with the dose text "${m.dose_raw}"; the text was used.`,
    );
  }
  const freq = parseFrequency(m.frequency_raw);
  const timing = parseTiming(m.timing_raw) ?? parseTiming(m.frequency_raw);
  const duration = parseDuration(m.duration_raw);
  return {
    ordinal: 0,
    drugName: m.drug_name.trim(),
    drugNameNormalized: key,
    doseValue: dose?.value ?? null,
    doseUnit: dose?.unit ?? null,
    doseRaw: m.dose_raw,
    route: parseRoute(m.route_raw ?? m.frequency_raw),
    routeRaw: m.route_raw,
    frequency: freq,
    frequencyRaw: m.frequency_raw,
    timing,
    durationValue: duration?.value ?? null,
    durationUnit: duration?.indefinite ? 'indefinite' : (duration?.unit ?? null),
    durationRaw: m.duration_raw,
    indication: m.indication,
    isNewStart: m.is_new_start,
    sourcePage: m.source_page,
    sourceQuote: m.source_quote || null,
    sourceQuoteValid: false,
    ambiguities,
  };
}

function applyTableRow(rec: MedicationRecord, row: TableRow, table: MedTable) {
  const c = table.col;
  const doseCell = cell(row, c.dose);
  const routeCell = cell(row, c.route);
  const freqCell = c.frequency === c.route ? routeCell : cell(row, c.frequency);
  const durCell = cell(row, c.duration);
  const indCell = cell(row, c.indication);

  const tableDose = parseDose(doseCell);
  if (tableDose) {
    if (
      rec.doseValue !== null &&
      (rec.doseValue !== tableDose.value || rec.doseUnit !== tableDose.unit)
    )
      rec.ambiguities.push(
        `Model dose "${rec.doseValue} ${rec.doseUnit}" differs from table "${doseCell}"; table value used`,
      );
    rec.doseValue = tableDose.value;
    rec.doseUnit = tableDose.unit;
    rec.doseRaw = doseCell;
  }
  if (routeCell) {
    rec.routeRaw = routeCell;
    rec.route = parseRoute(routeCell) ?? rec.route;
  }
  if (freqCell) {
    const f = parseFrequency(freqCell);
    if (f && rec.frequency && f !== rec.frequency)
      rec.ambiguities.push(
        `Model frequency "${FREQUENCY_LABEL[rec.frequency as keyof typeof FREQUENCY_LABEL] ?? rec.frequency}" differs from table "${freqCell}"; table value used`,
      );
    rec.frequencyRaw = freqCell;
    rec.frequency = f ?? rec.frequency;
    const t = parseTiming(freqCell);
    if (t) {
      if (rec.timing && rec.timing !== t)
        rec.ambiguities.push(
          `Timing differs between table ("${TIMING_LABEL[t]}") and other text; table value used`,
        );
      rec.timing = t;
    }
  }
  if (durCell) {
    const d = parseDuration(durCell);
    rec.durationRaw = durCell;
    rec.durationValue = d?.value ?? null;
    rec.durationUnit = d?.indefinite ? 'indefinite' : (d?.unit ?? null);
  }
  if (indCell) rec.indication = indCell;
  rec.sourcePage = row.page;
  const rowQuote = Object.values(row.cells).join(' ');
  rec.sourceQuoteValid = rec.sourceQuote ? quoteAppearsIn(rec.sourceQuote, rowQuote) : false;
  if (!rec.sourceQuoteValid) {
    rec.sourceQuote = rowQuote; // literal row text from the parsed table
    rec.sourceQuoteValid = true;
  }
}
