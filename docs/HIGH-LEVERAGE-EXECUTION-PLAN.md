# Portfolio Manager — High-Leverage Execution Plan

**Status:** strategic execution overlay; no independent promotion authority  
**Created:** 2026-07-21  
**Baseline:** specialist-parity release `51c78ca`, documentation proof `f36b388`  
**Canonical authority:** [portfolio-master-plan.md](portfolio-master-plan.md)

This plan turns the project's six highest-leverage initiatives into one executable
program without creating a new phase sequence. The master plan remains authoritative
for order, gates, clock effects, promotion, and demotion. The research and autonomy
roadmaps remain authoritative inside their narrower SKILL and TRUST scopes.

The specialist-parity release changes the bottleneck. Agents 1–3 now share broad
discovery, evidence, evaluator, risk, sizing, and approval machinery. The next job is
not to make Agents 2/3 technically equal; it is to make three equal-capability agents
produce genuinely different, testable, evidence-bound judgments and to build the
measurement and lineage needed to learn from those judgments safely.

The [substantive offline execution plan](SUBSTANTIVE-OFFLINE-EXECUTION-PLAN.md)
sets the required evidence bar for the current offline branch. It remains subordinate
to this plan and the master plan.

## 1. Program outcomes

The program succeeds only when the system can answer all of these questions from
durable evidence:

1. **Mandate:** Why did this specialist see and prefer this company under its exact
   policy version, and why would another specialist rank it differently?
2. **Evidence:** What point-in-time facts were available, how fresh were they, and
   which claims did they support or contradict?
3. **Decision:** Why did the generator, evaluator, risk layer, Sam, and eventually
   Agent 4 accept, reject, revise, size, or abstain?
4. **Lineage:** Which immutable research intent and evidence snapshot produced the
   exact signed allocation proposal and any resulting strategy-owned lot?
5. **Learning:** Did the decision help at the mandate's declared horizon after costs,
   compared with a predeclared alternative?
6. **Control:** Can any stale, unsigned, ambiguous, cross-strategy, or inconsistent
   state be prevented from becoming authority?

No dashboard, data subscription, additional agent, or autonomy feature outranks these
outcomes.

## 2. Six integrated initiatives

### H1 — Exact mandate differentiation

**Goal:** preserve equal workflow and trust while making each specialist's economic
judgment structurally different and measurable.

**Phase placement:** Phase 1 policy/contract freeze → Phase 3 evidence and score
activation → Phase 6 current-version proof.

**Work:**

- Resolve Q-001–Q-004 and record accepted answers in the decision register.
- Compile each v3 mandate into a versioned policy package covering universe
  eligibility, ranking factors, valuation method, evidence criticality, freshness,
  entry/abstention/exit rules, horizon, benchmark, position constraints, and special-
  sector substitutions.
- Keep discovery, evidence handling, evaluator access, risk, sizing, proposal
  semantics, ownership, and observability identical across Agents 1–3.
- Add invariant tests proving workflow parity and mandate tests proving deliberate
  divergence. Pairwise rankings on the same comparable cohort must not silently
  converge because of shared defaults.
- Preserve missing or unresolved policy as unavailable/non-actionable; no builder or
  model may invent an investment definition.

**Acceptance evidence:** accepted decisions, versioned mandate artifacts, executable
fixtures for ordinary and special sectors, shared-workflow parity tests, and a
versioned cross-agent divergence report on the same point-in-time cohort.

**Stop conditions:** unresolved Q-001–Q-004 input; hidden global fallback replacing a
mandate rule; different evidence or evaluator power by agent; any attempt to count
prompt tone as substantive differentiation.

### H2 — Measurement before throughput tuning

**Goal:** explain abstention and proposal quality before changing thresholds, prompts,
or approval behavior.

**Phase placement:** Phase 0 offline diagnosis and any declared R1 release → Phase 3
score validation → Phase 7 durable edge measurement.

**Work:**

- Freeze the definition of an organic proposal, qualifying setup, valid abstention,
  degraded generator result, evaluator-grade proposal, and excluded sample.
