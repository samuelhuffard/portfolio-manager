# Portfolio Manager — Research Roadmap Execution Guide

> **Narrow authority: engineering packets.** Phase order, TRUST/SKILL labels,
> current status, and promotion/reset gates are canonical in
> [the master plan](portfolio-master-plan.md). This guide specifies bounded work
> packets and verification; it cannot promote a phase or resolve a human policy
> question.

**Rev 2026-07-16 · companion to `docs/roadmaps/ROADMAP-FORMIDABLE-FUND.md`**

> The roadmap defines the destination and the gates. This document turns it into bounded engineering work that an executor model can complete without silently changing the investment thesis, authority model, or safety invariants.

This is not a command to implement every item immediately. It is the implementation map the primary reviewer uses to select, assign, inspect, and promote one task packet at a time.

---

## 1. Roles

### Primary reviewer / systems architect

Owns the larger picture:

- Chooses the next roadmap packet and confirms its prerequisites.
- Resolves ambiguous product, investing, data, and authority decisions.
- Approves contract shapes, migrations, signature changes, feature flags, and rollout gates.
- Reviews every cross-repo or money-adjacent diff.
- Verifies runtime evidence on the Jetson, dashboard, Redis, Sheets, Postgres, and Mac companion.
- Decides whether shadow evidence is strong enough for canary or live promotion.
- Keeps `docs/roadmaps/ROADMAP-FORMIDABLE-FUND.md`, `docs/roadmaps/AUTONOMY-ROADMAP.md`, and runtime behavior consistent.

The primary reviewer should not hand an executor a vague phase such as “build point-in-time scoring.” It should hand over one packet below with frozen inputs and explicit acceptance criteria.

### Small executor model

Best for:

- One pure module plus focused tests.
- Mechanical schema mirroring after the canonical contract is already approved.
- A single idempotent database migration whose table design is already specified.
- Replacing duplicated predicates with one shared helper.
- Adding status fields or read-only diagnostics using an existing pattern.
- Wiring an already-tested pure function into one existing job behind an off-by-default flag.
- Documentation synchronization and stale-reference searches.

The small executor must not:

- Invent mandate definitions, scoring thresholds, benchmarks, or cash-pressure policy.
- Decide that a partial score is comparable to a complete score.
- Change proposal signatures, approval transitions, execution order, or ownership semantics.
- Turn on production flags, deploy, migrate production, or mutate external state.
- edit both the backend and dashboard contract independently; canonical contracts originate in `contracts/`.
- introduce a second research/proposal pipeline because the canonical one is inconvenient.
- “fix” failing safety tests by weakening assertions or making missing state pass.

### Standard builder model

Use for bounded but cross-file work:

- Contract + migration + persistence adapter within one domain.
- Scheduler orchestration with locks and failure-state reporting.
- Shadow-mode integration across the backend and dashboard.
- Proposal compiler work after the primary reviewer freezes the contract and signature policy.
- Historical-data and backtest plumbing after the methodology is predeclared.

### Independent reviewer

Runs after meaningful packets:

- Reads the task packet, roadmap invariant, and full diff.
- Searches for stale copies and bypass paths.
- Checks fail-closed behavior, units, timestamps, idempotency, and version lineage.
- Does not implement a broad rewrite during review; returns findings or a narrow corrective patch.

---

## 2. Executor operating protocol

Every executor starts with:

1. Resolve the repo as `/Users/samhuffard/All Claude Projects/portfolio-manager`.
2. Read `.claude/napkin.md`, `CLAUDE.md`, `docs/roadmaps/ROADMAP-FORMIDABLE-FUND.md`, this guide, and the relevant section of `docs/CHANGE_MAP.md`.
3. If touching proposals, execution, ledgers, lots, or NAV, also read `docs/INVARIANTS.md` completely.
4. Run `git status --short --branch`. Preserve all pre-existing changes and untracked files.
5. Read every target file and its closest tests before editing.
6. Implement only the assigned packet.
7. Use pure functions and tests before job wiring.
8. Search for stale references after renames or extracted helpers.
9. Run the packet verification commands.
10. Return a concise report with files changed, tests run, assumptions, remaining risks, and exact items intentionally not changed.

### Required stop conditions

Stop and ask the primary reviewer when:

- The mandate text does not define an exact metric, threshold, unit, or fallback.
- An existing test conflicts with the assigned contract.
- A schema change would invalidate approved proposals or require a signature-payload change.
- A migration cannot be additive and idempotent.
- A task would require enabling a feature flag or touching production data.
- A supposedly advisory path is read by proposal sizing, approval, execution, ledger, or reconciliation code.
- A new implementation would duplicate an existing compiler, parser, or contract.
- The worktree contains overlapping user changes that cannot be safely preserved.

### Completion report template

```text
Packet: <O# | E#.#> — <name>
Outcome: complete | blocked

Changed:
- <file>: <behavior>

Verified:
- <command>: <result>

Preserved invariants:
- <relevant invariant>

Not changed:
- <explicit exclusions>

Open questions / risks:
- <only genuine remaining items>
```

---

## 3. Change sequencing

```text
Phase 0 runtime proof
  ├─ E0.1 canonical Holdings-row classifier
  ├─ E0.2 post-fix scan report
  └─ E0.3 budget/floor evidence review
          |
          v
Phase 1 point-in-time record
  ├─ E1.1 observation contract
  ├─ E1.2 research tables migration
  ├─ E1.3 Postgres writer
  ├─ E1.4 deterministic version/provenance IDs
  ├─ E1.5 sequential data-refresh workflow
  └─ E1.6 health/status surface
          |
          v
Phase 2 coverage convergence
  ├─ E2.1 coverage accounting
  ├─ E2.2 special-sector classifier
  ├─ DECISION: Agent 1 sector scope
  ├─ DECISION: balance-sheet definitions
  └─ E2.3/E2.4 Agent 2/3 adapters after definitions freeze
          |
          v
Phase 3 score validation
  ├─ E3.1 delta-cause classifier
  ├─ E3.2 research-event ledger
  ├─ E3.3 shadow slate comparator
  └─ METHODOLOGY GATE: point-in-time backtest design
          |
          v
Phase 4 evidence slate
  ├─ E4.1 pure evidence-slate selector
  ├─ E4.2 shadow/canary recorder
  └─ E4.3 live wiring only after promotion review
          |
          v
Phase 5 unified proposal lineage
  ├─ CONTRACT/SIGNATURE DECISION
  ├─ E5.1 additive lineage contract + migration
  ├─ E5.2 canonical compiler
  ├─ E5.3 route all entry points
  └─ E5.4 dashboard + companion parity
          |
          v
Phase 6 cash challenger → Phase 7 edge measurement
```

No packet below a decision gate may be promoted merely because its code is easy to write.

### 3.1 Phase 0 observation-period offline work program

This program turns the July 15 Claude review and the independent cross-model
review into bounded work that may proceed while the 10-day TRUST observation is
running. It does **not** authorize a production release. Its purpose is to use the
freeze productively without changing the system being observed.

Executor-ready wave assignments, owned-file lists, read sets, acceptance criteria,
verification commands, and Claude/Codex handoff prompts live in
[`OBSERVATION-PERIOD-OFFLINE-EXECUTION-PLAN.md`](OBSERVATION-PERIOD-OFFLINE-EXECUTION-PLAN.md).

#### Binding operating boundary

- Create an isolated branch/worktree from the exact observed production revision.
  Do not perform this work in the production-tracking checkout when it contains
  observation or planning edits.
