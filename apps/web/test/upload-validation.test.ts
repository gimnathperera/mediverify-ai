import { MAX_UPLOAD_BYTES } from '@mediverify/shared';
import { describe, expect, it } from 'vitest';

import { validateFile } from '../src/components/UploadPanel';

const file = (name: string, bytes: Uint8Array<ArrayBuffer> | string) => new File([bytes], name);
const pdfHead = '%PDF-1.7\n%âãÏÓ\n1 0 obj\n';

describe('validateFile (client-side upload checks, mirrored by the server)', () => {
  it('accepts a real PDF and a zip-based DOCX', async () => {
    expect(await validateFile(file('discharge.pdf', pdfHead))).toBeNull();
    expect(
      await validateFile(file('discharge.docx', new Uint8Array([0x50, 0x4b, 3, 4, 0]))),
    ).toBeNull();
  });

  it('rejects other extensions, empty files and oversized files', async () => {
    expect(await validateFile(file('notes.txt', 'hello'))).toMatch(/Only PDF/);
    expect(await validateFile(file('empty.pdf', ''))).toMatch(/empty/);
    const big = { name: 'big.pdf', size: MAX_UPLOAD_BYTES + 1 } as File;
    expect(await validateFile(big)).toMatch(/limit is 10\.0 MB/);
  });

  it('rejects files whose content does not match the extension', async () => {
    expect(await validateFile(file('fake.pdf', 'PK\u0003\u0004 not a pdf'))).toMatch(/valid PDF/);
    expect(await validateFile(file('fake.docx', pdfHead))).toMatch(/valid DOCX/);
  });
});