- Build Bench-30 from timestamped, immutable fixtures with mechanical
  `retrievedAt <= decisionTime` enforcement and predeclared expected facts.
- Record generator and deterministic gate margins, evidence completeness/freshness,
  final action, evaluator admission/verdict, revision class, and explicit block reason.
- Run blind proposal grading with an observable rubric: factual support, variant view,
  valuation assumptions, disconfirmation, kill criteria, uncertainty, and mandate fit.
- Separate mandate horizons when outcomes mature; do not pool short-, medium-, and
  long-horizon labels into one accuracy number.
- Treat zero proposals as a diagnosis to investigate, never a reason to lower a gate
  or manufacture a trade.

**Acceptance evidence:** preregistered measurement spec, frozen fixture hashes,
conserved outcome counts, blind-grade results, per-gate margin distributions, and
version-separated outcome reports with uncertainty.

**Stop conditions:** look-ahead leakage; results interpreted before the rubric is
frozen; mixed policy versions; production model spend outside cost governance;
threshold tuning whose purpose is to create samples.

### H3 — Point-in-time evidence substrate and golden set

**Goal:** make factual support reproducible and use measured gaps—not intuition—to
decide whether Athena or a vendor deserves integration.

**Phase placement:** Phase 2 durable truth → Phase 3 coverage/score meaning → Phase 4
attention experiments.

**Work:**

- Persist versioned source receipts, evidence snapshots, facts, availability times,
  restatement handling, classifications, conflicts, and completeness states.
- Freeze a 30-company golden set before querying a new vendor. Include ordinary
  companies, special sectors, thin coverage, corporate actions, restatements, share-
  class traps, stale estimates, and negative cases.
- Keep proposal-critical reported fundamentals and point-in-time facts traceable to
  primary sources. Vendor values may corroborate but cannot silently replace source
  provenance.
- First test missing-data hypotheses with zero-cost fixtures or free trials. A paid
  source must improve named golden-set failures and change a traced decision-quality
  limitation within the accepted budget.
- Keep Athena conclusions outside the evaluator and quarantined from authority.
  Consider richer Athena evidence only after permission/licensing, a versioned
  endpoint, freshness/completeness semantics, and an evidence-only A/B result.

**Acceptance evidence:** immutable golden-set T0 commit, coverage/freshness/conflict
report, reproducible A/B fixtures, vendor scorecard, cost-per-underwritten-company,
and an explicit buy/no-buy decision tied to measured gaps.

**Stop conditions:** purchasing before T0 facts are frozen; using current data to grade
historical decisions; conclusion echo presented as independent evidence; silent source
fallback; unclear license or redistribution rights.

### H4 — One proposal compiler and immutable lineage

**Goal:** route every proposal source through one reproducible, fail-closed contract
before any authority expands.

**Phase placement:** Phase 1 source/signature freeze → Phase 5 coordinated
implementation and cutover.

**Accepted target:**

```text
ResearchIntent → EvidenceSnapshot → immutable StrategyProposal
  → AllocationProposal(strategyProposalId + fingerprint)
  → signature v2 → deterministic executor
```

**Work:**

- Keep the five-source inventory complete: scheduled discovery, Lab, exit monitor,
  intraday stop, and manual dashboard.
- Freeze the exact immutable strategy record and byte-level signature-v2 payload,
  including mandate/version, evidence fingerprint, evaluator lineage, expiry, sizing,
  kill criteria, and owned SELL-lot references.
- Decide every outstanding v1 approval as fulfill/reject/expire before v2-only
  enforcement. Never mutate a v1 signature into v2.
- Implement additive readers and storage before writers, then route one source at a
  time through the compiler with rollback after each source.
- Keep the compiler unable to approve, sign, execute, or write accounting ledgers.
- Require dashboard and companion contracts to be mechanically mirrored and drift-
  tested before the coordinated activation.

