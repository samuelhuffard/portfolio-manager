# Portfolio Manager — Observation-Period Offline Execution Plan

**Status:** ready for execution planning; production authorization explicitly absent  
**Date:** 2026-07-16 ET  
**Canonical parent:** `docs/portfolio-master-plan.md`  
**Packet authority:** `docs/RESEARCH-ROADMAP-EXECUTION-GUIDE.md` O0–O6  
**Target:** productive engineering during the Phase 0 TRUST observation without changing the release being observed

## 1. Outcome

Complete a reviewed, committed, non-production body of work that:

1. separates completion of the 10-day Phase 0-TRUST window from the first R1
   proposal-throughput cohort without weakening either gate;
2. replaces informal proposal-quality confidence numbers with a predeclared
   measurement contract;
3. adds deterministic offline coverage for the proposal path and the failure modes
   identified in Claude's review;
4. defines equal candidate discovery with mandate-specific ranking;
5. defines a versioned, point-in-time Athena evidence package and frozen golden-set
   methodology; and
6. leaves a clean review candidate that cannot affect production until a separate
   post-observation release decision.

This phase is complete when the artifacts and local tests exist, all plan checks pass,
and an independent reviewer confirms that no live schedule, production flag, authority,
proposal, money path, or observer semantics changed.

## 2. Non-negotiable production boundary

Every executor and reviewer must follow these rules.

- Work from an isolated branch/worktree created from the exact observed production
  revision recorded at execution start.
- Do not merge into or deploy `mandate-v3` or `main` during Phase 0.
- Do not restart the Jetson, Mac companion, Vercel dashboard, scheduler, or PM2.
- Do not change production environment variables, secrets, feature flags, cron jobs,
  migrations, Redis, Sheets, Postgres, broker state, proposals, approvals, or ledgers.
- Do not run paid Anthropic/Athena/vendor experiments. Tests must use deterministic
  fixtures, injected fakes, or authorized immutable local inputs.
- Do not count synthetic/local results as TRUST days, SKILL samples, shadow/canary
  days, evaluator approvals, investment outcomes, or evidence of edge.
- Do not lower a mandate, scoring, conviction, freshness, evaluator, or risk threshold.
- Do not create a forced/manual/legacy proposal to make a test or gate pass.
- If execution uncovers a real S1/S2 production defect, stop the affected packet and
  report it. Repair requires a separate emergency-release decision.

## 3. Pre-flight and workspace creation

**Owner:** primary reviewer; do not delegate this step to a small executor.

### Read first

- `AGENTS.md`
- `.claude/napkin.md`
- `docs/portfolio-master-plan.md`
- `docs/RESEARCH-ROADMAP-EXECUTION-GUIDE.md`
- `docs/CHANGE_MAP.md`
- `docs/INVARIANTS.md`
- `docs/PHASE-0-OBSERVATION.md`

### Actions

1. Record the exact branch, commit, deployment timestamp, and active Phase 0 policy
   versions from sanitized evidence. Never print environment values.
2. Inventory the current dirty checkout. Treat every existing modification and
   untracked file as user work; do not stage or move it into an executor commit.
3. Create a separate worktree and branch named for offline observation work. The base
   must be the exact production revision, not an arbitrary local documentation head.
4. Transfer only the approved planning artifacts into that worktree, or make them
   available as read-only references. Do not copy `.env` or credential files.
5. Run the baseline test suite before implementation and record the exact count.
6. Confirm the worktree has no deployment automation tied to its branch. A remote
   backup branch is optional only after confirming that pushing it cannot deploy.

### Pre-flight acceptance criteria

- `git status --short --branch` in the executor worktree contains no inherited user
  changes before packet work begins.
- `git rev-parse HEAD` equals the recorded observed production revision.
- `npm test` exits 0 before implementation.
- No `.env`, credential, token, recovery-code, or private raw-message file is staged.
- The branch is neither `main` nor `mandate-v3`.

### Abort conditions

- The production revision cannot be established unambiguously.
- The baseline suite fails.
- The branch is connected to deployment automation.
- The only way to proceed would require copying secrets or production data.

## 4. Wave and dependency map

