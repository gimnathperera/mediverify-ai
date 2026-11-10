/**
 * The web viewer renders with react-pdf's bundled pdf.js API but loads the worker script from the
 * web app's own `pdfjs-dist` (see PdfViewer.tsx). pdf.js refuses to run when the two versions differ
 * ("The API version does not match the Worker version"), so a stray bump breaks every PDF view at
 * runtime while typecheck and unit tests stay green. Fail fast here instead.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '../..');
const readJson = (file: string) =>
  JSON.parse(readFileSync(file, 'utf8')) as {
    version?: string;
    dependencies?: Record<string, string>;
  };

describe('dependency pins', () => {
  it('web pdfjs-dist matches the pdf.js version react-pdf is built against', () => {
    const web = readJson(path.join(ROOT, 'apps/web/package.json'));
    const requireFromWeb = createRequire(path.join(ROOT, 'apps/web/package.json'));
    const reactPdf = readJson(requireFromWeb.resolve('react-pdf/package.json'));
    const expected = reactPdf.dependencies?.['pdfjs-dist'];
    expect(expected, 'react-pdf should declare pdfjs-dist').toBeTruthy();
    expect(
      web.dependencies?.['pdfjs-dist'],
      `apps/web must pin pdfjs-dist to react-pdf's ${expected}; upgrade both together`,
    ).toBe(expected);
  });
});
