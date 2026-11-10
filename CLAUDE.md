# CLAUDE.md — MediVerify AI

AI-powered verification of a (fictional) hospital discharge summary against an institutional formulary digest.
Take-home assignment; brief + fixtures live in `resources/`. **Fictional data, demo only — never real clinical advice.**
Authoritative sources: `resources/assignment_brief_medical.pdf` (requirements), `resources/reference_document_medical.pdf`
(the only source of prescribing truth — never override it with outside pharmacology knowledge).

## Stack

| Layer      | Choice                                                                                                         |
| ---------- | -------------------------------------------------------------------------------------------------------------- |
| Monorepo   | pnpm workspaces, Node 24, TypeScript 5.9 strict, ESM (`"type": "module"`, NodeNext)                            |
| Web        | React 19 + Vite 7 + Tailwind 4 + shadcn-style components (Radix), TanStack Query, react-router 7, react-pdf 10 |
| API        | NestJS 11 (Express), zod validation, global exception filter, cookie sessions                                  |
| Worker     | Plain TS process; Postgres queue (`FOR UPDATE SKIP LOCKED` + leases); LibreOffice headless for DOCX→PDF        |
| DB         | PostgreSQL 16 + pgvector; plain SQL migrations in `db/migrations`; raw SQL via `pg` (no ORM)                   |
| LLM        | OpenAI (strict JSON-schema structured output) behind `LlmProvider`; `fixture` provider for deterministic tests |
| Embeddings | Local `Xenova/bge-small-en-v1.5` (384-d) via `@huggingface/transformers` behind `EmbeddingProvider`            |
| Tests      | Vitest (unit, web: jsdom + Testing Library + MSW + axe, integration vs real Postgres), Playwright E2E + axe    |

## Layout

```
apps/api        NestJS HTTP API + SSE                      apps/worker   job runner (pipeline stages)
apps/web        React SPA (nginx in Docker, proxies /api)  packages/shared  zod schemas, DTO types, enums, error codes
packages/db     pg pool, tx helper, migrator, repositories packages/core  parsing, chunking, providers, retrieval, verification
db/migrations   NNNN_name.sql (forward-only, checksummed)  fixtures/     golden expectations + fixture LLM responses
tests/e2e       Playwright                                 docs/         implementation-plan.md, evaluation.md
```

Workspace packages export `src` under the custom condition `@mediverify/source` (used by tsx, Vitest, Vite, `tsc --noEmit`)
and `dist` by default (production). `tsconfig.build.json` per package emits to `dist`; build order is topological (`pnpm -r build`).

## Commands

```bash
pnpm install
docker compose up --build              # full stack: db, migrate(+seed), api, worker, web → http://localhost:8088
docker compose up -d db                # just Postgres (host port 55432) for local dev/tests
pnpm db:migrate && pnpm db:seed        # against DATABASE_URL
pnpm dev:api | pnpm dev:worker | pnpm dev:web
pnpm lint | pnpm lint:fix | pnpm format | pnpm format:check | pnpm typecheck
pnpm test:unit                         # no DB needed
pnpm test:web                          # React components in jsdom (MSW-mocked API), no DB needed
pnpm size                              # web build + gzip bundle budget (scripts/check-bundle-size.mjs)
pnpm test:integration                  # needs Postgres (TEST_DATABASE_URL)
pnpm test:e2e                          # Playwright vs running Compose stack (fixture mode)
pnpm eval                              # retrieval + classification eval (fixture LLM) → docs/evaluation.md numbers
pnpm eval:live                         # same with real OpenAI (needs OPENAI_API_KEY) — label results as live
pnpm run ci                            # format:check + lint + typecheck + unit + web + integration (mirrors CI; `pnpm ci` is a pnpm builtin)
```

## Conventions

