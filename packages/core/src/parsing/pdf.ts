import type * as pdfjsTypes from 'pdfjs-dist/legacy/build/pdf.mjs';

import type { Line, TextSegment } from './types.js';

interface PdfTextItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
  fontName: string;
}

type PdfJs = typeof pdfjsTypes;
let pdfjsPromise: Promise<PdfJs> | null = null;
function loadPdfJs(): Promise<PdfJs> {
  pdfjsPromise ??= import('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfjsPromise;
}

const BOLD_RE = /bold|black|heavy|semibold|demi/i;

/**
 * Extract positioned text lines from a PDF using pdf.js. Coordinates are PDF points with origin
 * bottom-left (larger y = higher on the page). Bold is inferred from the embedded font name.
 */
export async function extractPdfLines(
  bytes: Uint8Array,
): Promise<{ pageCount: number; lines: Line[] }> {
  const pdfjs = await loadPdfJs();
  // Copy: pdf.js transfers/detaches the buffer it is given.
  const params: Parameters<typeof pdfjs.getDocument>[0] = {
    data: new Uint8Array(bytes),
    disableFontFace: true,
    useSystemFonts: false,
    verbosity: 0,
  };
  // Uploaded PDFs are untrusted. pdf.js 5.4 (pinned to match react-pdf; 5.6.83–6.2.107 carry
  // CVE-2026-16633) compiles PDF functions with `new Function` unless `isEvalSupported: false`.
  // Later versions drop the option, so it is passed untyped: applied where supported, ignored
  // otherwise. Text extraction never enables pdf.js scripting.
  Object.assign(params, { isEvalSupported: false });
  const doc = await pdfjs.getDocument(params).promise;
  const lines: Line[] = [];
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      await page.getOperatorList(); // populates commonObjs with font objects (for bold detection)
      const content = await page.getTextContent();
      const boldByFont = new Map<string, boolean>();
      const isBold = (fontName: string) => {
        let b = boldByFont.get(fontName);
        if (b === undefined) {
          try {
            const font = page.commonObjs.get(fontName) as { name?: string } | undefined;
            b = BOLD_RE.test(font?.name ?? '');
          } catch {
            b = false;
          }
          boldByFont.set(fontName, b);
        }
        return b;
      };
      const segments: TextSegment[] = [];
      for (const raw of content.items) {
        if (!('str' in raw)) continue;
        const it = raw as unknown as PdfTextItem;
        if (!it.str.trim()) continue;
        segments.push({
          text: it.str.replace(/\s+/g, ' ').trim(),
          x: it.transform[4] ?? 0,
          y: it.transform[5] ?? 0,
          width: it.width,
          height: it.height || Math.abs(it.transform[3] ?? 0),
          bold: isBold(it.fontName),
        });
      }
      lines.push(...groupIntoLines(p, segments));
      page.cleanup();
    }
    return { pageCount: doc.numPages, lines };
  } finally {
    await doc.destroy();
  }
}

export function groupIntoLines(page: number, segments: TextSegment[]): Line[] {
  const sorted = [...segments].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: Line[] = [];
  for (const seg of sorted) {
    const line = lines.find((l) => Math.abs(l.y - seg.y) <= Math.max(2, seg.height * 0.3));
    if (line) {
      line.segments.push(seg);
      line.height = Math.max(line.height, seg.height);
    } else {
      lines.push({ page, y: seg.y, height: seg.height, segments: [seg], text: '' });
    }
  }
  for (const l of lines) {
    l.segments.sort((a, b) => a.x - b.x);
    l.text = l.segments.map((s) => s.text).join(' ');
  }
  return lines.sort((a, b) => b.y - a.y);
}
