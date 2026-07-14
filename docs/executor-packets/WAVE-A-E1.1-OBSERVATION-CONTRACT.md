# Task E1.1 — Canonical Research Observation Contract

Use a strong small or standard coding model. The architecture is frozen in ADR 0003; implement it without redefining policy.

## Repo

`/Users/samhuffard/All Claude Projects/portfolio-manager`

Read `CLAUDE.md`, `.claude/napkin.md`, `contracts/README.md`, `contracts/index.js`, existing contract/test patterns, `docs/adr/0003-point-in-time-research-record.md`, `docs/RESEARCH-DECISION-REGISTER.md`, and E1.1 in the execution guide.

## Implement

1. Add canonical `contracts/research-observation.js`.
2. Implement `MandateScoreObservationSchema` and its nested per-metric schema using the exact fields, enums, strict-object behavior, and cross-field consistency rules frozen in ADR 0003 and E1.1. Export any named enums/subschemas that migration and writer packets will reuse.
3. Export from `contracts/index.js` and document in `contracts/README.md`.
4. Add backend tests for complete, partial, unsupported-sector, coverage-arrival, and version-change observations plus contradictory/invalid fixtures.
5. Run `npm run contracts:sync` to generate the dashboard mirror.
6. Extend dashboard contract-drift tests if the existing glob does not automatically cover the new file.

Do not add persistence, migrations, proposal consumers, selection logic, or runtime feature flags. Do not weaken the ≥80 available-point/actionability distinction.

## Verify

```bash
cd "/Users/samhuffard/All Claude Projects/portfolio-manager"
npm test
npm run contracts:sync
cd "/Users/samhuffard/All Claude Projects/portfolio-dashboard"
npm test
npm run lint
```

Return the required completion report. Stop if implementation reveals a field or consistency rule not covered by the frozen list; do not widen an enum or weaken a refinement to make a fixture pass.