**Acceptance evidence:** frozen ADR, v1 disposition ledger, source-inventory test,
contract/signature/fingerprint tests, one fixture per source, direct-writer search,
cross-runtime drift tests, rollback drill, and exact proposal-to-fill lineage.

**Stop conditions:** ambiguous serialization; mixed v1/v2 write authority; an entry
source bypass; mutable evidence; unowned SELL; partial backend/dashboard/companion
deployment.

### H5 — Agent 4 shadow portfolio management

**Goal:** test coordination and capital allocation without allowing Agent 4 to invent,
amend, or force a trade.

**Phase placement:** Phase 1 policy freeze → Phase 4 shadow comparison → Phase 6
bounded BUY acceptance → Phase 8 bounded owner-proposed exits.

**Work:**

- Version Agent 4's objective, virtual strategy budgets, allocation bounds, regime
  inputs, conflict policy, explanation requirements, cadence, and rollback rules.
- Feed it only immutable specialist proposals and current portfolio/risk snapshots.
- Record shadow accept/reject and virtual allocation decisions beside Sam's actual
  decisions without influencing live approval.
- Surface duplicate theses, factor/sector concentration, cash pressure, regime
  disagreement, strategy ownership, and liquidity conflicts rather than silently
  netting them.
- Compare Agent 4 with Sam using paired, current-version samples and minimum sample
  rules. Prevent performance chasing through capped allocation changes and declared
  evidence windows.

**Acceptance evidence:** immutable `PortfolioDecision` records, paired Sam/Agent 4
comparison, explanation rubric, cap tests, regime/freshness proof, rollback drill,
and the master plan's sample and live-fill gates.

**Stop conditions:** Agent 4 origination or proposal mutation; forced sales; allocation
based on immature returns; missing portfolio snapshot; promotion based on anecdote or
a handful of trades.

### H6 — Trust substrate for larger capital

**Goal:** remove the remaining evidence, signing, valuation, and financial-cutover
weaknesses before capital or authority scales.

**Phase placement:** Phase 0 observation and emergency rules → Phase 2 financial shadow
proof → Phase 5 coordinated lineage/financial cutover → continuous demotion controls.

**Work:**

- Preserve signed daily observation records while progressively binding their critical
  upstream receipts, heartbeats, job histories, and restart baselines to authenticated,
  replay-resistant evidence.
- Finish operational-key retirement: dedicated-key-required signing after cutover,
  epoch-scoped legacy verification, deliberate historical attestation/re-signing, and
  tested legacy removal.
- Require freshness/content binding for valuation used by the circuit breaker, sizing,
  concentration, or cutover parity. Stale valuation degrades to UNKNOWN and blocks
  new BUY authority.
- Replace heuristic cash-flow attribution in investor-facing performance with signed
  capital-event accounting.
- Replace quiet-day-only Postgres promotion with event and drill evidence: capital
  events, fills, corrections, idempotent replay, crash-mid-write, restore, rollback,
  valuation parity, and a named divergence arbiter.
- Keep this work in declared S1/S2 releases with independent review and explicit clock
  effects; do not hide it inside research work.

**Acceptance evidence:** threat model, signed-source contracts, replay/tamper tests,
key-retirement proof, quote-freshness failure tests, capital-flow return fixtures,
event-count cutover dossier, restore/rollback proof, and post-cutover auto-freeze.

**Stop conditions:** changing observation meaning mid-window without a reset; silent key
fallback; valuation marked comparable without shared quote identity; financial cutover
based only on elapsed time; any authority expansion coupled to an unproven migration.

## 3. Phase integration

