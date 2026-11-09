import type { Block, Line, ParsedDocument, TableRow } from './types.js';

// Minimum gap between segments that suggests separate table cells: relative to font size, so it works
// for both Word-exported PDFs (wide gutters) and LibreOffice conversions (tight gutters).
const columnGap = (line: Line) => Math.max(6, line.height * 0.7);

function gaps(line: Line): number[] {
  const out: number[] = [];
  for (let i = 1; i < line.segments.length; i++) {
    const prev = line.segments[i - 1]!;
    out.push(line.segments[i]!.x - (prev.x + prev.width));
  }
  return out;
}

/**
 * A table header is a line of ≥3 widely spaced segments AND the next line (same page) must have
 * ≥2 segments starting at the header's column x-positions (±4pt). The alignment check (next ≤3 lines) stops
 * ordinary lines with unusual spacing from being mistaken for tables.
 */
function isTableHeaderCandidate(line: Line, following: Line[]): boolean {
  if (line.segments.length < 3 || !gaps(line).every((g) => g > columnGap(line))) return false;
  const cols = line.segments.map((s) => s.x);
  // Look a few lines ahead: headers may wrap ("Route /" + "Frequency") before the first data row.
  return following
    .slice(0, 3)
    .some(
      (next) =>
        next.page === line.page &&
        next.segments.filter((s) => cols.some((x) => Math.abs(x - s.x) <= 4)).length >= 2,
    );
}

function bodyFontSize(lines: Line[]): number {
  const weight = new Map<number, number>();
  for (const l of lines)
    for (const s of l.segments) {
      const h = Math.round(s.height);
      weight.set(h, (weight.get(h) ?? 0) + s.text.length);
    }
  let best = 11;
  let bestW = -1;
  for (const [h, w] of weight)
    if (w > bestW) {
      best = h;
      bestW = w;
    }
  return best;
}

function isHeading(line: Line, body: number): boolean {
  const text = line.text.trim();
  if (!line.segments.every((s) => s.bold)) return false;
  if (text.length > 90 || /[:.,;]$/.test(text)) return false;
  if (line.height < body - 0.5) return false;
  return true;
}

function headingLevel(line: Line, body: number): number {
  if (line.height >= body + 2.5) return 1;
  if (line.height >= body + 0.5) return 2;
  return 3;
}

function leadingLabel(line: Line): string | undefined {
  const first = line.segments[0];
  if (!first?.bold || line.segments.length < 2) return undefined;
  const m = /^(.{2,60}?):$/.exec(first.text.trim());
  return m?.[1];
}

function startsNewParagraph(line: Line): boolean {
  return Boolean(leadingLabel(line)) || /^(•|-|\d+\.\s)/.test(line.text.trim());
}

/**
 * Turn positioned lines into headings, paragraphs and tables, preserving page provenance.
 * Tables: a header line with ≥3 widely spaced segments defines column x-positions; following
 * lines are binned into columns and grouped into rows by vertical gap (multi-line cells merge).
 */
export function buildStructure(pageCount: number, lines: Line[]): ParsedDocument {
  const body = bodyFontSize(lines);
  const blocks: Block[] = [];
  let section: string | null = null;
  let para: { lines: Line[] } | null = null;

  const flush = () => {
    if (!para) return;
    const first = para.lines[0]!;
    const label = leadingLabel(first);
    const text = para.lines.map((l) => l.text).join(' ');
    blocks.push({
      kind: 'paragraph',
      page: first.page,
      pageEnd: para.lines[para.lines.length - 1]!.page,
      text,
      sectionTitle: section,
      ...(label ? { label } : {}),
    });
    para = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    if (isTableHeaderCandidate(line, lines.slice(i + 1, i + 4))) {
      flush();
      const consumed = parseTable(lines, i, section, blocks);
      if (consumed > 0) {
        i += consumed - 1;
        continue;
      }
    }

    if (isHeading(line, body)) {
      flush();
      const level = headingLevel(line, body);
      blocks.push({
        kind: 'heading',
        page: line.page,
        pageEnd: line.page,
        level,
        text: line.text,
        sectionTitle: section,
      });
      section = line.text;
      continue;
    }

    if (para) {
      const prev = para.lines[para.lines.length - 1]!;
      const gap = prev.y - line.y;
      const samePage = prev.page === line.page;
      // A paragraph continues across a page break when the sentence is unfinished and the next
      // page resumes in lower case (e.g. "…adjunctive cardiovascular | protection. …").
      const continuesAcrossPage =
        !samePage && !/[.:!?]$/.test(prev.text.trim()) && /^[a-z]/.test(line.text.trim());
      if (continuesAcrossPage) {
        para.lines.push(line);
        continue;
      }
      if (!samePage || gap > prev.height * 1.85 || startsNewParagraph(line)) flush();
    }
    para ??= { lines: [] };
    para.lines.push(line);
  }
  flush();

  const pages = Array.from({ length: pageCount }, (_, idx) => ({
    page: idx + 1,
    text: blocks
      .filter((b) => b.page === idx + 1)
      .map((b) =>
        b.kind === 'table'
          ? b.table!.rows.map((r) => Object.values(r.cells).join(' ')).join('\n')
          : b.text,
      )
      .join('\n'),
  }));
  return { pageCount, pages, lines, blocks, bodyFontSize: body };
}

