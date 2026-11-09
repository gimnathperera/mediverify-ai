import path from 'node:path';

export const ROOT = path.resolve(import.meta.dirname, '../..');
export const ADMIN_DATABASE_URL =
  process.env.TEST_ADMIN_DATABASE_URL ??
  'postgres://mediverify:mediverify@localhost:55432/postgres';
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgres://mediverify:mediverify@localhost:55432/mediverify_test';
export const PRIMARY_PDF = path.join(ROOT, 'resources/primary_document_medical.pdf');
export const REFERENCE_PDF = path.join(ROOT, 'resources/reference_document_medical.pdf');
export const FIXTURE_DIR = path.join(ROOT, 'fixtures/llm');
export const MODEL_CACHE = path.join(ROOT, '.model-cache');
