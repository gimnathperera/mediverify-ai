import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

export function isPdf(bytes: Uint8Array): boolean {
  return Buffer.from(bytes.subarray(0, 5)).toString('latin1') === '%PDF-';
}

/** DOCX = ZIP (PK\x03\x04) containing word/document.xml (checked by scanning central directory names). */
export function isDocx(bytes: Uint8Array): boolean {
  const buf = Buffer.from(bytes);
  if (buf.length < 4 || buf.readUInt32LE(0) !== 0x04034b50) return false;
  return buf.includes('word/document.xml', 0, 'latin1');
}

/**
 * Convert DOCX → PDF with LibreOffice headless (installed in the worker image). Gives real page
 * numbers and lets DOCX and PDF share one parsing path and one viewer.
 */
export async function convertDocxToPdf(
  bytes: Uint8Array,
  opts: {
    binary?: string | undefined;
    timeoutMs?: number | undefined;
    /** Kills LibreOffice when the stage is cancelled. */
    signal?: AbortSignal | undefined;
  } = {},
): Promise<Buffer> {
  const dir = await mkdtemp(path.join(tmpdir(), 'mv-docx-'));
  try {
    const input = path.join(dir, 'input.docx');
    await writeFile(input, bytes);
    await run(
      opts.binary ?? process.env.SOFFICE_BIN ?? 'soffice',
      [
        `-env:UserInstallation=file://${dir}/profile`,
        '--headless',
        '--norestore',
        '--convert-to',
        'pdf',
        '--outdir',
        dir,
        input,
      ],
      { timeout: opts.timeoutMs ?? 90_000, ...(opts.signal ? { signal: opts.signal } : {}) },
    );
    return await readFile(path.join(dir, 'input.pdf'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
