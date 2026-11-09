export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const ALLOWED_UPLOAD_EXTENSIONS = ['.pdf', '.docx'] as const;
export const PDF_MIME = 'application/pdf';
export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export const ALLOWED_UPLOAD_MIME = [PDF_MIME, DOCX_MIME] as const;
export const SESSION_COOKIE = 'mv_session';
export const DEMO_DISCLAIMER =
  'Demo only — fictional documents for software evaluation. Not medical advice; do not use for clinical decisions.';