| Existing phase | Highest-leverage deliverables | Explicitly not promoted here |
| --- | --- | --- |
| **0 — supervised baseline** | Complete the five-day TRUST window and current-version throughput gate; preregister H2; design H6 offline | No live tuning, vendor intake, Agent 4 authority, signature change, or canonical-read change |
| **1 — mandates/contracts** | H1 policy freeze; H4 source inventory, v2 payload, v1 disposition; H5 policy; H6 threat/cutover design | No compiler writer, v2 activation, Agent 4 runtime authority, or invented policy |
| **2 — durable truth** | H3 point-in-time substrate; research chronology; financial event/drill evidence for H6 | No claim of source quality or Postgres canonical authority from plumbing alone |
| **3 — coverage/score meaning** | Activate H1 mandate evidence and scoring; golden-set validation; H2 margin/grade analysis | No positive canary or edge claim from coverage alone |
| **4 — attention/Agent 4 shadow** | Evidence-slate shadow/canary; H3 A/B; H5 paired shadow decisions | No Agent 4 authorization or conclusion-fed evaluator |
| **5 — compiler/financial truth** | H4 coordinated v2 lineage cutover; H6 financial cutover only after separate gates | No partial cross-runtime cutover or catalog work already completed by parity release |
| **6 — bounded autonomy proof** | H2 current-version proposal sample; H5 bounded BUY acceptance after TRUST proof | No autonomous SELL or cap expansion without the phase gate |
| **7 — cash/edge** | Mature H2 outcomes and counterfactuals; cost-aware edge reports | No forced BUY and no performance claim from immature samples |
| **8 — exits/full mandate autonomy** | H5 owner-proposed SELL acceptance and gradual authority expansion | No Agent 4-originated trade or forced sale |

## 4. Execution waves and dependencies

### Wave A — Phase 0/1 offline freeze packet

May proceed now in the isolated Phase 1 worktree:

1. Complete Q-001–Q-004 interviews and decision-register drafts.
2. Produce the three compiled mandate specifications and shared-workflow invariant
   matrix without activating them.
3. Freeze H2 definitions, Bench-30 slots, grader rubric, and fixture chronology rules.
4. Freeze H3 golden-set slot definitions and source/licensing questions.
5. Complete H4 v2 payload, compatibility matrix, v1 disposition procedure, and source
   inventory.
6. Version the H5 Agent 4 policy packet.
7. Produce H6 threat model and separately classified S1/S2 release candidates.

**Wave gate:** document/contract review proves no production imports, no changed live
flags, no unresolved policy encoded as a default, and no Phase 0 clock effect.

### Wave B — First declared research release

Begins only through the master plan's release protocol after offline review:

1. Ship H2 telemetry and strictly fail-closed quality controls as a declared R1
   cohort; preserve authority and record its exact version.
2. Run Bench-30 and blind grading against frozen fixtures.
3. Use observed margins and defect classes to choose one bounded follow-up. A change
   that can increase approvals requires its own A/B and new cohort.

**Wave gate:** outcome conservation, no false organic samples, known cost, no authority
change, and a published diagnosis that can be falsified.

### Wave C — Durable evidence and mandate activation

1. Promote the reviewed point-in-time research substrate through Phase 2 gates.
2. Bind accepted mandate policies to Agent 1/2/3 evidence and scoring in Phase 3.
3. Run the golden set and free evidence comparisons before any purchase.
4. Require shared-workflow parity plus deliberate ranking divergence on comparable
   cohorts.

**Wave gate:** reproducible scores, acceptable coverage/freshness, no look-ahead,
special-sector correctness, and no source or mandate ambiguity.

### Wave D — Attention and portfolio-manager shadow

1. Run evidence-driven selection in shadow, then bounded canary slots after the
   existing 20-day gate.
2. Start Agent 4 shadow decisions only with the versioned policy and immutable inputs.
3. Capture paired Sam/Agent 4 decisions, conflicts, and virtual allocation changes.

**Wave gate:** better predeclared research-quality or mature outcome metrics without
loss of holding coverage, budget discipline, or authority separation.

### Wave E — Coordinated lineage and financial truth

1. Implement H4 readers/storage and then writers, routing each source separately.
2. Coordinate backend, dashboard, companion, signature, and rollback at v2 cutover.
3. Promote Postgres money reads only through H6's separate event/drill gate; lineage
   completion does not automatically authorize financial cutover.