| Wave | Packet | Suggested executor | Depends on | Parallel-safe with |
|---|---|---|---|---|
| 0 | Pre-flight/worktree | Primary reviewer | None | None |
| 1 | O0 gate reconciliation | Strong documentation model | Wave 0 | O1 |
| 1 | O1 measurement specification | Research/evaluation model | Wave 0 | O0 |
| 2A | O2A pure diagnostic classifications | Small coding model | O1 | O3, O4A |
| 2A | O3 candidate-bus contract | Small/standard coding model | O0 | O2A, O4A |
| 2A | O4A Athena package contract | Standard coding model | O0 | O2A, O3 |
| 2B | O2B full positive-path contract test | Strong builder | O1, O2A | O4B source packets |
| 2B | O4B golden-set source packets | Research models, disjoint cohorts | O1, O4A | O2B |
| 3 | O5 offline comparator | Standard coding model | O1, O3, O4A; O4B optional | None |
| 4 | O6 integration and independent review | Primary + independent reviewer | O0–O5 | None |

No model may work on overlapping files concurrently. If an executor discovers an
overlap not listed here, it stops and asks the primary reviewer to reassign ownership.

## 5. Packet O0 — Reconcile TRUST and R1 gates

**Type:** documentation-only  
**Clock effect while undeployed:** none  
**Recommended model:** strong documentation/reasoning model  
**Commit:** `docs: split phase0 trust and research throughput gates`

### Owned files

- `docs/portfolio-master-plan.md`
- `docs/AUTONOMY-ROADMAP.md`
- `docs/ROADMAP-FORMIDABLE-FUND.md`
- `docs/PHASE-0-OBSERVATION.md`
- `docs/notion-import/Home.md`
- `docs/notion-import/Roadmap.csv`

Do not edit observer code, scheduler code, tests, runtime configuration, or any file
outside this list without returning to the primary reviewer.

### Read first

- Every owned file
- `docs/PROPOSAL-QUALITY-FINDINGS.md`
- `docs/RESEARCH-DECISION-REGISTER.md`
- `docs/PHASE-0-OBSERVER.md`
- `docs/RESEARCH-ROADMAP-EXECUTION-GUIDE.md` section 3.1

### Tasks

#### O0.1 Define the two completions

Update the canonical wording so that:

- `Phase 0-TRUST complete` means 10/10 consecutive clean trading days plus zero
  unresolved critical incidents, with the current money/control/monitoring evidence;
- the organic throughput requirement remains at least three genuine actionable
  specialist proposals and one evaluator approval under a declared current-version
  R1 cohort;
- research throughput blocks positive research canaries and later authority
  promotion, but does not prevent Phase 1 policy work or inert Phase 2 shadow plumbing;
- a material R1 change opens a new SKILL cohort without resetting already-clean TRUST
  days unless the release also changes S1/S2 behavior; and
- forced legacy/manual proposals never satisfy organic throughput.

#### O0.2 Preserve fail-closed TRUST meaning

State explicitly that the split does not weaken companion availability, MCP receipts,
critical schedules, holding monitoring, parity, signed ledgers, reconciliation,
deployment identity, observer integrity, or the rule that S1/S2 changes reset TRUST.

#### O0.3 Reconcile subordinate and imported summaries

Remove or annotate every statement that still claims the three-proposal/one-approval
gate is required to declare the 10-day TRUST window itself complete. Preserve old
observation records as historical; never rewrite a signed daily verdict.

### Verification

- `rg -n "three genuine actionable|3 genuine actionable|one evaluator approval|Phase 0-TRUST|throughput" docs/portfolio-master-plan.md docs/AUTONOMY-ROADMAP.md docs/ROADMAP-FORMIDABLE-FUND.md docs/PHASE-0-OBSERVATION.md docs/notion-import`
- `git diff --check`
- Manual cross-document table showing the same TRUST exit, R1 gate, and reset effect
  in every owned file.

### Acceptance criteria

- All owned documents distinguish the TRUST window from the R1 throughput cohort.
- No document says throughput was removed, waived, passed, or replaced by synthetic
  testing.
- No observer pass/fail behavior is changed.
- No historical signed result is edited retroactively.
- `git diff --name-only` for this commit lists only the owned documentation files.

## 6. Packet O1 — Proposal-quality measurement specification

**Type:** documentation/evaluation design  
**Clock effect while undeployed:** none  
**Recommended model:** research/evaluation model  
**Commit:** `docs: preregister proposal quality measurement`

### Owned files