- Commits are allowed only on the isolated non-production branch. Do not merge to,
  push over, or deploy `mandate-v3` or `main`; do not restart the Jetson, companion,
  or dashboard.
- Do not run production migrations, change production environment variables or
  flags, write Redis/Sheets/Postgres/broker state, create proposals, or call paid
  model/vendor services.
- Use deterministic fixtures, synthetic cases, sanitized immutable historical
  inputs, and injected fakes. Any code that could affect a live job must remain
  disconnected from schedulers and production entry points.
- A local pass is engineering evidence only. It cannot count as a TRUST day, a
  SKILL sample, a shadow/canary day, or a phase promotion.
- If a real S1/S2 defect is discovered, stop this program and return it to the
  primary reviewer. Do not disguise an emergency repair as an offline packet.

#### Gate interpretation to encode in documentation

The execution target is two independent completions:

1. **Phase 0-TRUST complete:** 10/10 clean trading days plus zero unresolved
   critical incidents under the pinned supervised release.
2. **Current-version research throughput:** at least three organic actionable
   specialist proposals and one evaluator approval under the first declared R1
   cohort. This remains a real gate, but it blocks positive research canaries and
   later authority promotion—not Phase 0-TRUST completion, Phase 1 policy work, or
   inert Phase 2 shadow plumbing.

This split must not weaken any money, monitoring, companion, parity, receipt,
ledger, reconciliation, or holding-coverage requirement. Forced legacy proposals
do not count as organic throughput. A material R1 release opens a new SKILL cohort;
it does not reset already-clean TRUST days unless it also changes S1/S2 behavior.

#### Observation-period packet order

| Packet | Scope | Class / clock effect | Production boundary | Completion evidence |
|---|---|---|---|---|
| **O0 — Reconcile the saved gates** | Draft the master-plan/roadmap wording that separates Phase 0-TRUST completion from the R1 throughput gate; mark superseded July 15 blocker conclusions as historical. | D; no reset | Documentation only; no observer or runtime semantics | Cross-document consistency review; TRUST requirements unchanged; throughput gate retained and attached to the first R1 cohort |
| **O1 — Pre-register proposal-quality measurement** | Replace the informal 78/90/60 confidence numbers with explicit priors or targets; define a qualifying setup, organic sample, exclusion rules, policy/version strata, measurements, and decision thresholds. | D/R1 design; no reset | No prompt, threshold, evaluator, or candidate-selection change | Frozen measurement spec and fixtures; no claim of measured accuracy or edge |
| **O2 — Build the offline R1 diagnostic harness** | Add a fully stubbed positive-path contract test and deterministic fixtures for evaluator contradiction veto, `generator_degraded`, stale-data cohort eligibility, near-miss/margin telemetry, novelty, and outcome conservation. | R1 local-only; no TRUST reset | Pure modules/tests or disconnected adapters only; no scheduler/job wiring, model calls, queue writes, or proposal creation | Focused tests, full backend tests, fail-closed/downgrade-only proof, and a search proving no live entry point imports the new harness |
| **O3 — Specify equal discovery with mandate-specific judgment** | Define the neutral eligible candidate-bus contract, shared evidence/capacity/failure invariants, mandate-specific ranking interface, recency/event inputs, and Agent 1/2/3 fixtures. | R1 design/local-only; no TRUST reset | No catalog activation, watchlist removal, live rotation, slot counts, or materiality thresholds | Contract/fixture review; Q-001–Q-005 unknowns remain explicit; identical eligibility does not imply identical ranking |
| **O4 — Freeze Athena package and golden-set fixtures** | Draft `AthenaEvidencePackage-v1`, partial/stale/conflict/drift behavior, immutable fingerprint rules, and the predeclared 30-company golden-set expected facts and scoring rubric. | D/R1/R2 local-only; no TRUST reset | No live Athena intake, endpoint dependency, production credentials, paid trials, purchases, or proposal use | Schema/fixture validation, permission/API assumptions listed, expected facts frozen before vendor results |
| **O5 — Run free deterministic offline comparisons** | Compare current, compact-Athena, and full-package paths only with approved fixtures or already captured immutable inputs; measure factual support, missing-data honesty, evaluator behavior, latency structure, and reproducibility. | R1 local evidence; new SKILL cohort only after an actual declared release | No paid models/vendors, live prompts, production inputs, or investment action | Reproducible aggregate report with negative/null results, explicit limitations, and no promotion/edge conclusion |
| **O6 — Assemble a non-production release candidate** | Reconcile O0–O5, remove stale references, document flags and rollback, and prepare independently reviewable commits for later consideration. | D/R1/R2; no clock effect while undeployed | Remains on isolated branch; no merge, deployment, restart, migration, activation, or production verification claim | Clean diff/secret scan, focused and full tests, independent review, and proof that all promotion flags and live imports remain unchanged |

#### Dependency and stop rules

- O0 and O1 may proceed first and in parallel as documentation work. O1 must finish
  before O2 results are interpreted.
- O2 may build deterministic mechanics before Q-001–Q-005, but it may not invent
  investment thresholds or mark any synthetic result as an observation sample.
- O3 may freeze interface shape before mandate decisions; actionable adapters,
  live rotation policy, event materiality, and canary slots stop at Q-001–Q-005.
- O4 contract fixtures may proceed before Athena owner permission. Any endpoint
  integration, source transfer, vendor trial, or use of Athena code/data stops until
  permission, ownership, privacy, and service expectations are explicit.
- O5 runs only with zero-cost, non-production inputs authorized for local use. If a
  meaningful comparison requires a paid call or current private production payload,
  stop and request a separate decision after Phase 0.
- O6 is a review candidate, not a release. After Phase 0, the primary reviewer must
  reclassify every diff as D, R1, R2, S1, or S2 and choose what—if anything—may be
  merged into a declared research release.

#### Explicitly deferred until after Phase 0

- Any live R1 prompt, evaluator, threshold, scoring, freshness, or candidate-policy
  change.
- Agent 2/3 catalog/candidate-bus activation, positive canary slots, or production
  watchlist removal.
- Athena production intake, live package consumption, vendor trials/purchases, or
  production data-source changes.
- Observer/deployment-identity changes absent a demonstrated false green; companion
  downtime continues to invalidate TRUST evidence.
- Signature v2, proposal-lineage enforcement, canonical Postgres money reads,
  Agent 4 authority, execution/accounting changes, or any S1/S2 release.

### 3.2 Verified local implementation ledger

This ledger describes the current worktree, not production. “Verified locally” means the scoped implementation passed focused and full repository verification; it does not mean the packet is committed, migrated, deployed, activated, empirically validated, or promoted.

