# Agent Capability Parity Plan

Status: offline build; preparing a bounded parity release candidate

Baseline production revision: `3c01d03`

Production effect: none

## Decision

Agents 1, 2, and 3 should have the same **research workflow capability** and the
same **trust controls**. Their mandates should remain different.

Equal capability does not mean that the agents evaluate the same companies,
prefer the same evidence, use the same score weights, hold for the same period,
or follow the same entry and exit rules. It means each agent receives an equally
complete version of the same machinery:

1. broad candidate discovery;
2. a deterministic mandate-specific universe screen;
3. selection rotation, cooldown, exploration, holdings, and event priority;
4. a supported mandate-evidence adapter;
5. deterministic mandate-specific scoring;
6. deterministic entry and sizing enforcement;
7. deterministic holding monitoring;
8. scheduled and recorded re-underwriting;
9. deterministic add-rule accounting;
10. the common proposal, evaluator, risk, approval, ledger, and observation path.

The shared workflow is the skill platform. The screens, evidence definitions,
weights, gates, monitoring cadence, and holding rules are the mandate.

## Current finding

The agents currently share the important supervised trust boundary: human
approval, structured proposals, evaluator review, deterministic risk downgrade,
portfolio circuit breakers, ownership attribution, signed ledgers, and runtime
observation.

They do not yet have equal research skill:

| Capability | Agent 1 | Agent 2 | Agent 3 |
|---|---|---|---|
| Broad catalog discovery | live | fixed watchlist | fixed watchlist |
| Mandate catalog screen | live | missing | missing |
| Rotation/exploration | live | no broad funnel | no broad funnel |
| Mandate evidence adapter | partial shadow | missing | missing |
| Mandate scoring | partial shadow | rules only, inputs unwired | rules only, inputs unwired |
| Deterministic entry rules | partial | partial; red-state/persistence advisory | partial; valuation cascade advisory |
| Holding monitor | partial, Agent 1-only | missing | missing |
| Re-underwrite cadence | incomplete | advisory | advisory |
| Add accounting | partial | partial | one-add counter missing |

This means the current Phase 0 window can still reveal **trust/reliability**
evidence about the supervised system. It cannot support a fair claim that Agents
2 and 3 have demonstrated the same **proposal-generation skill** as Agent 1.

`lib/agent-capability-parity.js` encodes this distinction fail-closed:

- only `deterministic_live` plus `complete` satisfies parity;
- shadow components do not count as live;
- prompt-only rules do not count as deterministic;
- partial components do not count as complete;
- the current snapshot does not claim skill parity;
- a target snapshot can reach parity while preserving three different mandates.

## What stays shared

The following should use one implementation or one common interface for every
agent:

- catalog snapshot and candidate-bus schema;
- evidence provenance, freshness, missing-data, and conflict semantics;
- research packet shape;
- proposal and evaluator contracts;
- downgrade-only risk boundary;
- human approval boundary;
- portfolio circuit breaker;
- lot ownership and fill attribution;
- signed ledger and runtime receipts;
- observation, calibration, and promotion criteria.

## What stays mandate-specific

Each agent should provide its own policy adapter for:

- candidate eligibility and ranking bias;
- required evidence and metric definitions;
- score weights and absolute/peer-relative fallbacks;
- entry and sizing gates;
- macro treatment;
- monitoring and re-underwrite cadence;
- trim and exit conditions;
- add/pyramiding/averaging-down rules;
- expected holding period.

Agent 2 therefore needs deterministic macro red-state and trend-persistence
inputs because those rules define its mandate. Agent 3 needs the valuation
cascade, annual/event re-underwrite state, and lifetime one-add accounting.
Agent 1 does not need those exact rules; it needs equally strong deterministic
implementations of its own short-clock mandate.

## Tomorrow release decision

The earlier plan was to leave production unchanged for the entire initial
observation window. That is no longer the best tradeoff. Only one clean
observation day has accumulated, and that day is useful primarily as supervised
TRUST evidence. It is cheaper and more scientifically honest to improve the
research cohort now than to collect two weeks of nominally comparable Agent
1/2/3 output from unequal discovery systems.

This does not mean deploying unfinished parity work. It means preparing one
bounded, versioned release that materially improves what the next two weeks can
measure, then avoiding repeated policy changes during that cohort.

### What is already local but not deployed

There is substantial local work, but its production value must not be
overstated:

