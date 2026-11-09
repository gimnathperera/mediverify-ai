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