| Packet | Current local state | Remaining gate |
|---|---|---|
| E0.1 | Verified locally across backend and dashboard Holdings readers. | Commit, deploy, and production marker-row proof. |
| E0.2 | Versioned run-outcome classification and read-only reporting are verified locally. | One fresh post-fix production run with complete accounting. |
| E0.3 | Existing budget-reserve and Agent 3 floor edits are preserved but are outside this rollout. | Fresh usage/confidence evidence and reviewer policy acceptance. |
| E1.1–E1.6 | Contract, additive observation migration, append-only writer, deterministic IDs, ordered workflow, and health surfaces are verified locally. | Reviewed migration/deployment, prerequisite configuration, and runtime proof. |
| E2.1 | Coverage/freshness accounting is verified locally. | Observed catalog data. |
| E2.2 | Not implemented. | Approved special-sector taxonomy/mapping review. |
| E2.3 | A fail-closed Agent 1 standard-sector adapter is implemented locally; unresolved fields remain unavailable. | Q-001 and Q-004 before balance-sheet completion or proposal actionability. |
| E2.4 | Deterministic scoring primitives exist; Agent 2/3 source-history adapters do not. | Q-002–Q-004 and approved point-in-time history semantics. |
| E3.1 | Delta-cause classification is implemented locally; unresolved materiality stays non-eligible telemetry. | Q-005 before live event eligibility. |
| E3.2/E3.3 | Append-only event/selection history and the shadow comparator are verified locally. | Migration/deployment and observed shadow data. |
| Backtest scaffold | Synthetic point-in-time loaders, replay, and pure metrics are implemented locally. | Historical data, leakage/survivorship review, Q-007, and out-of-sample evidence before conclusions. |
| E4.1 | The pure evidence-slate selector is verified locally. | Shadow evidence. |
| E4.2 | The shadow-recording portion is verified locally. Positive canary/live application fails closed. | Q-005, deployment, and explicit shadow-to-canary promotion. |
| E4.3 | Not implemented. | Phase 3/4 evidence and promotion review. |
| E5 | ADR/design only; no implementation is accepted. | Outstanding-v1 approval inventory and an exact signature-v2 cutover payload, followed by high-risk review. |
| E6 | Not implemented. | Q-006. |
| E7.1 | Pure outcome math plus additive persistence/readers are verified locally. | E7.4 cadence, deployment, mature samples, and accepted horizon/benchmark/cost policy. |
| E7.2 | Pure attention-policy counterfactuals are verified locally. | Durable mature paired outcomes and version-separated reporting. |
| E7.3 | An aggregate-safe deterministic report builder and read-only script are verified locally. | Real stored evidence, Q-007, and primary-reviewer conclusions. |

Do not change packet specifications below merely to match an implementation. If later review finds a mismatch, fix or reject the implementation and then update this ledger from verified evidence.

---

## 4. Phase 0 packets — prove and clean the current system

### E0.1 — Canonical Holdings-row classifier

**Model fit:** small executor.

**Goal:** one tested predicate distinguishes securities from cash, timestamps, warnings, MCP provenance rows, and blank rows everywhere.

**Backend changes:**

- Add `lib/holdings-rows.js` with:
  - `holdingRowLabel(rowOrLabel)` — normalized trimmed label.
  - `isHoldingMarkerRow(rowOrLabel)` — true for blank, `Cash`, `/^last synced\b/i`, `/^synced via robinhood agentic mcp\b/i`, and labels beginning `⚠️`.
  - `isSecurityHoldingRow(rowOrLabel)` — exact inverse only after a nonempty ticker-shaped label is present.
- Update `lib/sheets.js`:
  - `readHoldingsTickers`.
  - `readHoldingsDetail`.
  - `readHoldingsAllocation`.
  - `readHoldingsReturnPct`.
- Update `lib/pg/parity-runner.js` to import the canonical helper and remove its local copy.
- Update `scripts/db-backfill.mjs` and `scripts/migrate-to-shared-portfolio.js` to use the helper.
- Add `tests/holdings-rows.test.js`; move marker-specific assertions out of `tests/pg-parity-runner.test.js` while keeping parity behavior covered.

**Dashboard mirror:**

- Add `../portfolio-dashboard/lib/holdingRows.ts` with the same predicate semantics.
- Update both Holdings readers in `../portfolio-dashboard/lib/sheets.ts`.
- Add `../portfolio-dashboard/tests/holding-rows.test.ts`.

Do not create a cross-repo runtime import. The backend JavaScript implementation is canonical in behavior; the dashboard TypeScript mirror is protected by identical fixtures.

**Acceptance:**

- `Synced via Robinhood Agentic MCP` never appears as a ticker in research, parity, backfill, dashboard holdings, or migration paths.
- Lower/upper-case and surrounding whitespace variants are covered.
- Real class tickers such as `BRK.B` and `BF-B` still pass.
- `rg 'startsWith\("Last synced"\)|Synced via Robinhood'` finds only the canonical helpers, writers, docs, and tests—not ad hoc reader predicates.

**Verify:**

```bash
npm test
cd ../portfolio-dashboard
npm test
npm run lint
```

**Forbidden:** changing Sheet marker text or row layout.

---

### E0.2 — Post-fix research-run evidence report

**Model fit:** small executor for reporting code; primary reviewer for interpretation.

**Goal:** account for every attempted review and separate investment HOLDs from degraded-system HOLDs.

**Known limitation:** existing Sheet rows and the current Redis summary do not preserve enough structured state to reconstruct all historical outcomes. In particular, proposal-write/sizing failures and evaluator/no-proposal reasons are not fully present in recommendation readers. Do not infer them from rationale prose. This packet adds truthful forward instrumentation; a legacy run must report `classificationAvailable=false`.

**First action is read-only:** inspect the latest run’s Redis status, recommendation rows, usage ledger, and PM2 timestamps. If the latest run predates the fix, report that and stop; do not manufacture proof.

**If a reusable report is needed:**

- Add pure `lib/research-run-report.js`:
  - `classifyRecommendationOutcome(facts)` consumes explicit structured facts supplied at the decision site, never rationale text.
  - Categories: `investment_hold`, `data_gate`, `stale_data`, `budget_exhausted`, `review_error`, `evaluator_reject`, `evaluator_error`, `risk_downgrade`, `duplicate`, `proposal_blocked`, `queue_error`, `paper_only`, `proposal_created`, `unknown`.
  - `blankOutcomeCounts()`, `addOutcome(counts, kind)`, and aggregate validation ensure exactly one outcome per attempted review.
  - Unknown remains visible and never counts as investment HOLD.
- The structured `facts` input has exactly: `attempted`, `dataGateBlocked`, `dataGateStale`, `failureKind`, `generatorAction`, `finalAction`, `riskOverridden`, `evaluatorState`, `duplicateOpen`, `proposalDisposition`, where `evaluatorState` is `not_run|approved|rejected|error` and proposal disposition is `not_applicable|created|blocked|queue_error|paper_only`.
- Classification precedence is: not-attempted/contradictory → `unknown`; created → `proposal_created`; budget failure → `budget_exhausted`; other failure → `review_error`; stale gate → `stale_data`; other data gate → `data_gate`; evaluator error → `evaluator_error`; evaluator rejection → `evaluator_reject`; duplicate → `duplicate`; queue error → `queue_error`; paper-only → `paper_only`; blocked → `proposal_blocked`; explicit risk override from non-HOLD to HOLD → `risk_downgrade`; generator and final action both HOLD with no adverse state → `investment_hold`; otherwise → `unknown`.
- Update `jobs/research-scan.js` to build these facts at the decision site, increment exactly one per attempted ticker, and persist only aggregate `outcomeCounts`, `unknownOutcomeCount`, and `classificationVersion: "research-outcomes-v1"` in agent/totals scan status. Do not persist new rationale or per-ticker private text in Redis.
- Add `scripts/report-latest-research-run.mjs` that reads `getResearchScanStatus()` and emits JSON plus a short text summary. It must not write Redis, Sheets, Postgres, or files. If `classificationVersion` is absent, emit `classificationAvailable=false`, the run ID/timestamps/counts already present, and `reason=legacy_status_insufficient`; do not read Sheet prose to guess.
- Add `tests/research-run-report.test.js` with one fixture for every classification, precedence collisions, aggregate conservation, contradiction/unknown behavior, and legacy status behavior. Extend the closest scan-summary tests for status persistence.
- Optionally add the aggregate, without ticker/rationale/private text, to `server.js` `/health` only after a privacy review.

