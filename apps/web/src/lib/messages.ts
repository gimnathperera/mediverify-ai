/**
 * User-facing wording keyed by server error code, in one place. Pages render these instead of
 * branching on codes inline, so wording stays consistent and is unit-tested.
 */
export function jobFailureMessage(code: string | null, serverMessage: string | null): string {
  switch (code) {
    case 'MODEL_QUOTA_EXCEEDED':
      return 'The OpenAI account behind this deployment has no remaining API credit. Add credit in the OpenAI billing settings, then retry; parsing results are kept.';
    case 'MODEL_NOT_CONFIGURED':
    case 'MODEL_UNAVAILABLE':
      return `The language model is unavailable${serverMessage ? ` (${serverMessage})` : ''}. Parsing results are kept; retry once the model is configured.`;
    case 'FIXTURE_NOT_FOUND':
      return 'Fixture mode only has model outputs for the bundled sample document. Upload resources/primary_document_medical.pdf, or configure OPENAI_API_KEY for real inference.';
    case 'PARSE_FAILED':
      return 'The document could not be read. Scanned (image-only) PDFs are not supported: there is no OCR.';
    default:
      return serverMessage ?? 'Processing failed for an unknown reason.';
  }
}

/** Label for the model that produced the results; fixture mode is never presented as a live model. */
export function modelLabel(llm: { provider: string; model: string } | null | undefined): string {
  if (!llm) return 'Unknown model';
  if (llm.provider === 'fixture') return 'Fixture outputs (not a live model)';
  return `${llm.provider} · ${llm.model}`;
}
