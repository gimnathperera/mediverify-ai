import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { MAX_DOCX_EXPANDED_BYTES, zipUncompressedSize } from '@mediverify/shared';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '../../..');

/** A minimal ZIP: one central-directory entry declaring `size` uncompressed bytes. */
function zipDeclaring(size: number): Uint8Array {
  const name = 'word/document.xml';
  const cd = new DataView(new ArrayBuffer(46 + name.length));
  cd.setUint32(0, 0x02014b50, true);
  cd.setUint32(24, size, true);
  cd.setUint16(28, name.length, true);
  new Uint8Array(cd.buffer).set(new TextEncoder().encode(name), 46);
  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true);
  eocd.setUint16(8, 1, true);
  eocd.setUint16(10, 1, true);
  eocd.setUint32(12, cd.byteLength, true);
  eocd.setUint32(16, 4, true); // central directory starts after a 4-byte stand-in header
  const out = new Uint8Array(4 + cd.byteLength + 22);
  out.set([0x50, 0x4b, 0x03, 0x04]);
  out.set(new Uint8Array(cd.buffer), 4);
  out.set(new Uint8Array(eocd.buffer), 4 + cd.byteLength);
  return out;
}

describe('zip-bomb guard', () => {
  it('reads the declared expanded size of a real DOCX without unpacking it', async () => {
    const docx = await readFile(path.join(ROOT, 'fixtures/sample_discharge.docx'));
    const size = zipUncompressedSize(docx);
    expect(size).toBeGreaterThan(docx.length); // compressed on disk
    expect(size).toBeLessThan(MAX_DOCX_EXPANDED_BYTES);
  });

  it('flags archives that declare a huge expansion, and unreadable ones', () => {
    expect(zipUncompressedSize(zipDeclaring(1000))).toBe(1000);
    expect(zipUncompressedSize(zipDeclaring(4_000_000_000))).toBeGreaterThan(
      MAX_DOCX_EXPANDED_BYTES,
    );
    expect(zipUncompressedSize(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0]))).toBe(Infinity);
  });
});