| Local work | Current state | Observation value |
|---|---|---|
| Two commits after deployed `3c01d03` on the primary branch | Committed locally/remotely, but documentation-only release/canary records | Preserve deployment evidence; they add no runtime research capability |
| Legacy proposal-decision memory quarantine | Implemented in the primary worktree; focused and full tests pass | Stops old ticker-specific BUY language from contaminating unrelated research prompts |
| Evidence-alert root-cause grouping | Implemented in the primary worktree; focused and full tests pass | Distinguishes one repeated source problem from several independent evidence incidents |
| Candidate-bus contract and fixtures | Implemented and passing offline tests | Defines equal discovery and lineage, but is inert until a live selector consumes it |
| Evaluator-admission and organic-cohort classifiers | Implemented and passing offline tests | Improves future measurement; remains deliberately disabled in production |
| Dependency-injected positive-path research harness | Implemented and passing offline tests | Proves proposal, revision, rejection, stale-data, duplicate, budget, and queue paths without changing live defaults |
| Generator-degradation outcome taxonomy | Classifier and tests exist; live generator marker is not wired yet | Can separate malformed/truncated generation from a genuine investment HOLD after wiring |
| Athena evidence-package contract | Implemented and passing offline tests | Useful future evidence boundary; does not supply data and should not be activated in this release |
| Capability-parity baseline | Committed on the isolated parity branch | Prevents us from claiming equality based on prompts or shadow-only code |
| Agent 2/3 catalog screens and live candidate-bus wiring | Not implemented | This is the main missing behavior needed for a more representative two-week cohort |

The primary dirty worktree passes **766/766** tests. The larger observation
worktree, including the inert contracts and diagnostic harness, passes
**811/811** tests. Those green suites show that the local work is coherent; they
do not make inert contracts production capabilities.

### Core deployment candidate for tomorrow

The release should contain these items together:

1. **Shared broad discovery for all three agents.** Agents 2 and 3 consume the
   same versioned eligible NYSE/NASDAQ operating-common-equity catalog as Agent
   1. Fixed watchlists become seeds/fallbacks rather than the normal universe.
2. **Pure Agent 2 and Agent 3 catalog screens.** Enforce only rules traceable to
   the canonical mandates and currently supported data. Missing critical fields
   fail closed with stable reason codes. Do not copy Agent 1's technology screen.
3. **Mandate-specific attention ranking.** The shared bus supplies facts, but
   each agent ranks research attention differently. This is not a conviction
   score: Agent 1 emphasizes short-clock velocity, Agent 2 established trend
   persistence, and Agent 3 durable quality/valuation. No unavailable mandate
   metric may be invented merely to fill the slate.
4. **Equal rotation mechanics.** Give every agent cooldown, exploration,
   holdings, triggered-event, and ranked slots. Holdings and mandatory
   re-underwrites remain budget-exempt. A catalog failure must create an
   explicit degraded receipt instead of silently making the fixed list look
   normal.
5. **Prompt-memory quarantine.** Ship the completed exclusion of historic
   proposal decisions from global agent memory. Per-ticker research history
   remains available through the proper ticker-scoped ledger.
6. **Research-funnel telemetry.** Record per agent: catalog visible, eligible,
   screened out, selected by bucket, attempted, data-blocked, generator
   degraded, investment HOLD, risk-downgraded, evaluator rejected, duplicate,
   queue failure, and proposal created. Counts must conserve attempted reviews.
7. **Explicit generator degradation.** Finish wiring parse, truncation, schema,
   and missing-required-field markers so infrastructure/model failures never
   masquerade as investment judgment.
8. **Near-miss observation.** Retain a private, read-only record of the strongest
   non-proposal candidates and their final deterministic blocker—for example
   stale data, missing evidence, risk downgrade, valuation gate, or evaluator
   rejection. It must not create or improve a proposal and must not be presented
   as a recommendation.
9. **Versioned cohort identity.** Every run and observer record identifies the
   catalog snapshot, eligibility policy, per-agent attention policy, mandate,
   prompt, evaluator, outcome classifier, and code revision. This is what lets
   two weeks of results remain comparable.
10. **Per-agent holding-coverage receipt.** Record attributed holdings reviewed,
    degraded, failed, and not applicable. An agent with no attributed holdings
    should say so explicitly rather than appearing silently healthy.
11. **Evidence-alert grouping.** Ship the tested root-cause grouping only after
    confirming that evaluator evidence findings still page immediately and
    distinct poisoned-source incidents still cross the alert threshold.
12. **Per-agent rollback switches.** Candidate-bus activation must be reversible
    independently for Agent 2 and Agent 3 without weakening the human approval,
    risk, ledger, or observer boundaries.

### Stretch items only if complete before the release cutoff

- Deterministically compute Agent 2's SPY 200-day state, 10-year-rate red state,
  50/200-day trend, and relative-volume gate from timestamped inputs already
  available to the system.
- Add read-only coverage telemetry for Agent 2 persistence inputs and Agent 3
  multi-year/valuation inputs, clearly labeled `available`, `stale`,
  `unsupported`, or `policy_unresolved`.
- Add a shadow-only Agent 1/2/3 comparison over the same catalog snapshot,
  measuring selection overlap, sector concentration, evidence age, novelty, and
  displaced candidates without affecting the live slate.

Do not squeeze these into the release if they require guessed thresholds,
unversioned data, or prompt-only substitutes.

### Explicitly excluded from tomorrow's deployment

- Athena activation or a production Athena dependency;
- enabling the future evaluator-admission policy;
- claiming the complete Agent 2/3 mandate evidence adapters are finished;
- special-sector scoring without the approved economic inputs;
- a rushed rewrite of holding exit/re-underwrite behavior;
- raising AI review slots, adding extra daily scans, or increasing the Anthropic
  budget merely to manufacture more proposal attempts;
