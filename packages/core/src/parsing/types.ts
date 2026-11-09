export interface TextSegment {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  bold: boolean;
}

export interface Line {
  page: number;
  y: number;
  height: number;
  segments: TextSegment[];
  text: string;
}

export interface TableRow {
  page: number;
  cells: Record<string, string>;
  text: string;
}

export interface Block {
  kind: 'heading' | 'paragraph' | 'table';
  page: number;
  pageEnd: number;
  level?: number;
  text: string;
  /** Nearest enclosing heading text. */
  sectionTitle: string | null;
  /** Bold inline label at the start of a paragraph, e.g. 'Standard adult dose'. */
  label?: string;
  table?: { headers: string[]; rows: TableRow[] };
}

export interface ParsedDocument {
  pageCount: number;
  pages: { page: number; text: string }[];
  lines: Line[];
  blocks: Block[];
  bodyFontSize: number;
}