- Add `docs/PROPOSAL-QUALITY-MEASUREMENT-SPEC.md`
- Update `docs/PROPOSAL-QUALITY-FINDINGS.md`
- Update `docs/SESSION-LOG-2026-07-15-FINISH-READINESS.md` only to label 78/90/60
  as dated priors, not measurements
- Update `docs/RESEARCH-DECISION-REGISTER.md` only if a new open measurement decision
  must be recorded; do not silently answer Q-001–Q-007

### Read first

- Every owned file
- `docs/BACKTEST-METHODOLOGY-v1.md`
- `docs/portfolio-master-plan.md` sections 5, 6, and Phase 6
- `lib/research-run-report.js`
- `lib/research-evidence-report.js`
- `tests/research-run-report.test.js`
- `tests/research-evidence-report.test.js`

### Tasks

#### O1.1 Replace confidence claims with declared priors

The new specification must identify 78%, 90%, and 60% as subjective engineering
priors from the July 15 review. It must prohibit presenting them as measured
precision, pass rates, or current production performance.

#### O1.2 Define a qualifying setup

Define a qualifying setup using explicit fields:

- organic versus forced/manual/legacy origin;
- agent, mandate version, evaluator policy/model version, scoring version, candidate
  policy version, evidence snapshot identity, and observation/run ID;
- point-in-time freshness and completeness status;
- provider, budget, parsing, queue, duplicate, ownership, or stale-data degradation;
- generator action, evaluator disposition, Sam's decision, proposal creation status,
  and later outcome maturity; and
- explicit exclusion reason when the setup is not comparable.

Do not define investment thresholds that belong to Q-001–Q-007.

#### O1.3 Define hypotheses and denominators

Predeclare separate measurements for:

- qualifying setup → generator non-HOLD;
- generator non-HOLD → evaluator approve/revise/reject/error;
- first-pass versus post-revision approval;
- evaluator contradiction and suspect-evidence frequency;
- evaluator-approved → Sam-approved/rejected/expired;
- organic proposal → matured gross/benchmark-relative/net result when policies exist;
- abstention, stale data, budget exhaustion, parser degradation, and operational
  failures as separate denominators; and
- Agent 1, Agent 2, and Agent 3 as separate mandate cohorts.

#### O1.4 Define decision rules without inventing results

Specify minimum samples, uncertainty reporting, version breaks, negative/null result
prominence, and what evidence would justify keeping, revising, or rejecting a future
R1 change. Net or alpha claims remain unavailable before Q-007 and mature samples.

### Verification

- `rg -n "78%|90%|60%" docs/PROPOSAL-QUALITY-FINDINGS.md docs/PROPOSAL-QUALITY-MEASUREMENT-SPEC.md docs/SESSION-LOG-2026-07-15-FINISH-READINESS.md`
- `rg -n "qualifying setup|organic|version|denominator|excluded|unavailable|Q-007" docs/PROPOSAL-QUALITY-MEASUREMENT-SPEC.md`
- `git diff --check`

### Acceptance criteria

- Every percentage is labeled `prior`, `target`, or actual measured value with a
  source; none is left ambiguous.
- The spec makes forced/manual/legacy proposals ineligible for organic throughput.
- Infrastructure and stale-data outcomes cannot be counted as investment HOLDs.
- Version changes open separate cohorts.
- The spec contains no fabricated observation, outcome, precision, or edge claim.

## 7. Packet O2A — Pure diagnostic classifications

**Type:** test-first, pure R1 mechanics  
**Clock effect while undeployed:** none  
**Recommended model:** small coding model  
**Commit:** `test: add research diagnostic classifications`

### Owned files

- `lib/evaluator-admission.js` (new)
- `lib/research-cohort-eligibility.js` (new)
- `tests/evaluator-admission.test.js` (new)
- `tests/research-cohort-eligibility.test.js` (new)
- `lib/research-run-report.js`
- `tests/research-run-report.test.js`

Do not edit `jobs/research-scan.js`, `scheduler.js`, `lib/redis.js`, proposal storage,
budget code, evaluator prompts, or production configuration in this packet.

### Read first

- Every owned existing file
- `lib/evaluator.js`
- `tests/evaluator.test.js`
- `jobs/research-scan.js` evaluator and outcome-classification sections
- `docs/PROPOSAL-QUALITY-MEASUREMENT-SPEC.md`
- `docs/CHANGE_MAP.md` research logic section

### Tasks

#### O2A.1 Test evaluator contradiction admission

Add a pure function with a concrete return contract:

`classifyEvaluatorAdmission({ verdict, numericSpotCheck, suspectEvidence })`

It returns `{ admitted, reasonCodes }`. `admitted` is true only when verdict is
`APPROVE`, `numericSpotCheck` is `pass`, and `suspectEvidence` is an empty array.
Unknown/missing values fail closed. Required reason codes are deterministic and
allowlisted: `verdict_not_approve`, `numeric_spot_check_failed`,
`suspect_evidence_present`, and `invalid_evaluator_result`.

This function is not wired into the live queue in this packet.

#### O2A.2 Add generator degradation as a distinct outcome

Extend the forward-only research outcome classifier so an explicit generator parse,
truncation, schema, or missing-required-field degradation cannot be classified as
`investment_hold`. Preserve one-outcome-per-attempt conservation. Legacy rows remain
non-classifiable rather than inferred from prose.

Use one canonical outcome/reason name selected in the measurement specification;
prefer `generator_degraded` unless O1 records a different accepted term.

#### O2A.3 Define cohort eligibility

Add a pure function that returns `{ eligible, reasonCodes }` from structured facts.
It must exclude forced/manual/legacy origin, stale/blocked data, provider/budget/parser
failure, unknown classification, missing version identity, and non-organic fixtures.
It must not decide whether the investment is good or change an action.

### Verification

- `node --test tests/evaluator-admission.test.js tests/research-cohort-eligibility.test.js tests/research-run-report.test.js tests/evaluator.test.js`
- `npm test`
- `rg -n "evaluator-admission|research-cohort-eligibility" jobs scheduler.js lib/redis.js`
- `git diff --check`

### Acceptance criteria

- Contradictory `APPROVE` fixtures fail admission.
- Generator degradation never becomes `investment_hold`.
- Outcome conservation still equals attempted reviews in every fixture.
- New cohort logic is pure and has no production-state imports.
- The final `rg` shows no job, scheduler, or Redis integration.

## 8. Packet O2B — Complete positive-path contract test

**Type:** test-first orchestration hardening  
**Clock effect while undeployed:** none; future merge requires R1/S2 classification  
**Recommended model:** strong builder, not a small executor  
**Commit:** `test: cover complete research proposal path`

### Initial ownership

- Add `tests/research-pipeline-contract.test.js`
- Add fixture/helper files under `tests/fixtures/research-pipeline/`
- Modify `jobs/research-scan.js` only if a narrow dependency-injection/export seam is
  required for the test
- Modify no prompt, threshold, risk policy, queue schema, scheduler, or runtime flag

If the required seam would touch more than `jobs/research-scan.js` plus one pure helper,
stop and return a revised file map to the primary reviewer before editing.

### Read first

- `jobs/research-scan.js` completely
- `lib/ai-overlay.js`
- `lib/evaluator.js`
- `lib/risk-engine.js`
- `lib/proposal-sizing.js`
- `lib/data-gates.js`
- `lib/research-run-report.js`
- `tests/research-run-report.test.js`
- `tests/evaluator.test.js`
- `tests/proposal-sizing.test.js`
- `tests/research-scan-history.test.js`
- `docs/CHANGE_MAP.md` research and proposal sections
- `docs/INVARIANTS.md`

### Tasks

#### O2B.1 Establish a non-network test seam

Expose or extract the smallest function that can execute one candidate through cheap
gates, generator, deterministic downgrade, evaluator, sizing, and queue decision with
all external dependencies injected. The production wrapper must retain identical
defaults and call order. Do not add a second pipeline.

#### O2B.2 Cover the required cases

Using only fakes, prove:

- qualifying candidate → generator BUY → evaluator APPROVE → correctly sized one
  proposal;
- evaluator REVISE → exactly one generator retry → APPROVE → one proposal;
- evaluator REJECT → no proposal;
- evaluator error → HOLD/no proposal;
- numeric failure or suspect evidence under an `APPROVE` result → fail-closed/no
  proposal in the future admission path, without upgrading anything;
- stale data → generator and evaluator not called;
- duplicate proposal → no second queue write;
- budget failure and generator degradation remain distinct outcomes; and
- queue failure is explicit and cannot be reported as success.

#### O2B.3 Prove unchanged production defaults

Add assertions that the normal exported production entry point still supplies the
same dependencies, still permits only one revision, and does not import the test
fixtures. Do not wire the new O2A admission behavior into production without the
primary reviewer's later R1 release decision; the contract fixture may show the
intended future behavior through an injected policy.

