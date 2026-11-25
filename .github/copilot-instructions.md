# Copilot instructions

Follow [`AGENTS.md`](../AGENTS.md) at the repository root. It is the single source of truth for this repo's stack,
commands, conventions, architecture decisions and the RAG & verification rules, which must never be weakened.

Key points: pnpm + Node 24, strict TypeScript ESM (`.js` import suffixes), zod schemas in `packages/shared`,
parameterized SQL with ownership checks, no secrets or patient text in logs, Conventional Commits, and
`pnpm run ci` must pass.