**Acceptance:** total classified outcomes equals attempted reviews for each agent and the run total; infrastructure failures cannot be counted as investment judgments; a legacy run is explicitly non-classifiable.

**Verify:** `npm test` and one read-only run against production after explicit runtime access approval.

**Forbidden:** triggering a new paid scan merely to populate the report unless Sam explicitly asks.

---

### E0.3 — Research budget and confidence evidence packet

**Model fit:** small executor for tests; primary reviewer for policy decision.

**Current local changes:** `lib/ai-budget.js` and `config/agents/agent-3/risk-limits.json` are already modified. Preserve them.

**Executor work:**

- Extend `tests/ai-budget.test.js` to assert the proposed default reservations and environment override precedence.
- Extend `tests/risk-engine.test.js` or `tests/specialist-mandate-config.test.js` to assert Agent 3’s proposed floor only after the reviewer accepts the sample and rationale.
- Add no new production code until fresh `pm:anthropic-usage:<date>` records confirm actual generator/evaluator cost distributions.
- Record sample count, median, p90, cache-hit/miss split, and maximum observed cost. Do not justify reserves from averages alone.
- Record the number of historical actionable calls used in the 0.65→0.60 analysis. If the sample is small or produced by an older prompt/mandate, label it non-comparable.

**Acceptance:** the chosen reserve fits a declared high percentile with headroom, environment overrides still win, and the confidence threshold is tied to current-version evidence.

**Forbidden:** lowering a threshold to force BUYs or deploying the change as part of an unrelated scoring commit.

---

## 5. Phase 1 packets — point-in-time research record

### E1.1 — Canonical `MandateScoreObservation` contract

**Model fit:** standard builder drafts; primary reviewer freezes; small executor may implement after the field list is frozen.

**Add:** `contracts/research-observation.js`.

**Required top-level fields:**

```text
id                         stable content-derived or UUID observation id
runId                      identifies one scoring job run
observedAt                 when the score was calculated
agentId
mandateId
mandateVersion
mandateUniverseVersion     target mandate universe policy
productionUniversePolicyVersion active production restriction used for this run
scoringConfigVersion
codeRevision
ticker
universeSnapshotId
eligible                   boolean
eligibilityReasonCodes[]
score                      0–100
uncappedScore              0–100
rawPoints
maxAvailablePoints
complete
actionable
coverageMask[]             sorted metric ids actually used
missingMetrics[]
criticalMissingMetrics[]
fallbackMethod
thinPeerSet
peerSetId
peerSetLevel
peerCount
specialSectorKey           banks | insurers | reits | null
scoreCause                 initial | filing | market | estimate | ownership |
                           coverage | peer_set | restatement | version | retry
inputSnapshotId
metrics[]                  per-metric observations below
```

**Per-metric fields:**

```text
metricId
value                      finite number | boolean | nonempty string | null
unit                       canonical unit enum below
points                     finite nonnegative number | null
maxPoints
source
sourceDocumentId           nonempty string | null
sourceFiledAt              zoned ISO timestamp | null
sourceAsOf                 zoned ISO timestamp | null
retrievedAt
freshnessState             fresh | stale | unavailable | unsupported |
                           policy_unresolved
peerCount
calculationMethod
thesisCritical             boolean
missingReason              nonempty string | null
```

**Contract rules:**

- Use `AgentIdSchema` and `TICKER_RE` from `contracts/proposal.js`. `mandateId` is exactly `agent_one|agent_two|agent_three`; `specialSectorKey` is `banks|insurers|reits|null`; `scoreCause` is the ADR 0003 enum; `fallbackMethod` is `peer_relative|blended_50_50|absolute|none`; and `peerSetLevel` is `industry|sector|none`.
- Canonical units are `decimal_ratio|percentage_points|basis_points|usd|usd_millions|shares|count|days|multiple|boolean|date|score_points`. Do not accept bare `%`, `percent`, or an unspecified free-form unit.
- `id`, all version/identity fields, source, and calculation method are nonempty strings. `runId`, `universeSnapshotId`, `inputSnapshotId`, and `peerSetId` are opaque identities in this contract; their construction belongs to E1.3/E1.4.
- ISO timestamps must include a time-zone offset. Nullable source timestamps remain null when they do not exist; do not invent a date.
- `score` and `uncappedScore` are finite 0–100 numbers. `rawPoints`, `maxAvailablePoints`, metric `points`, and metric `maxPoints` are finite and nonnegative; `maxAvailablePoints` is at most 100.
- `coverageMask`, `missingMetrics`, `criticalMissingMetrics`, and `eligibilityReasonCodes` are duplicate-free lexicographically sorted arrays. Metric IDs are unique and metrics are sorted by `metricId`.
- A covered metric has finite `points`, a non-null value, and a freshness state other than `unavailable|unsupported`; an uncovered metric has `points=null` and a nonempty `missingReason`. `coverageMask` must exactly equal covered metric IDs and `missingMetrics` must exactly equal uncovered metric IDs.
- Within a two-decimal tolerance, `rawPoints` equals the sum of covered metric points and `maxAvailablePoints` equals the sum of their `maxPoints`. If `maxAvailablePoints>0`, `uncappedScore` equals `rawPoints/maxAvailablePoints*100` within the same tolerance; otherwise both score fields are zero and `fallbackMethod=none`.
- `complete=true` requires `missingMetrics=[]`, `criticalMissingMetrics=[]`, and `maxAvailablePoints=100`; `complete=false` requires at least one missing metric or fewer than 100 available points.
- `scoreCause=coverage|version|retry` is never directly research-actionable.
- `actionable=true` requires `eligible=true`, nonempty coverage, `maxAvailablePoints>=80`, `criticalMissingMetrics=[]`, and every `thesisCritical=true` metric to have `freshnessState=fresh`. `policy_unresolved` therefore fails closed for actionability.
- `criticalMissingMetrics` must exactly equal the missing/unavailable/unsupported/stale/policy-unresolved metric IDs marked `thesisCritical=true`.
- `thinPeerSet=false` requires `fallbackMethod=peer_relative`; `fallbackMethod=blended_50_50|absolute` requires `thinPeerSet=true`.
- `peerCount` and per-metric `peerCount` are nonnegative integers. `peerSetLevel=none` requires `peerSetId` still identify the explicit empty/absolute peer-set definition.
- The schema rejects unknown object keys. Sort arrays before hashing or fingerprinting.

**Update:**

- Export from `contracts/index.js`.
- Add contract documentation to `contracts/README.md`.
- Run `npm run contracts:sync` only after approval, producing `../portfolio-dashboard/lib/contracts/research-observation.js`.
- Add `tests/research-observation-contract.test.js` and dashboard drift coverage.

**Acceptance:** complete, partial, unsupported-sector, coverage-arrival, and version-change fixtures parse as intended; malformed units/timestamps/contradictory completeness fail.

**Forbidden:** importing this observation into proposal sizing, execution, or ledger code.

---

### E1.2 — Additive research-history migration

**Model fit:** standard builder; small executor after exact SQL is reviewed.

**Add:** `db/migrations/0004_research_observations.sql`.

**Tables:**