- any change to signatures, approvals, broker execution, ownership, accounting,
  ledger verification, or circuit-breaker authority.

### Release cutoff and proof

The release is **go** only if:

- all production-relevant files are reconciled onto one clean release branch;
- every active rule has mandate-clause traceability and boundary fixtures;
- the complete backend suite passes from the exact release commit;
- a search proves no inert Athena or future evaluator policy was activated;
- a secret scan is clean;
- shadow/canary runs show all three agents consume the intended catalog and
  produce conserved funnel counts;
- no proposal is created during canary unless it is a genuine organic proposal,
  in which case Sam's personal review and signature remain mandatory;
- budget readiness, protected evaluator/holding capacity, health, logs, Redis,
  ledger verification, parity, sentinel, and rollback are verified;
- the deploy uses the signed restart wrapper and the observer records the new
  release and cohort identities.

This release should increase the opportunity set and make “no proposal” much
more informative. It must not optimize for raw proposal count. A legitimate
zero-proposal day after broad, mandate-specific research is useful evidence; a
BUY that clears weakened gates is not.

## Build order

### P1 — Common discovery interface

Finish the shared candidate-bus/catalog contract already being developed on the
separate `observation-offline-2026-07-16` branch. Feed every agent the same broad
eligible catalog snapshot, then let a mandate adapter screen and rank it.

Acceptance:

- all three agents can consume the same versioned catalog snapshot;
- no agent silently falls back to a fixed list without a visible degraded-state receipt;
- every selection records why the name was eligible, selected, skipped, or displaced;
- holdings and mandatory re-underwrites remain budget-exempt.

### P2 — Agent 2 and Agent 3 catalog screens

Implement pure, deterministic screens from the canonical v3 mandates. Do not
copy Agent 1's technology screen.

Acceptance:

- every rule is traceable to a mandate clause;
- missing critical data fails closed;
- each rejection has a stable reason code;
- historical fixtures cover boundary values and special sectors.

### P3 — Evidence adapters and deterministic scoring

Complete a shared sourced-data packet, then bind it separately to each mandate's
named inputs. Agent 2 needs persistence windows and macro state. Agent 3 needs
multi-year histories and the valuation cascade.

Acceptance:

- no model invents a peer rank, persistence value, valuation history, or special-sector substitution;
- sourced, stale, conflicting, and unavailable evidence are distinct states;
- scores are reproducible from the stored input snapshot;
- incomplete critical evidence cannot become proposal-actionable.

### P4 — Deterministic entry enforcement

Move defining rules out of prompts and into pure policy functions. Keep the model
responsible for synthesis, variant view, causal reasoning, and falsifiable thesis
quality—not arithmetic gates.

Priority gaps:

- Agent 2: dual-red macro stop, moving-average/volume requirements, persistence,
  estimate-history, insider, and dead-money rules;
- Agent 3: valuation cascade/hard gate, structural-quality gates, and normalized
  multi-year requirements;
- Agent 1: finish the remaining mandate entry rules so its own row becomes
  complete rather than merely ahead.

### P5 — Equal holding lifecycle

Replace the Agent 1-only monitor with one shared monitor shell and three mandate
policy adapters.

Acceptance:

- every attributed holding is covered;
- each agent's required daily, weekly, earnings, event, or annual cadence is recorded;
- missed coverage is visible and fail-closed;
- Agent 3's one-add lifetime counter is durable and idempotent;
- exit decisions state attributed shares and preserve cross-agent ownership.

### P6 — Shadow parity cohort

Run all three through the same candidate snapshots and evidence contracts in
shadow mode. Compare coverage, selection diversity, rejection reasons, evidence
completeness, evaluator outcomes, false positives, missed opportunities, and
cost/latency.

Do not compare raw proposal counts as skill. A mandate can correctly produce
fewer proposals.

### P7 — Evidence-gated promotion

Promote each capability through shadow, canary, and supervised live stages using
the same acceptance criteria. Equal trust means equal standards, not automatic
equal authority on the same date.

After the parity release changes the live research workflow, begin a new
post-change **skill-comparison cohort**. Preserve the earlier Phase 0 trust
evidence unless a change touches the signed ledgers, approval boundary, circuit
breaker, ownership, or observer semantics.

## Observation-period rule

Implementation remains isolated until the bounded release above clears its
cutoff. The one existing day remains labeled pre-parity TRUST evidence. The
release opens a new SKILL cohort because discovery, selection, prompt input, and
outcome classification are R1 research-policy changes.

Pure R1 research changes do not erase already-clean TRUST days. If the final
diff also changes S1/S2 behavior or the observer's safety pass/fail meaning,
classify it conservatively, perform one explicit safety reset, and make the next
clean trading day Day 1. With only one accumulated day, one deliberate reset is
preferable to repeated mid-window releases or a misleading two-week cohort.

After the release, freeze the cohort's catalog, policies, prompts, evaluator,
classifier, budgets, and version identities for the planned two-week
observation unless safety requires an emergency repair.

The capability matrix is not an authorization system. It is an honest readiness
test and planning artifact. Production authority remains controlled by the
existing evaluator, risk engine, human approval, deployment, and Phase 0 gates.
