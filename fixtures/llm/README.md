# Fixture LLM outputs (test / offline demo only)

Used only when `LLM_PROVIDER=fixture`. Files are keyed by `<first 16 hex of document sha256>/<task>[--<drug>].json`
and validated against the **same zod schemas** as live model output. Every quote inside them goes through the same
quote validation as live output, so a wrong quote fails the pipeline's checks the same way.

- `0be5694faf45dc2f/` = `resources/primary_document_medical.pdf`.
- **Provenance:** these were **hand-authored** from the provided documents to make tests deterministic and to let the
  stack run without an API key. They are **not** recorded model responses, and they do **not** show how the live model
  performs. Live behaviour is measured separately (`pnpm eval:live`, see `docs/evaluation.md`).
- To replace them with real recordings, run the worker or `pnpm eval:live` with `LLM_RECORD_DIR=fixtures/llm`.
- The fixture provider **fails** (`FIXTURE_NOT_FOUND`) for any other document. It never fabricates output.
- Verification, quote validation, identity gating and deterministic checks all run for real in fixture mode. Only
  the LLM text generation is replaced.
