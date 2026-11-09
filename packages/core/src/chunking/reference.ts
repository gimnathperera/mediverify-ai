import type { ParsedDocument } from '../parsing/types.js';
import {
  extractMonographRules,
  type MonographField,
  type MonographRules,
} from '../rules/monograph-rules.js';
import { normalizeDrugName, sha256Hex } from '../text.js';

export type ReferenceChunkKind =
  'monograph' | 'field' | 'section' | 'summary' | 'coverage' | 'front_matter';

export interface ReferenceChunkDraft {
  monographKey: string | null;
  kind: ReferenceChunkKind;
  ordinal: number;
  medicationNameNormalized: string | null;
  sectionTitle: string | null;
  fieldLabel: string | null;
  pageStart: number;
  pageEnd: number;
  /** Verbatim text (what citations quote and validate against). */
  text: string;
  /** Text used for embedding (adds monograph identity context to field chunks). */
  embedText: string;
  contentHash: string;
}

export interface MonographDraft {
  key: string;
  name: string;
  nameNormalized: string;
  aliases: string[];
  sectionTitle: string | null;
  pageStart: number;
  pageEnd: number;
  ordinal: number;
  fields: MonographField[];
  rules: MonographRules;
}

const MONOGRAPH_SIGNATURE = /^drug class$/i;
const COVERAGE_HEADING = /\bnot (?:in|listed in|covered by) this\b|coverage/i;
const SUMMARY_HEADING = /summary|quick[- ]reference/i;

/** Explicit, conservative aliases only (formulation spacing variants). No fuzzy aliasing. */
function aliasesFor(name: string): string[] {
  const n = normalizeDrugName(name);
  const out = new Set<string>();
  if (n.includes('-')) out.add(n.replace(/-/g, ' '));
  if (n.includes('-')) out.add(n.replace(/-/g, ''));
  out.delete(n);
  return [...out];
}

/**
 * Monograph-aware chunking. A monograph = a heading immediately followed by a 'Drug class:' field.
 * Each monograph yields one parent chunk (identity + all fields kept together) and one child chunk
 * per labeled field, all sharing the monograph key. Everything else (preface, section intros,
 * quick-reference summary, coverage notes) becomes non-monograph chunks that can never establish
 * drug identity.
 */
export function chunkReference(doc: ParsedDocument): {
  monographs: MonographDraft[];
  chunks: ReferenceChunkDraft[];
} {
  const blocks = doc.blocks;
  const monographs: MonographDraft[] = [];
  const chunks: ReferenceChunkDraft[] = [];
  let ordinal = 0;
  let topSection: string | null = null;
  let subHeading: string | null = null;

  const push = (c: Omit<ReferenceChunkDraft, 'ordinal' | 'contentHash'>) => {
    chunks.push({ ...c, ordinal: ordinal++, contentHash: sha256Hex(c.text) });
  };

  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]!;
    if (b.kind === 'heading') {
      const next = blocks[i + 1];
      const isMonograph = next?.kind === 'paragraph' && MONOGRAPH_SIGNATURE.test(next.label ?? '');
      if (!isMonograph) {
        if ((b.level ?? 1) <= 1) {
          topSection = b.text;
          subHeading = null;
        } else subHeading = b.text;
        continue;
      }
      // Collect the monograph's labeled fields until the next heading.
      const fields: MonographField[] = [];
      const fieldBlocks = [];
      let j = i + 1;
      for (; j < blocks.length && blocks[j]!.kind !== 'heading'; j++) {
        const fb = blocks[j]!;
        if (fb.kind !== 'paragraph') continue;
        fieldBlocks.push(fb);
        fields.push({ label: fb.label ?? 'Note', text: fb.text });
      }
      const name = b.text.trim();
      const key = `m${monographs.length}`;
      const nameNormalized = normalizeDrugName(name);
      const pageEnd = fieldBlocks.reduce((p, fb) => Math.max(p, fb.pageEnd), b.page);
      monographs.push({
        key,
        name,
        nameNormalized,
        aliases: aliasesFor(name),
        sectionTitle: topSection,
        pageStart: b.page,
        pageEnd,
        ordinal: monographs.length,
        fields,
        rules: extractMonographRules(fields),
      });
      const parentText = [name, ...fields.map((f) => f.text)].join('\n');
      push({
        monographKey: key,
        kind: 'monograph',
        medicationNameNormalized: nameNormalized,
        sectionTitle: topSection,
        fieldLabel: null,
        pageStart: b.page,
        pageEnd,
        text: parentText,
        embedText: parentText,
      });
      for (const fb of fieldBlocks) {
        push({
          monographKey: key,
          kind: 'field',
          medicationNameNormalized: nameNormalized,
          sectionTitle: topSection,
          fieldLabel: fb.label ?? null,
          pageStart: fb.page,
          pageEnd: fb.pageEnd,
          text: fb.text,
          embedText: `${name} — ${fb.text}`,
        });
      }
      i = j - 1;
      continue;
    }
    if (b.kind !== 'paragraph') continue;
    const heading = subHeading ?? topSection ?? '';
    let kind: ReferenceChunkKind = 'section';
    if (COVERAGE_HEADING.test(subHeading ?? '')) kind = 'coverage';
    else if (SUMMARY_HEADING.test(topSection ?? '') || SUMMARY_HEADING.test(subHeading ?? ''))
      kind = 'summary';
    else if (
      !topSection ||
      /preface|document control/i.test(topSection) ||
      /^[A-Z &]+$/.test(topSection) ||
      b.page === 1
    )
      kind = 'front_matter';
    push({
      monographKey: null,
      kind,
      medicationNameNormalized: null,
      sectionTitle: subHeading
        ? `${topSection ?? ''} › ${subHeading}`.replace(/^ › /, '')
        : topSection,
      fieldLabel: b.label ?? null,
      pageStart: b.page,
      pageEnd: b.pageEnd,
      text: b.text,
      embedText: heading ? `${heading} — ${b.text}` : b.text,
    });
  }
  return { monographs, chunks };
}
