import { extractPdfLines } from './pdf.js';
import { buildStructure } from './structure.js';
import type { ParsedDocument } from './types.js';

export * from './types.js';
export { extractPdfLines } from './pdf.js';
export { buildStructure } from './structure.js';
export * from './docx.js';

export async function parsePdf(bytes: Uint8Array): Promise<ParsedDocument> {
  const { pageCount, lines } = await extractPdfLines(bytes);
  if (lines.length === 0) {
    throw new Error('No extractable text found (scanned/image-only PDFs are not supported).');
  }
  return buildStructure(pageCount, lines);
}
