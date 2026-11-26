# CLAUDE.md

@AGENTS.md

## Claude Code specifics

- Project guidance lives in `AGENTS.md` (imported above). Update that file, not this one, when conventions change.
- `.claude/settings.json`: shared permissions (safe `pnpm` checks pre-allowed; `.env` reads denied) and the
  Playwright MCP server from `.mcp.json`. Personal overrides go in `.claude/settings.local.json` (git-ignored).
- `.claude/launch.json`: dev servers for the preview pane (`web-dev` on 5173, `api-dev` on 3001, `worker-dev`).
  The web dev server proxies `/api` to the API, so start `api-dev` (and Postgres) for a working app.
- `/check` (`.claude/commands/check.md`): run the same gates as CI and fix what fails.
- `verification-reviewer` subagent (`.claude/agents/`): review changes to parsing, retrieval, rules, LLM or
  verification code against the RAG & verification rules before calling the work done.