**Wave gate:** no compiler bypass, exact immutable lineage, clean v1 disposition,
cross-runtime parity, signed restart/deploy proof, financial restore/rollback proof,
and immediate deterministic demotion.

### Wave F — Measured coordination and bounded authority

1. Accumulate the master plan's current-version proposal, outcome, and fill samples.
2. Compare specialist and Agent 4 decisions at the correct mandate horizons.
3. Promote Agent 4 only in the master plan's order: shadow → bounded eligible BUY
   accepts → bounded owner-proposed SELL accepts → full mandate autonomy.

**Wave gate:** independent TRUST and SKILL reviews both pass. One cannot substitute for
the other.

## 5. Portfolio-level acceptance dashboard

This is a reporting checklist, not a new gate. Each row points to existing master-
plan gates.

| Initiative | Current baseline | Next proof | Long-term completion signal |
| --- | --- | --- | --- |
| H1 mandates | Equal workflow released; policy questions open | Accepted Q-001–Q-004 and compiled mandate fixtures | Distinct reproducible rankings and mature results by version/horizon |
| H2 measurement | Zero organic approvals; abstention precedes evaluator | Frozen Bench-30, margins, blind grading | Calibrated proposal/outcome evidence with uncertainty |
| H3 evidence | Point-in-time spine partly built; new sources unproven | Golden-set T0 and reproducible source comparison | Material factual improvement at acceptable cost and provenance |
| H4 lineage | Five legacy direct proposal sources inventoried | Frozen v2 payload and v1 disposition | Every fill traces to one immutable strategy/evidence record |
| H5 Agent 4 | Shadow-only contract, policy incomplete | Versioned policy and paired shadow records | Bounded authority earns promotion through current-version evidence |
| H6 trust | Strong supervised controls; residual source-signing/valuation/cutover debt | Threat model and classified release dossiers | Authenticated evidence, fresh valuation, proven financial cutover, automatic demotion |

## 6. Governance rules

1. Update this document when execution dependencies change, but update the master plan
   when phase order, gates, status, or authority changes.
2. Every work packet names one initiative, one master phase, one change class, one
   evidence artifact, and one rollback/stop condition.
3. A packet spanning TRUST and SKILL is split unless the coupling is unavoidable and
   independently reviewed.
4. Documentation may describe later implementation, but only runtime evidence may
   mark it deployed or passed.
5. Existing dirty production-tracking worktrees are not integration surfaces. Use the
   isolated branch, preserve unrelated work, and never stage local `node_modules` or
   secret-bearing files.
6. After every material release or gate result, update the master-plan status,
   evidence ledger, readiness scorecard, and durable vault note together.

## 7. Explicit depriorities

Until the relevant gates above pass, do not prioritize:

- a fourth idea-generation specialist;
- options, crypto, or additional asset classes;
- new dashboard surfaces without a decision or evidence consumer;
- paid data without a frozen golden-set failure and purchase gate;
- Athena production intake without permission and an evidence-only contract;
- local-model routing changes that invalidate the measurement baseline;
- execution autonomy, forced-buy behavior, or Agent 4 trade origination;
- Postgres acceleration based only on elapsed quiet days;
- additional sysloop autonomy or notification channels without a measured precision
  problem.

## 8. Immediate next actions

1. Finish the Phase 0 observer result for the first eligible post-release trading day;
   do not infer a count from health alone.
2. Schedule and record Q-001–Q-004, then compile the three mandate policies offline.
3. Freeze Bench-30, the blind-grading rubric, and golden-set T0 definitions before
   interpreting or buying anything.
4. Complete the signature-v2 freeze packet and outstanding-v1 disposition inventory;
   implementation remains Phase 5.
5. Complete Agent 4's policy packet without adding runtime authority.
6. Convert the H6 findings into separately classified, independently reviewable
   release dossiers; do not mix them into the R1 research cohort.

The [observation-week release plan](OBSERVATION-WEEK-RELEASE-PLAN.md) turns these
actions into a five-observation-day offline release train, including candidate-branch
selection, packet acceptance, and the post-observation decision gate.
