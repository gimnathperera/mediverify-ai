# Implementation plan & progress

Living checklist. Status: ☐ todo · ◐ in progress · ☑ done (verified by a command/test) · ✂ deferred (explicit).

## Requirement checklist

| Pri    | Requirement                                                                             | Status | Evidence                                                                                                                                          |
| ------ | --------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| MUST   | Email/password signup/login/logout, hashed passwords, seed creds                        | ☑      | `api.test.ts` (argon2id hash, cookie flags, 401s); seed in `scripts/seed.ts`; browser login checked                                               |
| MUST   | Upload PDF/DOCX (drag-drop, type/size validation) + select reference                    | ☑      | `api.test.ts` validation cases; `UploadPanel.tsx`; DOCX→PDF verified in the worker container                                                      |
| MUST   | `POST /documents` → 202 + job id; atomic document/job/stages/event tx                   | ☑      | `api.test.ts` 202 + injected-fault rollback test                                                                                                  |
| MUST   | Worker stages parsed→…→done with status/timing/errors; no hung jobs                     | ☑      | `worker-reliability.test.ts` (fail, retry, resume, SKIP LOCKED, reaper, zombie lease)                                                             |
| MUST   | Real-time progress (SSE), survives refresh/reconnect                                    | ☑      | `api.test.ts` SSE replay/resume/live; checked in the browser                                                                                      |
| MUST   | Summary (primary only)                                                                  | ☑      | Golden test + faithfulness guard unit test (fixture LLM)                                                                                          |
| MUST   | Critical points with page + validated quote; discrepancies preserved                    | ☑      | Golden tests (14 points, 100% quotes valid, psychiatry discrepancy kept)                                                                          |
| MUST   | Structured medication extraction (all fields, raw+normalized, provenance)               | ☑      | Golden test; `pnpm eval` extraction 100% per field (fixture LLM)                                                                                  |
| MUST   | Monograph-aware chunking + embeddings in pgvector; reuse across jobs                    | ☑      | `parsing.test.ts` (8 monographs, chunk kinds); index reuse reported in stage events                                                               |
| MUST   | Identity-gated hybrid retrieval; verification S/C/U(+incomplete) w/ validated citations | ☑      | Golden 6/6; `verification.test.ts`; `docs/evaluation.md`                                                                                          |
| MUST   | Two-column view (PDF + results), clickable citation preview                             | ☑      | Browser check on Vite dev; Playwright reviewer flow vs Compose passes (desktop + Pixel 7)                                                         |
| MUST   | Loading / empty / error / failed-job / model-unavailable states                         | ☑      | `DocumentsPage`, `DocumentPage`, `AppShell` banners; checked in the browser                                                                       |
| MUST   | Ownership enforcement on every endpoint incl. SSE + file                                | ☑      | `api.test.ts` IDOR test across every route incl. SSE and file                                                                                     |
| MUST   | Structured JSON logs traceable per job                                                  | ☑      | pino with job_id/document_id/stage/event/duration_ms in worker + API                                                                              |
| MUST   | Tests: golden verification, authz, rollback, failure, reconnect                         | ☑      | 30 unit + 40 integration passing locally                                                                                                          |
| MUST   | Single docker-compose, versioned migrations, seed, README < 10 min                      | ☑      | Stack came up healthy from `docker compose up --build`; README written                                                                            |
| SHOULD | Lint/format/strict TS, Husky hooks, GitHub Actions CI                                   | ◐      | Lint/format/typecheck clean locally; first GitHub run failed (root type errors, HF model download reset); both fixed, green re-run pending a push |
| SHOULD | Retrieval/classification evaluation with measured numbers                               | ◐      | Fixture run in `docs/evaluation.md`; live run pending `OPENAI_API_KEY`                                                                            |
| EXTRA  | Duplicate upload detection (sha256, 5-min window)                                       | ☑      | `api.test.ts` duplicate test                                                                                                                      |
| EXTRA  | Deep-link citation into reference PDF                                                   | ☑      | Browser check: opens p.5 with the exact quote highlighted                                                                                         |

## Architecture (summary — see CLAUDE.md / README for detail)

pnpm monorepo: `apps/{web,api,worker}`, `packages/{shared,db,core}`, `db/migrations`. Postgres is queue + store + vector
index. SSE backed by persisted `job_events` + LISTEN/NOTIFY. OpenAI for generation (strict JSON schema); local bge-small
embeddings. Deterministic verification checks + LLM interpretation, merged under quote validation.

## Decisions / tradeoffs

- Postgres queue instead of Redis/BullMQ — one fewer service, transactional enqueue with the upload.
- File bytes in `bytea` — makes the upload atomic without file/DB reconciliation; fine for ≤10 MB fixtures. Would move to
  object storage + outbox at scale.
- Raw SQL over an ORM — transparent transactions and `SKIP LOCKED`; small schema.
- Local embeddings — no key for indexing, deterministic, offline; identity is gated lexically anyway, embeddings rank
  field passages within a monograph.
- DOCX → PDF via LibreOffice in the worker image — single parse path with real page numbers and one viewer.
- Opaque session cookies over JWT — revocable logout, SSE works with cookies, same-origin.

## Ambiguities & assumptions

- Brief names `.docx` assets but only PDFs were provided; DOCX support is tested with a generated DOCX fixture.
- Cordizem-XR 100 mg: interpreted as a dose conflict with the 50 mg start + 25 mg/≥2-week titration schedule because the
  primary document describes a new diagnosis/new start; reported with medium confidence and rationale.
- Etrazolam psychiatry follow-up timing is internally inconsistent in the primary (2 weeks vs 8-week mark); surfaced as a
  document discrepancy critical point, not resolved.
- `skipped` stage state added for stages after a failure (truthful vs leaving them `pending`).

## Progress log

- Day 1: documents analysed; plan approved; CLAUDE.md written; monorepo, tooling, CI, Compose, migrations, auth,
  atomic upload, queue/worker, PDF parser, chunking, embeddings, basic UI.
- Day 2: LLM providers (OpenAI strict schema + fixture), deterministic monograph rules, summary, critical points,
  entities, identity gate, hybrid retrieval, verification merge, golden/negative/citation tests, `pnpm eval`.
- Day 3: SSE timeline, two-column viewer, citation sheet + deep link, all UI states, authz/rollback/failure/reconnect
  tests, DOCX table parsing fix (LibreOffice gutters), Playwright smoke, README.
- 2026-11-09: Playwright vs Compose found two container-only bugs: nginx served `.mjs` with the wrong MIME type
  (pdf.js worker failed to load), and the embedding model loaded lazily on the first job (~35 s). Both are fixed in
  source (`docker/nginx.conf`; worker warm-up in `apps/worker/src/main.ts`). After rebuilding, Playwright passes 4/4 (desktop + mobile)
  against the Compose stack in fixture mode; the worker logs `embedder.ready` (~0.4 s) before claiming jobs.

## Known risks

- PDF table reconstruction from text positions (mitigated by parser tests on the real fixture).
- Worker image size (LibreOffice + embedding model) → longer first build.
- Real-model behaviour only verified once the user supplies `OPENAI_API_KEY`.
- Monograph rule extraction is pattern-based and fitted to this digest's phrasing (see README limitations).