1. `universe_snapshots`
   - `id TEXT PRIMARY KEY`
   - `observed_at TIMESTAMPTZ NOT NULL`
   - `source_revision TEXT NOT NULL`
   - `catalog_count INTEGER NOT NULL`
   - `eligible_count INTEGER NOT NULL`
   - `membership JSONB NOT NULL`
   - unique content fingerprint.
2. `evidence_snapshots`
   - `id TEXT PRIMARY KEY`
   - `ticker TEXT NOT NULL`
   - `observed_at TIMESTAMPTZ NOT NULL`
   - `payload JSONB NOT NULL`
   - `content_hash TEXT NOT NULL UNIQUE`
   - source/freshness summary columns for querying.
3. `mandate_score_observations`
   - scalar/indexable fields from the canonical contract.
   - `payload JSONB NOT NULL` for complete validated observation.
   - `UNIQUE(run_id, agent_id, ticker)` for idempotent job replay.
   - indexes on `(agent_id, ticker, observed_at DESC)`, `(agent_id, score DESC)`, and `score_cause`.
4. `research_job_runs`
   - run ID, status, start/end, source revision, cohort/scored/complete/skipped/error counts, coverage summary JSON.

Do not modify existing money/accounting tables. Research tables are additive and advisory.

**Update:** `docs/db/schema-draft.sql` only as a human-readable mirror after the migration is finalized.

**Tests:** add `tests/research-migration.test.js` only if the repo’s test environment supports schema parsing/temporary Postgres; otherwise test query builders in E1.3 and use `npm run db:migrate` only in an approved non-production database.

**Acceptance:** migration is transactional and idempotent through the existing runner; no current table or enum is dropped or rewritten.

**Forbidden:** running the migration on production without a separate reviewed deployment gate and backup/rollback plan.

---

### E1.3 — Postgres research-observation writer

**Model fit:** small-to-standard executor.

**Add:** `lib/pg/research-observations.js`.

**Exports:**

- `writeResearchJobStart(run)`.
- `writeUniverseSnapshot(snapshot)`.
- `writeEvidenceSnapshot(snapshot)`.
- `writeMandateScoreObservations(observations, { client })`.
- `finishResearchJobRun(runId, summary)`.
- `failResearchJobRun(runId, errorSummary)`.

**Behavior:**

- Validate every observation with `MandateScoreObservationSchema` before SQL.
- Use one transaction for a job’s universe/evidence/score writes.
- Use `ON CONFLICT (run_id, agent_id, ticker) DO NOTHING` or exact same-content verification. A replay with different content under the same identity must throw.
- Unlike money-path shadow writes, a configured Phase 1 research-record write failure must make the scoring job fail. A job cannot claim success while losing its research output.
- If Postgres is not configured, the off-by-default scoring job may self-report `not_configured`; it may not report `completed`.

**Tests:** inject a fake pool/client; cover transaction commit, rollback, idempotent replay, conflicting replay, validation failure, and absent configuration.

**Acceptance:** no partially successful run is visible as complete; same inputs replay safely; different inputs cannot overwrite history.

---

### E1.4 — Deterministic version and provenance IDs

**Model fit:** small executor.

**Add:** `lib/research-version.js`.

**Exports:**

- `canonicalJson(value)` — stable recursive key ordering.
- `contentHash(value)` — SHA-256 over canonical JSON.
- `mandateMetadataFor(agentId)` and `mandateVersionFor(agentId)` — read explicit approved config, not file mtime.
- `scoringConfigVersion({ semanticVersion, scoringTables })` — returns `${semanticVersion}+sha256:<hash>` from executable scoring data supplied by the caller; default production wiring supplies the exported scoring and absolute-threshold tables, never raw source-file text.
- `peerSetId({ level, key, tickers, asOf })`.
- `observationId(observationIdentity)`.

**Config changes:** add `config/agents/<id>/mandate.json` rather than parsing Markdown headings. The exact values are:

| agent | mandateId | mandateVersion | canonicalSourcePath | targetUniversePolicyVersion | productionUniversePolicyVersion |
|---|---|---|---|---|---|
| agent-1 | agent_one | 3.0 | agent_mandates/Agent_One_Mandate_v3.md | eligible-us-operating-common-equities-v3 | catalog-technology-subverticals-v1 |
| agent-2 | agent_two | 3.0 | agent_mandates/Agent_Two_Mandate_v3.md | eligible-us-operating-common-equities-v3 | static-watchlist-v1 |
| agent-3 | agent_three | 3.0 | agent_mandates/Agent_Three_Mandate_v3.md | eligible-us-operating-common-equities-v3 | static-watchlist-v1 |

Each object has exactly those five fields plus `agentId`; no description or current timestamp enters the object.

**Identity rules:**

- `canonicalJson` sorts object keys recursively but preserves array order. It rejects `undefined`, functions, symbols, non-finite numbers, cycles, and non-plain objects instead of silently normalizing them.
- `contentHash` returns lowercase 64-character hex SHA-256.
- The initial scoring semantic label is `mandate-v3-scoring-1`. Its content input is a plain object containing the executable `AGENT_SCORING`, `ABSOLUTE_RULE_TABLES`, `SPECIAL_SECTOR_RULE_TABLES`, and `ABSOLUTE_VALUATION_TABLES` exports. File paths, mtimes, Git state, and comments are excluded.
- `peerSetId` hashes `{ level, key, tickers, asOf }`; tickers are normalized uppercase, deduplicated, and lexicographically sorted. `asOf` is intentionally part of this point-in-time identity and must be a zoned ISO timestamp.
- `observationId` hashes exactly `{ runId, agentId, ticker }` after ticker normalization. A replay with different content under this identity is a conflict handled by E1.3, not a new observation ID.

**Tests:** object key-order invariance, array-order preservation, rejected unsupported values, changed config changes hash, timestamps/mtimes/Git metadata do not enter stable config hashes, peer ticker-order invariance, distinct peer membership or `asOf` changes peer ID, and observation ticker normalization.

**Acceptance:** the same logical inputs produce the same hash on Mac and Jetson; changed semantics cannot retain the old version.

**Forbidden:** using current Git branch name as the only semantic version.

---

### E1.5 — Sequential research-data workflow

**Model fit:** standard builder.

**Add:** `jobs/research-data-refresh.js`.

**Flow:**

```text
withWorkflowLock("research-data-refresh", ttl >= worst observed duration)
  → runUniverseRefresh()
  → runPeerDistributions()
  → runMandateScoring()
  → persist final run status
```

**Update:**

- `scheduler.js`: replace independent 7:30/7:50/7:52 cron entries with one 7:30 entry calling the orchestrator.
- `package.json`: add `research:data-refresh` for manual non-production verification.
- Keep individual `peer:dist` and `mandate:score` scripts for diagnosis.
- Update the scheduler startup summary string.
- Add status helpers in `lib/redis.js` only if E1.6 has not yet provided them.

**Failure behavior:**

- Universe failure stops downstream work and reports failed.
- Peer-distribution failure stops scoring; do not score against a silently stale cohort unless a future explicit degraded-mode policy is approved.
- Scoring failure alerts once and reports failed.
- An overlapping run exits as skipped/locked, not successful.

**Tests:** add `tests/research-data-refresh.test.js` with injected steps to prove order, early abort, lock handling, and final status.

**Acceptance:** no code or comment claims clock spacing guarantees completion; one run ID binds every stage.

---

### E1.6 — Research-data health surface

**Model fit:** small executor.

**Backend changes:**