### Verification

- `node --test tests/research-pipeline-contract.test.js tests/evaluator.test.js tests/proposal-sizing.test.js tests/research-run-report.test.js`
- `npm test`
- `rg -n "tests/fixtures/research-pipeline|research-pipeline-contract" jobs lib scheduler.js`
- `git diff --check`

### Acceptance criteria

- Every required path asserts generator/evaluator/queue call counts.
- REVISE performs exactly one retry.
- REJECT, error, stale, duplicate, contradiction, and queue-failure cases create zero
  proposals.
- No external service, Redis, Sheets, Postgres, broker, or paid model is contacted.
- Production behavior has not changed merely to make the test easy.

## 9. Packet O3 — Shared candidate bus and mandate ranking contract

**Type:** inert contract and fixtures  
**Clock effect while undeployed:** none  
**Recommended model:** small or standard coding model  
**Commit:** `feat: define inert shared candidate bus contract`

### Owned files

- Add `contracts/research-candidate-bus.js`
- Add `tests/research-candidate-bus-contract.test.js`
- Add fixtures under `tests/fixtures/research-candidate-bus/`
- Update `docs/ATHENA-INTEGRATION-AND-AGENT-PARITY-PLAN.md` only for exact contract
  cross-reference
- Update `docs/RESEARCH-ROADMAP-EXECUTION-GUIDE.md` only for packet status after review

Do not edit `lib/candidate-slate.js`, `jobs/research-scan.js`, agent universe config,
selection flags, scheduler, Redis, or proposal code.

### Read first

- Every owned existing file
- `lib/candidate-slate.js`
- `lib/evidence-slate.js`
- `tests/candidate-slate.test.js`
- `tests/evidence-slate.test.js`
- `config/agents/agent-1/universe.json`
- `config/agents/agent-2/universe.json`
- `config/agents/agent-3/universe.json`
- all three canonical mandate JSON files
- `docs/RESEARCH-DECISION-REGISTER.md` D-002, D-003, D-006, Q-001–Q-005

### Contract requirements

Define and validate two separate records:

1. `EligibleResearchCandidate`: normalized ticker/security identity, eligibility
   policy/version, source channels, observation/evidence IDs, freshness/completeness,
   sector/cap/liquidity classification, holding/mandatory-review status, and explicit
   unavailable/exclusion reasons.
2. `MandateCandidateRank`: candidate identity, agent/mandate version, deterministic
   rank inputs, rank/reason codes, evidence age, prior-research/recency state, and
   whether the record is shadow-only.

The bus contains shared facts and eligibility, not a shared investment score. Each
agent ranks independently. Holdings and mandatory re-underwrites remain protected.

### Required fixtures

- One candidate eligible for all agents but ranked differently by each mandate.
- One special-sector candidate with unresolved economics, ineligible for actionable
  ranking but visible for coverage.
- One stale candidate, one structurally incomplete candidate, and one excluded
  security type.
- One holding that remains mandatory regardless of rank.
- Same ticker researched independently by multiple agents without forced
  de-duplication or ownership mutation.

### Verification

- `node --test tests/research-candidate-bus-contract.test.js tests/candidate-slate.test.js tests/evidence-slate.test.js`
- `npm test`
- `rg -n "research-candidate-bus" jobs lib scheduler.js config`
- `git diff --check`

### Acceptance criteria

- Contract validation fails closed on missing identity, version, or reason fields.
- Shared eligibility never produces an action, proposal, size, approval, or order.
- Mandate ranking cannot mutate the candidate facts.
- No live file imports the new contract.
- Q-001–Q-005 remain explicit blockers rather than invented defaults.

## 10. Packet O4A — AthenaEvidencePackage-v1 contract

**Type:** inert evidence contract and fixtures  
**Clock effect while undeployed:** none  
**Recommended model:** standard coding model  
**Commit:** `feat: define inert athena evidence package contract`

### Owned files

- Add `contracts/athena-evidence-package.js`
- Add `tests/athena-evidence-package-contract.test.js`
- Add fixtures under `tests/fixtures/athena-evidence-package/`
- Update `docs/ATHENA-INTEGRATION-AND-AGENT-PARITY-PLAN.md` with the exact implemented
  contract name/version and unresolved permission/runtime assumptions

