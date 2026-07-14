# Task E0.2 — Post-Fix Research-Run Evidence Report

Use a strong small or standard coding model as a bounded implementation executor. This task adds forward aggregate instrumentation plus read-only reporting; it does not run a paid research scan.

## Repo

`/Users/samhuffard/All Claude Projects/portfolio-manager`

Read `CLAUDE.md`, `.claude/napkin.md`, `docs/ROADMAP-FORMIDABLE-FUND.md`, `docs/RESEARCH-ROADMAP-EXECUTION-GUIDE.md` E0.2, `lib/research-run-health.js`, `jobs/research-scan.js` summary/rule-check behavior, existing Redis/Sheets readers, and related tests.

## Implement

1. Add pure `lib/research-run-report.js` with the exact facts contract, category precedence, aggregation helpers, conservation checks, and legacy report behavior frozen in E0.2.
2. Update `jobs/research-scan.js` to supply facts at the decision site and persist aggregate `research-outcomes-v1` counts. Preserve every existing safety gate and proposal decision; this is observation only.
3. Add read-only `scripts/report-latest-research-run.mjs` using `getResearchScanStatus()`. It may print JSON/text but must never write Redis, Sheets, Postgres, or files. Legacy status must report insufficient structure, not parse Sheet rationale.
4. Add focused report tests and extend the closest scan-summary tests to prove exactly one outcome per attempted review and totals conservation.
5. Do not edit the already-modified `package.json`; document the direct `node scripts/report-latest-research-run.mjs` command in the completion report for later integration.

Do not trigger `research:scan`, call Anthropic, change prompts, or expose raw private rationale through `/health`.

## Verify

```bash
cd "/Users/samhuffard/All Claude Projects/portfolio-manager"
npm test
```

Return the required completion report. Stop if producing the facts would require changing a money decision or persisting new per-ticker rationale/private text. Do not add a parallel Sheet reader or infer a category from prose.