- `lib/redis.js`: add `setResearchDataStatus` / `getResearchDataStatus` under `pm:research-data:status` with a bounded TTL.
- `jobs/research-data-refresh.js`: publish counts and timestamps only.
- `server.js`: add `researchData` to `/health` with:
  - state, runId, startedAt, completedAt;
  - cataloged, classified, metricRows, scored, complete, partial, unsupported;
  - oldest/newest input dates and failure stage.
- `lib/sysloop/checks.js`: pure check for missing/stale/failed runs once the job is enabled.
- `lib/sysloop/snapshot.js`: carry the new health object into checks.
- `tests/sysloop.test.js`: disabled/not-yet-enabled, healthy, stale, failed, and implausible-count fixtures.

**Dashboard follow-up:** extend the existing funnel page rather than creating a new page:

- `../portfolio-dashboard/lib/backend.ts` or the existing health type owner.
- `../portfolio-dashboard/app/funnel/page.tsx`.
- Relevant API/fixture tests.

**Privacy:** unauthenticated `/health` exposes counts and timestamps, never ticker lists, evidence, rationales, investor data, or dollar holdings.

---

## 6. Phase 2 packets — coverage and mandate adapters

### E2.1 — Coverage accounting

**Model fit:** small executor.

**Add:** `lib/score-coverage.js` with pure functions:

- `summarizeMetricCoverage(rows, metricIds)`.
- `freshnessHistogram(rows, now)`.
- `unsupportedReasonCounts(rows)`.
- `coverageGate(summary, policy)`.

**Update:** `jobs/mandate-scoring.js` to include coverage summary in the run record/status, without changing selection or proposal behavior.

**Tests:** missing metrics, stale metrics, unsupported sector, zero cohort, partial cohort, and complete cohort.

**Rule:** “90% has a fresh score or explicit stable reason” is not equivalent to 90% complete scores; report both.

---

### E2.2 — Special-sector classifier

**Model fit:** small executor only after the taxonomy mapping is reviewed.

**Add:** `lib/special-sector.js`.

**Export:** `specialSectorKeyFor({ sector, industry, quoteType, metadata })` returning only `banks`, `insurers`, `reits`, or `null` plus a reason/provenance object.

**Update:** `jobs/mandate-scoring.js` to replace its current null seam. Do not change `lib/mandate-evidence.js` bindings until special-sector evidence exists.

**Tests:** representative Yahoo taxonomy fixtures, ambiguous financial companies, non-special financials, REITs, mortgage REIT ambiguity, and unknown classification.

**Fail-closed rule:** an ambiguous likely-special-sector name is unsupported, not standard-scored.

**Primary-reviewer decision required:** exact Yahoo sector/industry mapping and treatment of diversified financials/mortgage REITs.

---

### E2.3 — Agent 1 remaining evidence bindings

**Model fit:** standard builder after mandate-author definitions are written.

**Potential files:**

- `lib/edgar-metrics.js` for genuinely derivable net cash, EBITDA, profitability, leverage history.
- `lib/mandate-evidence.js` for named Agent 1 evidence objects.
- `config/scoring/absolute-thresholds.js` only if the approved mandate changes.
- `tests/edgar.test.js`, `tests/mandate-evidence.test.js`, `tests/absolute-rules.test.js`.

**Do not begin until:** the mandate author defines profitable/pre-profit classification, net-cash calculation, EBITDA concept/fallback policy, zero-debt handling, and missing/negative EBITDA treatment.

**Forbidden:** mapping interest coverage into net-debt/EBITDA or inferring profitability from a field with different economics.

---

### E2.4 — Agent 2 and Agent 3 adapters

**Model fit:** standard builder; small executors may implement individual pure derivations from frozen fixtures.

**Agent 2 required histories:** multi-quarter revenue-beat consistency, YoY growth persistence, at least two-quarter EPS trajectory, 60-day estimate revisions with breadth/no-reversal, and mandate-defined dead-money inputs.

**Agent 3 required histories:** three-year revenue CAGR plus annual history, normalized three-year EPS CAGR, three-year margins, leverage/coverage history, valuation history, and re-underwrite dates.

**Files:**

- Extend `lib/edgar-facts.js` and `lib/edgar-metrics.js` for time series.
- Split `lib/mandate-evidence.js` into agent adapters only if it becomes unwieldy, e.g. `lib/mandate-evidence/agent-1.js`; avoid premature file churn.
- Update `jobs/mandate-scoring.js` `SCORED_AGENTS` only after each adapter passes full fixture coverage.
- Add agent-specific tests with known periods and missing-history cases.

**Gate:** an adapter may enter score history before it may influence the AI slate. Historical collection is advisory; proposal actionability remains Phase 5-gated.

---

### Frozen decisions and remaining Phase 2 inputs

The Decision Register and ADR 0003 now freeze two architecture-level choices:

1. v3 is the canonical target mandate family.
2. Agent 1's target architecture is sector-agnostic, while the current production technology-subvertical restriction remains in force until the Phase 2 gate. Agents 2/3 remain supervised and watchlist-bound in production.

The following investment-policy inputs remain open and must be supplied before the affected packets begin:

1. Exact balance-sheet definitions and source hierarchy (Q-001).
2. Estimate freshness and actionability rules (Q-002).
3. Entry-quote freshness rules (Q-003).
4. Whether consensus estimates and 13F are required for a complete score or temporarily optional with the accepted 80-point availability floor (Q-004).
5. Materiality thresholds for live research events (Q-005).
6. Approved benchmark per agent and eligible-security exceptions, if the current mandate text is insufficiently exact.

No executor model should infer an open investment-policy rule from prose fragments across multiple files.

---

## 7. Phase 3 packets — make score changes meaningful

### E3.1 — Score-delta cause classifier

**Model fit:** small executor after the input contract is frozen.

**Add:** `lib/score-delta.js`.

**Input:** previous and current validated `MandateScoreObservation`.

**Output:**

```text
delta
material
primaryCause
allCauses[]
researchEligible
reasonCodes[]
changedMetrics[]
coverageChanged
peerSetChanged
versionChanged
```

**Rules:**

- No prior observation → `initial`, not event-eligible by default.
- Config/mandate/code version change → `version`, never directly event-eligible.
- Added/removed metric coverage → `coverage`; may be recorded but not treated as business change.
- Same evidence with different peer membership → `peer_set`.
- New filing/as-of date with changed fundamental input → `filing`.
- Only valuation/price-derived input changed → `market`.
- Retry with identical content → `retry`, delta zero.
- Multiple causes remain visible; priority order is explicit and tested.

**Tests:** a fixture for every cause plus multi-cause and timestamp-only changes.

**Forbidden:** choosing materiality thresholds. The primary reviewer supplies them in versioned config.

---

### E3.2 — Research-event ledger

**Model fit:** standard builder.

**Add migration:** `db/migrations/0005_research_events.sql`.

**Tables:**

- `research_events`: observation IDs, ticker/agent, cause, delta, materiality policy version, research eligibility, reason codes, created time.
- `research_selection_runs`: selection policy/version, candidate pool counts, selected/displaced payloads, mode (`shadow|canary|live`), timestamps.
- `research_selection_items`: run, ticker, agent, selected boolean, rank, bucket, reason, compared/displaced ticker.

**Add:** `lib/pg/research-events.js` with validated append-only writers.

**Update:** scoring workflow to create events after observations commit. Event-write failure marks the stage failed; it never creates proposals.

**Acceptance:** every selected event points to immutable previous/current observations and a policy version.

---

### E3.3 — Shadow-slate comparator

**Model fit:** small executor for pure comparator; standard builder for job wiring.

**Add:**