Do not edit `lib/athena.js`, server health, research prompts, jobs, feature flags,
network code, scheduler, Redis/Postgres writers, or proposal code.

### Read first

- Every owned existing file
- `docs/ATHENA-INTEGRATION-AND-AGENT-PARITY-PLAN.md` completely
- `contracts/research-observation.js`
- `lib/research-version.js`
- `lib/athena.js`
- `tests/athena.test.js`
- `docs/adr/0003-point-in-time-research-record.md`
- `docs/INVARIANTS.md`

### Contract requirements

The validated package must include:

- package, company/security, source-revision, retrieval, mandate-independent evidence,
  and point-in-time identities;
- immutable canonical fingerprint and explicit contract version;
- source facts with source URL/identifier, publication/as-of/retrieval times, evidence
  class, and conflict/restatement indicators;
- analytical modules, valuation assumptions/ranges, disconfirming evidence, risks,
  catalysts, forecasts, confidence/calibration metadata, and kill-criteria inputs;
- completeness by required section, missing/partial/stale/conflicting reasons, and
  upstream failure state; and
- no action, approval, sizing, execution, or Portfolio Manager authority field.

Required fixtures: valid complete, valid partial, stale, conflicting, unsupported
contract version, fingerprint mismatch, invalid chronology, missing source identity,
and unavailable package.

### Verification

- `node --test tests/athena-evidence-package-contract.test.js tests/athena.test.js tests/research-observation-contract.test.js`
- `npm test`
- `rg -n "athena-evidence-package" jobs lib server.js scheduler.js`
- `git diff --check`

### Acceptance criteria

- Identical canonical content produces an identical fingerprint; material content or
  source-version change produces a different fingerprint.
- Invalid chronology, missing provenance, unknown versions, and fingerprint mismatch
  fail closed.
- Partial/unavailable packages remain explicit and cannot masquerade as complete.
- The contract contains no trade action or authority.
- No live runtime imports the contract.

## 11. Packet O4B — Thirty-company golden-set source packets

**Type:** research fixture construction  
**Clock effect:** none; not a production or SKILL sample  
**Recommended executors:** up to six research models or human collaborators, one
disjoint five-company cohort each  
**Commit pattern:** `test: add athena golden set cohort <name>`

### Owned files

Each executor owns exactly one new file:

- `tests/fixtures/athena-golden-set/cohort-a.json`
- `tests/fixtures/athena-golden-set/cohort-b.json`
- `tests/fixtures/athena-golden-set/cohort-c.json`
- `tests/fixtures/athena-golden-set/cohort-d.json`
- `tests/fixtures/athena-golden-set/cohort-e.json`
- `tests/fixtures/athena-golden-set/cohort-f.json`

The integrator alone owns:

- `tests/fixtures/athena-golden-set/manifest.json`
- Add `tests/athena-golden-set.test.js`
- Add `docs/ATHENA-GOLDEN-SET-METHODOLOGY.md`

### Cohort design

The integrator preassigns thirty public companies across large/mid/small cap,
ordinary and special sectors, profitable and loss-making businesses, share classes,
recent earnings, corporate actions, and intentionally conflicting public facts. No
executor may replace its assigned companies after inspecting vendor results.

Each company record must include a frozen decision date, security/share-class
identity, sector/economic classification, primary-source links or identifiers,
expected point-in-time facts, expected unavailable facts, known conflicts, valuation
questions, disconfirming questions, and scoring notes. Primary SEC/issuer sources are
preferred. Vendor/Athena output must not be used to author expected answers.

### Executor rules

- Use public sources only; do not use production credentials, private portfolio data,
  paid vendor trials, or copied proprietary reports.
- Quote minimally; store facts and source identifiers, not large copyrighted text.
- If a fact cannot be established point-in-time, mark it `unavailable` with a reason.
- Do not score whether the stock is a BUY/SELL or generate a proposal.

### Verification

- Integrator validates all files against one fixture schema and rejects duplicate
  tickers/security IDs, missing dates, missing provenance, and non-frozen expectations.
- `node --test tests/athena-golden-set.test.js`
- `npm test`
- `git diff --check`

### Acceptance criteria

- Exactly 30 distinct security identities exist across six disjoint files.
- The set covers the predeclared size/sector/special-situation matrix.
- Every expected fact has point-in-time source provenance or an explicit unavailable
  reason.
- No record contains vendor results, Portfolio Manager actions, or investment advice.

