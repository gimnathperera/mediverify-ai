/** Magic-byte file sniffing shared by browser (client-side validation) and server (authoritative). */
const ascii = (bytes: Uint8Array, start: number, len: number) =>
  String.fromCharCode(...bytes.subarray(start, start + len));

export function looksLikePdf(bytes: Uint8Array): boolean {
  return bytes.length >= 5 && ascii(bytes, 0, 5) === '%PDF-';
}

/** DOCX = ZIP local-file header + a `word/document.xml` entry name somewhere in the archive. */
export function looksLikeDocx(bytes: Uint8Array): boolean {
  if (
    bytes.length < 4 ||
    !(bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04)
  )
    return false;
  const needle = 'word/document.xml';
  outer: for (let i = 0; i <= bytes.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++)
      if (bytes[i + j] !== needle.charCodeAt(j)) continue outer;
    return true;
  }
  return false;
}

/**
 * Total uncompressed size declared by a ZIP's central directory, without decompressing anything
 * (zip-bomb guard: a 10 MB DOCX can declare gigabytes). Returns Infinity when the archive can't be
 * read safely (no end-of-central-directory record, out-of-range offsets, ZIP64 sizes).
 */
export function zipUncompressedSize(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const len = bytes.length;
  // End-of-central-directory record: signature 0x06054b50, within the last 64 KiB + 22 bytes.
  let eocd = -1;
  for (let i = len - 22; i >= Math.max(0, len - 65_557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return Infinity;
  const entries = view.getUint16(eocd + 10, true);
  let at = view.getUint32(eocd + 16, true);
  if (entries === 0xffff || at === 0xffffffff) return Infinity; // ZIP64
  let total = 0;
  for (let n = 0; n < entries; n++) {
    if (at + 46 > len || view.getUint32(at, true) !== 0x02014b50) return Infinity;
    const size = view.getUint32(at + 24, true);
    if (size === 0xffffffff) return Infinity;
    total += size;
    at +=
      46 +
      view.getUint16(at + 28, true) +
      view.getUint16(at + 30, true) +
      view.getUint16(at + 32, true);
  }
  return total;
}

export type SniffedType = 'pdf' | 'docx' | null;

export function sniffDocumentType(bytes: Uint8Array): SniffedType {
  if (looksLikePdf(bytes)) return 'pdf';
  if (looksLikeDocx(bytes)) return 'docx';
  return null;
}

export function extensionOf(filename: string): string {
  const m = /\.[^.]+$/.exec(filename.toLowerCase());
  return m ? m[0] : '';
}