- `lib/shadow-slate.js`: compare current rotation slate with proposed event slate; calculate overlap, displaced names, novelty, sector/cap concentration, evidence age, and turnover.
- `jobs/shadow-research-slate.js`: read-only selection job; writes only research-selection records and status.
- `tests/shadow-slate.test.js`.

**Inputs:** current candidate pool, validated research events, holdings, movers, exploration quota, research ledger, and frozen selection policy.

**Rule:** holdings are always included and never counted as a win for either non-holding selection policy.

**Forbidden:** calling Anthropic, creating proposals, or changing `lib/candidate-slate.js` during shadow evaluation.

---

### Frozen methodology — historical validation

`docs/BACKTEST-METHODOLOGY-v1.md` freezes the point-in-time, delisting, corporate-action, execution-timing, horizon, walk-forward, reproducibility, and promotion rules. Q-007 remains open only for the final base and stressed transaction-cost parameters. Executors must implement that document rather than invent or tune methodology.

A standard builder may create:

- `backtest/README.md` — frozen methodology.
- `backtest/loaders/*.js` — point-in-time inputs.
- `backtest/run-mandate-backtest.js` — deterministic replay.
- `backtest/metrics.js` — pure return/drawdown/turnover/calibration math.
- `tests/backtest-*.test.js` — synthetic fixtures proving no future filing is visible.

The executor reports results; it does not tune thresholds on the test set or declare edge.

---

## 8. Phase 4 packets — evidence-driven AI attention

### E4.1 — Pure evidence-slate selector

**Model fit:** small executor after policy is frozen.

**Add:** `lib/evidence-slate.js` rather than mutating the current selector immediately.

**Priority contract:**

1. Holdings and mandatory re-underwrites.
2. Material thesis-breaking events.
3. Validated economic score changes.
4. High stable scores outside cooldown.
5. Fixed exploration allocation.

**Output per selected item:** ticker, agent, bucket, rank, reason codes, triggering observation/event, displaced candidate, and whether budget-exempt.

**Tests:** holdings exceed nominal budget, duplicate ticker across buckets, stale event, coverage-only event, concentration cap, exploration preservation, deterministic tie break, and empty event pool.

**Forbidden:** any BUY/SELL action or confidence value in the selector output.

---

### E4.2 — Shadow and canary integration

**Model fit:** standard builder.

**Config:** add reviewed `config/research-selection.json`:

```json
{
  "mode": "shadow",
  "policyVersion": "research-selection-v1",
  "canarySlots": 0,
  "explorationSlots": 3,
  "maxSectorShare": 0.4
}
```

**Update:**

- `jobs/shadow-research-slate.js` uses the selector in shadow.
- `jobs/research-scan.js` reads no evidence slate while mode is `shadow`.
- Canary mode may replace only `canarySlots` non-holding ranked slots; holdings/movers and safety gates remain unchanged.
- Persist selected and displaced candidates through E3.2.
- `server.js` and dashboard funnel show mode, policy version, overlap, and selection reasons.

**Acceptance:** setting mode back to `shadow` restores the old live slate without data migration or code rollback.

**Promotion to `live`:** primary reviewer only after the roadmap’s 20-day gate. A small executor never changes this value in production.

---

## 9. Phase 5 packets — one proposal lineage

This phase is money-adjacent and cross-repo. Do not assign the whole phase to a small model.

### Frozen lineage architecture

ADR 0004 selects an immutable, separately stored `StrategyProposal`. A live allocation proposal references `strategyProposalId` and `strategyProposalFingerprint`; signature v2 binds that fingerprint. Legacy signature-v1 records remain readable, but writers must not convert them in place. Manual proposals receive a minimal `ResearchIntent`, `EvidenceSnapshot`, and `StrategyProposal` so they use the same lineage path.

Before implementation:

- List outstanding `ApprovedForBrokerReview` proposals.
- Fulfill, reject, or explicitly expire outstanding v1 approvals before v2-only enforcement; do not migrate their signatures in place.
- Follow ADR 0004's backward-compatibility and migration sequence.
- Add the exact byte-level signature-v2 payload to the ADR before changing `contracts/signature.js`; if any ambiguity remains, stop rather than choosing a serialization.

### E5.1 — Lineage contracts and migration

**Model fit:** standard builder; primary and independent review required.

**Canonical files:**

- `contracts/pipeline.js` — extend `ResearchIntentSchema`; add `EvidenceSnapshotSchema`, evaluator lineage, mandate reference, and immutable strategy-proposal ID/fingerprint.
- `contracts/proposal.js` — add only the approved reference/fingerprint fields needed by the live allocation proposal.
- `contracts/signature.js` — change only if the ADR requires it.
- `contracts/index.js`, `contracts/README.md`, then `npm run contracts:sync`.
- `db/migrations/0006_proposal_lineage.sql` — additive tables/columns and indexes.

**Mirrors/consumers:**

- `lib/redis.js`.
- `lib/pg/dual-write.js` and `lib/pg/inventory.js`.
- `../portfolio-dashboard/lib/proposals.ts`.
- `../portfolio-dashboard/scripts/mac-companion.mjs`.
- Dashboard proposal APIs and tests.
- `lib/proposal-signature.js` and `lib/mcp-accounting.js` if signature/fill validation changes.

**Required tests:** contract drift, proposal shape, old-row normalization, new-lineage validation, signature round trip, forged lineage, approved-proposal immutability, executor parsing, and fill reconciliation.

### E5.2 — Canonical proposal compiler

**Add:** `lib/proposal-compiler.js`.

**Input:** validated `ResearchIntent`, `EvidenceSnapshot`, mandate reference, evaluated recommendation, sizing context, and owned-lot state.

**Output:** immutable `StrategyProposal` plus the legacy/live allocation proposal reference required by the approved architecture.

**Rules:**

- One compiler for scheduled scan, Lab, alerts, exits, and manual requests.
- SELL requires cited owner-strategy lots before proposal creation.
- Missing evidence, mandate version, evaluator result, kill criteria, or expiry fails closed.
- Compiler does not approve, sign, execute, or write ledgers.
- Sizing remains deterministic and downstream of evaluator/risk gates.

**Tests:** one fixture per intent source; identical inputs are idempotent; mutated evidence/mandate changes fingerprint; unowned SELL fails; missing lineage fails.

### E5.3 — Route every entry point

**Model fit:** standard builder, one source per packet.

Route separately and review after each:

1. Scheduled discovery in `jobs/research-scan.js`.
2. Lab path in `researchTickerForAgent` inside the same file.
3. Price alerts through the existing canonical research path.
4. Exit signals in `jobs/monitor-positions.js`.
5. Manual dashboard proposals/API.

After each route, search for direct `createProposal(` calls. At phase completion, only the compiler/persistence boundary may call the low-level writer.

### E5.4 — Agents 2/3 catalog activation

Only after E2 adapters, E4 evidence selection, and E5 compiler are live in supervised mode:

- Add mandate-specific screen functions to a pure module; do not reuse Agent 1’s tech screen.
- Update `config/agents/agent-2/universe.json` and `agent-3/universe.json` from `watchlist` to `catalog` in separate commits.
- Canary research sourcing before permitting catalog-sourced proposals.
- Dashboard must show mandate version, evidence time, selection reason, evaluator verdict, and owned SELL lots.

---

## 10. Phase 6 packets — idle-cash challenger

### Policy decision first

Sam/primary reviewer defines:

