## What & why

## Checklist

- [ ] `pnpm ci` passes locally (format, lint, typecheck, unit + integration tests)
- [ ] Verification rules in `CLAUDE.md` still hold (identity gate, quote validation, no fixture lookups in prod code)
- [ ] New/changed endpoints enforce ownership and have an authz test
- [ ] No secrets, patient text or document content added to logs
- [ ] README / docs updated if behaviour changed