/** Returns number of lines consumed (0 if this is not actually a table). */
function parseTable(lines: Line[], start: number, section: string | null, blocks: Block[]): number {
  const header = lines[start]!;
  const cols = header.segments.map((s) => ({ x: s.x, title: s.text }));
  const colIndex = (x: number) => {
    for (let c = cols.length - 1; c >= 0; c--) if (x >= cols[c]!.x - 4) return c;
    return -1;
  };
  let i = start + 1;
  // Multi-line headers: following all-bold lines close below the header.
  while (i < lines.length) {
    const l = lines[i]!;
    if (l.page !== header.page || !l.segments.every((s) => s.bold)) break;
    if (header.y - l.y > header.height * 2.2) break;
    for (const s of l.segments) {
      const c = colIndex(s.x);
      if (c >= 0) cols[c]!.title = `${cols[c]!.title} ${s.text}`;
    }
    i++;
  }
  const headers = cols.map((c) => c.title.replace(/\s+/g, ' ').trim());
  const rows: TableRow[] = [];
  let current: {
    cells: string[][];
    page: number;
    lastY: number;
    height: number;
    firstColY: number;
  } | null = null;
  const pushRow = () => {
    if (!current) return;
    const cells: Record<string, string> = {};
    headers.forEach((h, idx) => {
      cells[h] = (current!.cells[idx] ?? []).join(' ').trim();
    });
    rows.push({
      page: current.page,
      cells,
      text: headers.map((h) => `${h}: ${cells[h]}`).join(' | '),
    });
    current = null;
  };
  const firstColX = cols[0]!.x;
  while (i < lines.length) {
    const l = lines[i]!;
    if (l.page !== header.page) break;
    if (l.segments.some((s) => s.x < firstColX - 3)) break; // back to body margin
    const prevY: number = current ? current.lastY : header.y;
    if (prevY - l.y > l.height * 4) break; // large vertical gap ends table
    // New row = text in the first column that starts > 1.5 line-heights below the previous
    // first-column text. Wrapped first-column text (≈1.2 line-heights) stays in the same row, and
    // continuation lines in other columns never start a row (robust to tight cell padding).
    const hasFirstCol = l.segments.some((s) => colIndex(s.x) === 0);
    if (!current || (hasFirstCol && current.firstColY - l.y > l.height * 1.5)) {
      pushRow();
      current = {
        cells: cols.map(() => []),
        page: l.page,
        lastY: l.y,
        height: l.height,
        firstColY: l.y,
      };
    } else if (hasFirstCol) {
      current.firstColY = l.y;
    }
    for (const s of l.segments) {
      const c = colIndex(s.x);
      if (c >= 0) current.cells[c]!.push(s.text);
    }
    current.lastY = l.y;
    i++;
  }
  pushRow();
  if (rows.length === 0) return 0;
  blocks.push({
    kind: 'table',
    page: header.page,
    pageEnd: rows[rows.length - 1]!.page,
    text: rows.map((r) => r.text).join('\n'),
    sectionTitle: section,
    table: { headers, rows },
  });
  return i - start;
}