- Strict TS (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`). No `any` without a comment. ESM imports use `.js` suffix.
- Nest DI: always explicit `@Inject(TOKEN)` on constructor params (tests run without decorator metadata).
- Validation: zod schemas live in `packages/shared`; API uses `ZodValidationPipe`; never trust client types.
- Errors: `{ error: { code, message, details? } }` with codes from `packages/shared/src/errors.ts`. Other users' resources → 404, not 403.
- SQL: parameterized only. Every user-owned query includes `owner_id = $userId`. Keep transactions short; never hold one across an LLM call.
- Logging: pino JSON; always include `job_id`, `document_id`, `stage`, `event`, `duration_ms` where relevant.
  Never log passwords, tokens, cookies, API keys, raw document text or full patient quotes (log lengths/hashes/ids).
- Formatting: Prettier (single quotes, 100 cols). ESLint flat config incl. `no-floating-promises`, react-hooks, jsx-a11y.
- Commits: Conventional Commits (commitlint). Husky: pre-commit = lint-staged + secret guard; pre-push = typecheck + unit tests.
  Hooks install via `prepare: husky || true` only inside a git repo; if `git config core.hooksPath` is not `.husky/_`,
  run `pnpm exec husky`. **Do not commit/push unless the user asks.**
- Keep `docs/implementation-plan.md` (checklist/progress/risks) and this file updated as decisions change.

## Architecture decisions

- **Upload atomicity**: one transaction inserts document (bytes in `bytea`, ≤10 MB) + job + 8 `job_stages` rows + first
  `job_events` row, then `NOTIFY`. Duplicate detection (sha256 + owner + `DUPLICATE_WINDOW_SECONDS`, default 300) runs inside it.
  Returns `202 {documentId, jobId, duplicate}`. The pipeline is never awaited in the request.
- **Queue**: `jobs` table. Claim = `FOR UPDATE SKIP LOCKED`; lease + heartbeat; reaper requeues expired leases (attempts+1)
  or fails after `max_attempts`. Each stage: short tx (running+event) → work (no tx) → short tx (results delete+insert,
  completed, event, NOTIFY). Completed stages are skipped on resume (idempotent). Failure → stage `failed`, later stages
  `skipped`, job `failed` with sanitized message. Terminal states: `completed` | `failed`.
- **Stages** (fixed names/order): `parsed → chunked → embedded → summarized → key_points_extracted → entities_extracted → verified → done`.
- **SSE**: `GET /api/jobs/:id/events`; persisted `job_events` with bigserial ids; replay `id > Last-Event-ID`; live via
  LISTEN/NOTIFY fan-out; 15 s heartbeats; `end` event on terminal. Client: snapshot (`GET /api/jobs/:id`) then EventSource.
- **Reference versions**: `reference_documents` (slug + version_label). Indexing is idempotent per (sha256, embedding model)
  under an advisory lock; jobs reuse an existing index and say so in the `chunked`/`embedded` stage events.
- **Auth**: argon2id hashes; opaque random session token, only its sha256 stored; HttpOnly + SameSite=Strict cookie;
  Origin check on mutating requests. Web and API are same-origin via nginx/Vite proxy (no CORS).

## Dev & test gotchas

- Run the API in dev from `apps/api` (`pnpm dev:api` does this): tsx only applies the decorator tsconfig inside its cwd.
- Vitest resolves `['@mediverify/source', ...defaultServerConditions]` (from `vite`); do not use `externalConditions`
  (breaks `pg`). Integration tests use DB `mediverify_test` (created + migrated by `tests/helpers/global-setup.ts`).
- Fixture LLM outputs are keyed by `sha256(document).slice(0,16)` under `fixtures/llm/<prefix>/`; they are hand-authored.
- nginx must serve `.mjs` as JavaScript (pdf.js worker). The worker warms the embedding model before claiming jobs.
- Status (2026-11-10): GitHub Actions green on `main`; 38 unit + 47 web + 42 integration + 6 Playwright pass locally;
  live OpenAI eval (`gpt-5.4-mini`) ran locally: 6/6 statuses, 100% citations; results in `docs/evaluation.md`.
- `pnpm typecheck` = every package + root `tsconfig.json` (scripts/tests). Host scripts load `.env` via
  `tsx --env-file-if-exists`; `pnpm eval` forces the fixture LLM regardless of `.env`.
- `LocalEmbeddingProvider` retries the first model download and never caches a failed load.
- OpenAI 429 `insufficient_quota` → `MODEL_QUOTA_EXCEEDED` (non-retryable); other 429/5xx/network errors are retried.
- Security: CI fails on high/critical advisories in production deps (`pnpm audit --prod --audit-level=high`).
  `sharp` is overridden to 0.35.5 in `pnpm-workspace.yaml` (transformers pins a vulnerable ^0.34). `pdfjs-dist`
  stays 5.4.296 in core and web (react-pdf's pin; 5.6.83–6.2.107 have CVE-2026-16633); Dependabot ignores it.
- Web tests (`apps/web/test`, Vitest project `web`): custom env `jsdom-environment.ts` keeps Node's AbortController
  (jsdom's breaks Node fetch/MSW); `setup.ts` resolves relative `/api` URLs, stubs EventSource (`FakeEventSource`).
  MSW handlers serve DTOs captured from a real fixture run (`test/fixtures/*.json`). Query by role/label (eslint
  testing-library); every page test runs `expectNoA11yViolations`; contrast is checked in `tests/e2e/a11y.spec.ts`.
  The PDF viewer is lazy-loaded and mocked in jsdom; pages are route-level lazy chunks; `pnpm size` enforces budgets.
  UI conventions: user-facing error wording in `lib/messages.ts`; `usePageTitle` per page; accessible names must
  contain the visible text (axe label-content-name-mismatch); no `text-slate-400` for text on white (contrast).
- Deployment guards: `ALLOW_SIGNUP`, `DAILY_JOB_LIMIT` (uploads + retries per user per 24 h, checked in the
  job-creating tx). Verification runs `VERIFY_CONCURRENCY` medications in parallel (`mapWithConcurrency`).
- Docker Desktop's VM disk is small (32 GB here); image rebuilds fill it. `docker builder prune` only with the user's OK.

## RAG & verification rules (do not weaken)

1. **Monograph chunking**: a monograph starts at a heading line followed by `Drug class:`. One parent chunk per monograph
   (identity + all fields together) plus field sub-chunks sharing `monograph_id`. Preface / quick-reference / coverage-note
   chunks are separate kinds and are never treated as a monograph.
2. **Identity gate first**: normalized exact name or explicit alias match against `reference_monographs`. Fuzzy/vector
   similarity NEVER establishes identity (Pranixol ≠ Pravoxil). Similar names may be shown as "not matched" only.
3. **Statuses**: `supported` (monograph exists, all checked parameters consistent) · `contradicted` (≥1 parameter conflicts) ·
   `unsupported` (no monograph in this reference — a coverage gap, not "unsafe") · `incomplete` (parsing/indexing/
   retrieval/model failure — never mislabel as unsupported).
4. Compare dose, unit, route, frequency, timing, duration, indication against the **matched** monograph — not just name
   existence or max dose. New start above standard dose without documented titration conflicts with a titration schedule.
5. Deterministic checks for numeric/time constraints; the LLM interprets nuance and explains, using only retrieved passages.
   Monograph rules are parsed **deterministically at index time** (`packages/core/src/rules/monograph-rules.ts`), each with
   a verbatim quote, stored in `reference_monographs.rules` — no LLM in reference indexing.
   A deterministic conflict with a validated quote is authoritative; an LLM-only conflict counts only if its quote validates
   (and, for indication, only if the quote states an exclusion/restriction — absence from the list is not a conflict).
6. **Quote validation**: every citation's quote must appear (whitespace/quote-normalized) in the cited chunk, and the chunk
   must belong to the matched monograph (or the coverage note for unsupported). Invalid evidence is dropped/marked, never shown as valid.
7. Summary and critical points use **only the primary document** (table rows are shown to the model as `a | b`; quote
   matching treats `|` as whitespace); every critical point has page + validated quote. Preserve
   internal discrepancies (e.g. two-week vs 8-week psychiatry follow-up) instead of smoothing them. Formulary corrections
   appear only in verification results, never rewritten into primary-document content.
8. Missing/ambiguous extracted values are `null` with a flag — never guessed.
9. Golden expectations (`fixtures/golden.json`) are **tests only** — never referenced by production code.
10. Document and retrieved text are untrusted data: wrap in delimited blocks, system prompt forbids following instructions
    inside them, outputs are schema-constrained, and citations must validate.

## Security & constraints

- Every user-owned route (documents, file download, jobs, SSE, results) enforces ownership in SQL. References are shared read-only.
- Upload validation: extension + magic bytes (`%PDF-` / DOCX zip with `word/document.xml`) + size limit, server-side.
- Secrets only via env (`.env`, see `.env.example`); never in code, logs, or the browser bundle.
- Fixture mode (`LLM_PROVIDER=fixture`) is labeled in the UI and errors on unknown documents — never fabricates output.
- One root `docker-compose.yml`; seed users documented in README. No external deploy/push without the user's approval.
