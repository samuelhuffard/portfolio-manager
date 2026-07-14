# Task E0.1 — Canonical Holdings-Row Classifier

Use the model as a bounded implementation executor. Do not broaden scope.

## Repo and context

- Backend: `/Users/samhuffard/All Claude Projects/portfolio-manager`
- Dashboard: `/Users/samhuffard/All Claude Projects/portfolio-dashboard`
- Packet: E0.1 in `docs/RESEARCH-ROADMAP-EXECUTION-GUIDE.md`

Read backend `CLAUDE.md`, `.claude/napkin.md`, `docs/CHANGE_MAP.md`, the E0.1 packet, and all target files/tests before editing. Run `git status --short --branch` in both repos and preserve unrelated changes.

## Implement

1. Add backend `lib/holdings-rows.js` with canonical normalized marker/security predicates exactly as E0.1 specifies.
2. Replace ad hoc marker checks in:
   - `lib/sheets.js` four Holdings readers;
   - `lib/pg/parity-runner.js`;
   - `scripts/db-backfill.mjs`;
   - `scripts/migrate-to-shared-portfolio.js`.
3. Add/move focused backend tests.
4. Add dashboard mirror `lib/holdingRows.ts`, update both readers in `lib/sheets.ts`, and add identical fixture tests.
5. Search for stale reader predicates afterward.

Do not change Sheet marker text, row layout, or unrelated dashboard files.

## Verify

```bash
cd "/Users/samhuffard/All Claude Projects/portfolio-manager"
npm test
cd "/Users/samhuffard/All Claude Projects/portfolio-dashboard"
npm test
npm run lint
```

Return the completion-report format from the execution guide. Do not deploy, commit unrelated files, or push.