## 12. Packet O5 — Deterministic offline workflow comparator

**Type:** pure offline evaluation harness  
**Clock effect:** none; synthetic results are not a SKILL cohort  
**Recommended model:** standard coding model  
**Commit:** `feat: add offline research workflow comparator`

### Owned files

- Add `lib/research-workflow-comparator.js`
- Add `tests/research-workflow-comparator.test.js`
- Add `scripts/compare-research-workflows.mjs`
- Add local-only fixtures under `tests/fixtures/research-workflow-comparator/`
- Update `package.json` only with a clearly named read-only/offline script if useful

Do not import production credentials, make network/model calls, read production
Redis/Sheets/Postgres, or write any external state.

### Read first

- `docs/PROPOSAL-QUALITY-MEASUREMENT-SPEC.md`
- `contracts/research-candidate-bus.js`
- `contracts/athena-evidence-package.js`
- `lib/research-evidence-report.js`
- `tests/research-evidence-report.test.js`
- `lib/athena.js`
- `lib/evidence.js`
- `docs/BACKTEST-METHODOLOGY-v1.md`

### Tasks

#### O5.1 Define pure comparison input/output

Accept injected, versioned results for current workflow, compact Athena adapter, and
full package. Compare factual support, provenance coverage, freshness, conflict
handling, missing-data honesty, unsupported claims, disconfirming evidence, valuation
assumption completeness, evaluator disposition, deterministic latency/cost inputs,
and reproducibility. Report unavailable metrics as unavailable, never zero.

#### O5.2 Build deterministic fixtures

Include positive, negative, partial, stale, conflicting, and null-result cases. The
same decision date and company facts must be used across all three workflow variants.
No fixture may contain a real production proposal or private rationale.

#### O5.3 Produce aggregate-safe output

The script reads only explicit local fixture paths and prints deterministic JSON or
Markdown. It performs no hidden I/O, writes no file by default, and has conclusion
`not_assessed`. It must never say one workflow has edge or is promoted.

### Verification

- `node --test tests/research-workflow-comparator.test.js tests/research-evidence-report.test.js`
- Run the offline script twice on the same fixture and compare content hashes.
- `npm test`
- Search the new files for `fetch(`, Redis, Sheets, Postgres, broker, proposal write,
  and environment-secret access; all must be absent.
- `git diff --check`

### Acceptance criteria

- Same inputs produce byte-stable JSON/Markdown and content hash.
- Negative/null results have equal prominence.
- Missing cost or outcome policy cannot produce net/edge conclusions.
- The comparator cannot call a model, vendor, production store, or proposal path.
- Results are labeled `fixture`, `synthetic`, or `offline_replay`, never `live`.

## 13. Packet O6 — Integration, independent review, and handoff

**Type:** integration/review only  
**Clock effect while undeployed:** none  
**Owners:** primary reviewer plus one independent Claude/Codex reviewer  
**Commit:** corrective commits only after findings; no production merge commit

### Read first

- All O0–O5 plans, diffs, commit summaries, and test results
- `docs/portfolio-master-plan.md`
- `docs/RESEARCH-ROADMAP-EXECUTION-GUIDE.md`
- `docs/CHANGE_MAP.md`
- `docs/INVARIANTS.md`
- `scheduler.js`
- `jobs/research-scan.js`
- `config/research-selection.json`

### Integration checks

1. Confirm commit boundaries and that no executor staged another executor's work.
2. Rebase or apply commits sequentially in dependency order; resolve no semantic
   conflict by guessing.
3. Run focused tests from every packet, then `npm test` from the combined branch.
4. Run `git diff --check` and a sensitive-file/pattern scan before any push.
5. Compare `scheduler.js`, production flags, prompts, thresholds, proposal schemas,
   signatures, ledgers, money paths, observer code, and deployment scripts against the
   observed production base. Any unplanned difference is blocking.
6. Search for live imports of new inert contracts and diagnostics. Only the narrowly
   approved O2B dependency-injection seam may touch a production job, and its defaults
   must be behaviorally identical.
7. Require an independent read-only review with findings ordered by severity and exact
   file/line evidence.
8. Produce `docs/OBSERVATION-OFFLINE-WORK-HANDOFF.md` containing commits, tests,
   unresolved decisions, deferred production actions, expected future change classes,
   rollback notes, and an explicit `NOT DEPLOYED` status.

### Combined verification commands

