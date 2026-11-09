import type { ParsedDocument } from '../parsing/types.js';

export interface PrimaryChunkDraft {
  ordinal: number;
  kind: 'prose' | 'table' | 'table_row' | 'heading';
  pageStart: number;
  pageEnd: number;
  sectionTitle: string | null;
  text: string;
  data?: Record<string, string>;
}

/**
 * Primary-document chunking: one chunk per paragraph (sections are short in discharge summaries),
 * one chunk per table row (row meaning preserved as header→cell pairs), headings kept for context.
 */
export function chunkPrimary(doc: ParsedDocument): PrimaryChunkDraft[] {
  const out: PrimaryChunkDraft[] = [];
  let ordinal = 0;
  for (const b of doc.blocks) {
    if (b.kind === 'table') {
      for (const row of b.table!.rows) {
        out.push({
          ordinal: ordinal++,
          kind: 'table_row',
          pageStart: row.page,
          pageEnd: row.page,
          sectionTitle: b.sectionTitle,
          text: row.text,
          data: row.cells,
        });
      }
      continue;
    }
    out.push({
      ordinal: ordinal++,
      kind: b.kind === 'heading' ? 'heading' : 'prose',
      pageStart: b.page,
      pageEnd: b.pageEnd,
      sectionTitle: b.sectionTitle,
      text: b.text,
    });
  }
  return out;
}

/** Render the parsed document for an LLM prompt with page markers and tables as pipe rows. */
export function renderForPrompt(doc: ParsedDocument): string {
  const parts: string[] = [];
  let page = 0;
  for (const b of doc.blocks) {
    if (b.page !== page) {
      page = b.page;
      parts.push(`\n[[PAGE ${page}]]`);
    }
    if (b.kind === 'heading') parts.push(`\n## ${b.text}`);
    else if (b.kind === 'table') {
      const t = b.table!;
      parts.push(`| ${t.headers.join(' | ')} |`);
      for (const r of t.rows)
        parts.push(`| ${t.headers.map((h) => r.cells[h] ?? '').join(' | ')} |`);
    } else parts.push(b.text);
  }
  return parts.join('\n').trim();
}