- Cash threshold and minimum idle duration.
- Whether thresholds use total cash, deployable cash, or strategy budgets.
- Regime exceptions.
- Minimum score/completeness/freshness for challenger candidates.
- Alert cooldown and number of alternatives.
- Counterfactual evaluation horizon.

### E6.1 — Pure cash-challenge decision

**Model fit:** small executor after policy freezes.

**Add:** `lib/cash-challenger.js`.

**Input:** policy, portfolio/cash snapshot, current regime, eligible alternatives, open proposals, job-health state, and last alert.

**Output:**

```text
triggered
reasonCodes[]
blockedByOperationalDegradation
cashState
challengers[]
nextEligibleAlertAt
```

**Rules:** operational degradation blocks the investment challenge and produces a distinct ops reason; no output contains an action upgrade or proposal.

### E6.2 — Challenger job and counterfactual record

**Add:**

- `jobs/cash-challenger.js`.
- `db/migrations/0007_cash_challenges.sql`.
- `lib/pg/cash-challenges.js`.
- Tests for alert cooldown, duplicate suppression, operational failure, no candidates, and future counterfactual maturation.

**Update:** scheduler only after shadow verification; Telegram says “advisory challenge,” never “buy required.”

**Forbidden:** calling `createProposal`, changing risk limits, or modifying recommendations.

---

## 11. Phase 7 packets — measurement without self-deception

### E7.1 — Forward-return and benchmark observations

**Model fit:** small executor for pure math; standard builder for persistence.

Reuse the cadence and market-data patterns in `jobs/performance-review.js` and `lib/weekly-scorecard.js`; do not create conflicting return definitions.

**Add:**

- `lib/research-outcomes.js`: excess return, max adverse/favorable excursion, hit definitions, and maturation status from frozen horizon/benchmark policy.
- `db/migrations/0006_research_outcomes.sql`.
- `jobs/research-outcomes.js` or extend `jobs/performance-review.js` only after deciding ownership of the cadence.

**Rule:** record missing prices/benchmarks as unavailable, never zero return.

### E7.2 — Attention-policy counterfactuals

**Add:** pure `lib/selection-counterfactuals.js` comparing selected vs displaced names from E3/E4 records.

Measure:

- Event slate vs current rotation.
- Top-score vs exploration.
- AI recommendation vs deterministic finalist.
- Evaluator accepted/rejected/revised outcomes.

Do not compare horizons before they mature. Do not mix mandate versions without labeling.

### E7.3 — Reproducible research report

**Model fit:** standard builder; primary reviewer writes conclusions.

**Add:** `scripts/research-evidence-report.mjs` producing machine-readable JSON and Markdown from stored observations/outcomes.

Report sections:

- Data coverage/freshness and excluded samples.
- Backtest vs shadow vs paper vs realized-live labels.
- Return/drawdown/turnover after declared costs.
- Results by agent, mandate version, score band, delta cause, regime, and completeness.
- Confidence intervals/sample counts.
- Sensitivity to slippage and threshold assumptions.
- Negative/null results with equal prominence.

The executor generates the report. Only the primary reviewer may claim an edge or recommend promotion.

### E7.4 — Outcome maturation cadence

**Model fit:** standard builder; primary reviewer freezes operational ownership and policy inputs before scheduling.

**Goal:** turn stored observation/selection lineage into immutable immature, matured, unavailable, or excluded outcome snapshots without creating a second performance definition or silently inventing prices, benchmarks, horizons, hits, or costs.

**Before implementation:** decide whether `jobs/performance-review.js` owns this cadence or delegates to one bounded research-outcome module. Reuse its market-data and trading-session semantics where compatible; do not add a competing cron until ownership is explicit.

**Required behavior:**

- Read eligible observations and selection pairs from Postgres using durable lineage.
- Resolve only versioned horizon, benchmark, hit, and—after Q-007—cost policies.
- Write an immature snapshot when the horizon has not elapsed; later maturation appends a new deterministic snapshot rather than updating history.
- Record missing prices, benchmarks, or corporate-action-safe inputs as unavailable, never as zero return.
- Keep mandate, scoring, selection, benchmark, horizon, hit, cost, and evidence-class versions separated.
- Remain advisory and off the proposal, approval, ledger, broker, and live-selection paths.

**Tests:** ownership/cadence seam, same-input replay, immature-to-mature append, missing-price/benchmark handling, market-session boundaries, policy-version separation, and a no-write/not-configured case.

**Gate:** no schedule, production migration, or historical backfill until the primary reviewer accepts job ownership, data-source semantics, resource budget, rollback, and deployment plan. No net result may be emitted before Q-007 is accepted.

---

## 12. Cross-cutting verification matrix

| Change type | Required verification |
|---|---|
| Pure backend module | Focused tests + full `npm test` |
| Backend contract | Contract tests + `npm run contracts:sync` + dashboard drift tests |
| Postgres migration | Migration review, non-prod apply, idempotent rerun, rollback/failure proof |
| Scheduler | Order/lock tests, startup summary, market-day behavior, manual dry run |
| Health/sysloop | Backend tests, safe unauthenticated payload review, stale/failed fixtures |
| Dashboard | `npm test`, `npm run lint`, `npm run build` when UI/route changes |
| Proposal lineage | Backend + dashboard + companion tests, signature review, outstanding-approval plan |
| Research selection | Shadow evidence before canary; canary before live; rollback proof |
| Production rollout | Jetson commit proof, env presence only, tests, restart, `/health`, fresh logs |

Before any GitHub push, scan staged files for `.env`, credential JSON, OAuth tokens, broker data, recovery codes, and private messages.

---

## 13. Suggested executor packet prompt

The primary reviewer can hand a small model this template:

```text
Work only on packet E0.1 from docs/roadmaps/RESEARCH-ROADMAP-EXECUTION-GUIDE.md.

Repo: /Users/samhuffard/All Claude Projects/portfolio-manager

Read CLAUDE.md, .claude/napkin.md, the packet, docs/CHANGE_MAP.md, and all target files/tests before editing. Preserve the existing dirty worktree. Do not deploy, change env vars, commit unrelated files, or broaden scope.

Implement exactly the packet’s file changes and tests. Missing/ambiguous state must fail closed. Run the listed verification commands. Search for stale duplicate predicates afterward.

Return the required completion report. If a stop condition occurs, stop without guessing and identify the exact decision needed.
```

For a standard builder, replace `E0.1` with the selected packet and include any frozen contract, policy, or migration decision directly in the prompt.

---

## 14. Work the primary reviewer should retain

Do not delegate these decisions to a smaller executor:

- Any future change to the accepted sector-agnostic target/current production scope split.
- Promotion of a mandate or scoring version beyond the accepted v3 target.
- Metric source hierarchy, unit conventions, freshness, and completeness rules.
- Score-change materiality thresholds.
- Any amendment to the frozen backtest methodology or promotion criteria.
- Any expansion beyond the accepted Agent 2/3 supervised/watchlist-bound authority policy.
- Any amendment to ADR 0004's proposal-lineage and signature architecture.
- Cash-pressure thresholds and regime exceptions.
- Shadow→canary→live promotion and rollback decisions.
- Any production migration, environment change, restart, or deployment.
- Any claim that the system has demonstrated investment edge.

The executor’s job is to make approved rules exact, tested, observable, and difficult to bypass. The primary reviewer’s job is to ensure those rules still serve the product’s larger objective: truth, attention, learning, and control.

---

*Internal execution document. Update packet status only from verified repository/runtime evidence; code existing locally is not the same as a completed or deployed packet.*