- Focused commands from O2A, O2B, O3, O4A, O4B, and O5
- `npm test`
- `git diff --check`
- `git status --short --branch`
- `git diff <observed-production-revision> -- scheduler.js jobs/phase0-observer.js lib/phase0-observer.js config/research-selection.json contracts/signature.js lib/proposal-signature.js`
- `rg -n "ATHENA_ENABLED|mode.*canary|mode.*live|canarySlots|Agent 4|ApprovedForBrokerReview"` over changed files, with every match explained

### O6 acceptance criteria

- Full suite exits 0 on the combined non-production branch.
- Secret scan is clean.
- No production schedule, flag, prompt, threshold, authority, signature, proposal,
  execution, money, observer, or deployment behavior changed.
- Every new production-capable module is either unimported or behind an explicitly
  unchanged, off-by-default path.
- Independent review has no unresolved P0/P1 finding.
- Handoff says `NOT DEPLOYED`, names the exact branch/commits, and does not claim an
  observation day, research sample, approval, outcome, or promotion.

## 14. Executor prompt template

Give each Claude/Codex executor one packet only, replacing bracketed values.

```text
Work only in the isolated Portfolio Manager observation-offline worktree.

Packet: [O# — packet name]
Owned files: [exact list from this plan]
Base revision: [exact observed production revision]

Read first, completely:
- /Users/samhuffard/AGENTS.md
- .claude/napkin.md
- docs/portfolio-master-plan.md
- docs/RESEARCH-ROADMAP-EXECUTION-GUIDE.md section 3.1
- docs/OBSERVATION-PERIOD-OFFLINE-EXECUTION-PLAN.md packet [O#]
- every file listed in the packet's Read first section

Preserve the Phase 0 production freeze. Do not deploy, restart, migrate, change env
or production flags, write external state, call paid services, create proposals, or
touch files outside your owned list. Do not stage or commit pre-existing work.

Implement the packet exactly. If a required change exceeds the owned files, conflicts
with a canonical contract, requires an investment-policy guess, or could change live
behavior, stop and report the blocker instead of broadening scope.

Run every packet verification command and git diff --check. Return:
1. outcome: complete or blocked;
2. files changed and precise behavior;
3. commands and exact pass/fail counts;
4. invariants preserved;
5. files and behaviors explicitly not changed;
6. remaining risks/decisions;
7. commit hash if authorized to commit.
```

## 15. Independent review prompt template

```text
Perform a read-only independent review of the Portfolio Manager observation-period
offline branch against docs/OBSERVATION-PERIOD-OFFLINE-EXECUTION-PLAN.md.

Compare the complete diff with the exact observed production base. Verify packet
scope, TRUST/SKILL gate meaning, fail-closed behavior, version/cohort semantics,
outcome conservation, deterministic fixtures, contract provenance, import isolation,
and the production freeze.

Report P0/P1/P2/P3 findings first with exact file:line evidence and one concrete fix.
Then report requirement coverage for O0–O6, tests independently rerun, and a verdict:
READY AS NON-PRODUCTION REVIEW CANDIDATE or BLOCKED.

Do not edit, merge, push, deploy, restart, migrate, access secrets, call external
services, or treat fixture results as observation/skill evidence.
```

## 16. Commit and handoff rules

- One focused commit per packet or subpacket; never one mixed O0–O6 commit.
- Executors stage only their owned files and inspect `git diff --cached` before commit.
- Commit messages use the exact packet message declared above.
- Primary reviewer records commit hashes and verification evidence after each wave.
- Parallel branches are integrated only after each packet passes focused tests and
  scope review.
- No branch is merged into a production-tracking branch during Phase 0.
- After Phase 0, every diff is reclassified D/R1/R2/S1/S2 before any release proposal.
- Deployment requires a new explicit user instruction; completion of this plan is not
  deployment authorization.

## 17. Recommended first execution

Begin with Wave 0, then run O0 and O1. Do not begin code packets until O1 freezes the
measurement vocabulary that their fields and fixtures must implement. After O0/O1
review, O2A, O3, and O4A can run concurrently in disjoint worktrees or branches.

The first checkpoint back to Sam should contain only:

- the isolated branch/worktree identity;
- baseline test count;
- O0 documentation diff summary;
- O1 measurement-spec summary;
- confirmation that production remains unchanged; and
- any policy question that genuinely cannot be resolved from Q-001–Q-007 or the
  canonical plans.

