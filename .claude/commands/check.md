---
description: Run the CI quality gates locally and fix what fails
---

Run the same checks CI runs, in this order, and stop at the first failing step to fix it before moving on:

1. `pnpm format:check` — if it fails, run `pnpm format` and re-check.
2. `pnpm lint` (zero warnings allowed).
3. `pnpm typecheck` (every package plus root scripts/tests).
4. `pnpm test:unit` and `pnpm test:web`.
5. `pnpm test:integration` — needs Postgres (`docker compose up -d db`, host port 55432). If it is not running, say so
   and skip rather than failing.
6. If anything under `apps/web` changed (`git diff --name-only main...HEAD`), also run `pnpm size`.

Fix root causes; never weaken a test, lower a coverage threshold or relax a lint rule to get green. If a change touches
`packages/core/src/{verification,rules,llm,pipeline,chunking}`, run the `verification-reviewer` subagent too.
Finish with a short table of each step and its result. Do not commit or push.

$ARGUMENTS
