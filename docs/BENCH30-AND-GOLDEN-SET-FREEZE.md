# W2 — Bench-30 and Golden-Set Freeze

**Status:** local fixture contract; no vendor/model result and no performance claim  
**Artifacts:** `fixtures/bench30-golden-set.js`, `lib/offline-research-fixtures.js`  
**Verification:** `node --test tests/offline-research-fixtures.test.js`

Bench-30 is a 30-slot fixture manifest—not a backtest and not a provider comparison.
It covers ordinary companies, banks, insurers, REITs, thin coverage, stale estimates,
restatements, share-class/corporate-action traps, and negative cases. Every slot has
a fixed decision time, receipt time, source tier, expected facts/missingness, and
policy version, but intentionally contains no retrieved provider values.

The fixture validator freezes four synthetic/non-promotional sample classes:
`QualifyingSetup`, `OrganicProposal`, `ResearchExclusion`, and
`GeneratorDegraded`. It rejects source-tier omissions, future facts, retrieval
after decision time, mixed policy versions, mutable fixture substitution, and an
unlabelled synthetic report. A passing fixture means only that the local contract is
internally valid; it is never organic Phase 0 evidence or investment evidence.

