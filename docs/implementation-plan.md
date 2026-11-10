# Implementation plan & progress

Living checklist. Status: ☐ todo · ◐ in progress · ☑ done (verified by a command/test) · ✂ deferred (explicit).

## Requirement checklist

| Pri    | Requirement                                                                             | Status | Evidence                                                                                                                    |
| ------ | --------------------------------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------- |
| MUST   | Email/password signup/login/logout, hashed passwords, seed creds                        | ☑      | `api.test.ts` (argon2id hash, cookie flags, 401s); seed in `scripts/seed.ts`; browser login checked                         |
| MUST   | Upload PDF/DOCX (drag-drop, type/size validation) + select reference                    | ☑      | `api.test.ts` validation cases; `UploadPanel.tsx`; DOCX→PDF verified in the worker container                                |
| MUST   | `POST /documents` → 202 + job id; atomic document/job/stages/event tx                   | ☑      | `api.test.ts` 202 + injected-fault rollback test                                                                            |
| MUST   | Worker stages parsed→…→done with status/timing/errors; no hung jobs                     | ☑      | `worker-reliability.test.ts` (fail, retry, resume, SKIP LOCKED, reaper, zombie lease)                                       |
| MUST   | Real-time progress (SSE), survives refresh/reconnect                                    | ☑      | `api.test.ts` SSE replay/resume/live; checked in the browser                                                                |
| MUST   | Summary (primary only)                                                                  | ☑      | Golden test + faithfulness guard unit test (fixture LLM)                                                                    |
| MUST   | Critical points with page + validated quote; discrepancies preserved                    | ☑      | Golden tests (14 points, 100% quotes valid, psychiatry discrepancy kept)                                                    |
| MUST   | Structured medication extraction (all fields, raw+normalized, provenance)               | ☑      | Golden test; `pnpm eval` extraction 100% per field (fixture LLM)                                                            |
| MUST   | Monograph-aware chunking + embeddings in pgvector; reuse across jobs                    | ☑      | `parsing.test.ts` (8 monographs, chunk kinds); index reuse reported in stage events                                         |
| MUST   | Identity-gated hybrid retrieval; verification S/C/U(+incomplete) w/ validated citations | ☑      | Golden 6/6; `verification.test.ts`; `docs/evaluation.md`                                                                    |
| MUST   | Two-column view (PDF + results), clickable citation preview                             | ☑      | Browser check on Vite dev; Playwright reviewer flow vs Compose passes (desktop + Pixel 7)                                   |
| MUST   | Loading / empty / error / failed-job / model-unavailable states                         | ☑      | `DocumentsPage`, `DocumentPage`, `AppShell` banners; checked in the browser                                                 |
| MUST   | Ownership enforcement on every endpoint incl. SSE + file                                | ☑      | `api.test.ts` IDOR test across every route incl. SSE and file                                                               |
| MUST   | Structured JSON logs traceable per job                                                  | ☑      | pino with job_id/document_id/stage/event/duration_ms in worker + API                                                        |
| MUST   | Tests: golden verification, authz, rollback, failure, reconnect                         | ☑      | 30 unit + 40 integration passing locally                                                                                    |
| MUST   | Single docker-compose, versioned migrations, seed, README < 10 min                      | ☑      | Stack came up healthy from `docker compose up --build`; README written                                                      |
| SHOULD | Lint/format/strict TS, Husky hooks, GitHub Actions CI                                   | ☑      | GitHub Actions green on `main` (quality, tests, Compose + Playwright, secret scan); Husky hooks verified via `git hook run` |
| SHOULD | Retrieval/classification evaluation with measured numbers                               | ☑      | Fixture + live OpenAI runs in `docs/evaluation.md` (live report `docs/evaluation-live.json`)                                |
| EXTRA  | Duplicate upload detection (sha256, 5-min window)                                       | ☑      | `api.test.ts` duplicate test                                                                                                |
| EXTRA  | Deep-link citation into reference PDF                                                   | ☑      | Browser check: opens p.5 with the exact quote highlighted                                                                   |

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
- 2026-11-10: first GitHub CI run failed (root `scripts/`/`tests/` type errors not covered by `pnpm typecheck`; Hugging
  Face download reset with no retry) → `typecheck` now includes the root tsconfig, the embedding loader retries. Secret
  scan needed `pull-requests: read` on PRs. `main` is green. Live OpenAI test: key valid, account had no credit →
  added non-retryable `MODEL_QUOTA_EXCEEDED`. Husky hooks installed (`pnpm exec husky`; install predated `git init`).
  Verification logs now include identity-gate outcome, top passages with scores and `decided_by`; README gained the
  retrieval evaluation strategy and a log-tracing guide; Dependabot set to skip major versions.

- 2026-11-10 (security): `pnpm audit` found 4 high advisories in production deps that the report-only CI audit
  let through: `pdfjs-dist` 5.7.284 (CVE-2026-16633, introduced by the #18 upgrade) and `sharp` 0.34 via
  transformers (libvips/libheif/librsvg). Worker pdf.js back to 5.4.296 (same as web), `sharp` overridden to 0.35.5
  (embeddings verified), CI now blocks on high/critical production advisories. Dev-only advisories (vitest/tinypool,
  minimatch) remain report-only.

- 2026-11-10 (hardening): verification runs 3 medications in parallel (bounded, order kept); `ALLOW_SIGNUP` and a
  per-user `DAILY_JOB_LIMIT` protect a paid model key; web ships no source maps and lazy-loads the PDF viewer (main
  bundle 997 KB → 572 KB); first frontend unit tests (progress reducer, upload validation); v8 coverage with
  thresholds in CI (57.6% statements / 77.5% branches / 72.4% functions); every setting documented in `.env.example`,
  Compose and the README; README screenshots.
- 2026-11-10 (live evaluation): 8 full `pnpm eval:live` runs on `gpt-5.4-mini`. Fixes from what they showed: the
  summary and critical-point prompts now compare follow-up timings across sections (the psychiatry discrepancy had
  been lost); quote matching treats table `|` separators as whitespace (faithful table quotes had been rejected);
  an LLM-only indication conflict needs exclusion language. New eval metric: discrepancy preserved. Final run: all
  metrics 100%.

- 2026-11-10 (frontend quality): Vitest `web` project (jsdom + Testing Library + MSW + axe-core) with 47 component tests
  over pages, results, upload, auth, SSE progress and the error boundary; Playwright axe scan (WCAG 2.1 AA incl.
  contrast) on every page. The scans found and fixed: unlabeled file input, label/name mismatches, low-contrast
  text and toasts, an unfocusable scroll region, a colour-only inline link. UX: results split into focused
  components; status tiles filter; critical point → verification jump with focus; accessible mobile tabs; document
  search + status filter; per-page titles; skip link; live progress announcements; honest fixture badge; per-route
  error boundary; route-level code splitting (entry 572 → 479 KB); gzip bundle budget in CI. Coverage 57.6% → 83.8%.

## Known risks

- PDF table reconstruction from text positions (mitigated by parser tests on the real fixture).
- Worker image size (LibreOffice + embedding model) → longer first build.
- Live model output varies between runs; measured on one document (8 runs). Safeguards stay in code (quote validation,
  deterministic merge, identity gate, indication-exclusion rule).
- Monograph rule extraction is pattern-based and fitted to this digest's phrasing (see README limitations).
