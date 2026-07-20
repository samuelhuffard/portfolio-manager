# Agent Capability Parity Plan

Status: offline foundation only

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

All implementation remains isolated from the production worktree during the
current observation period. Work may be designed, implemented, tested, and
committed locally. It is not merged, pushed into the production branch, or
deployed until the observation window ends or a genuine trust-validity defect
requires an explicitly reviewed reset.

The capability matrix is not an authorization system. It is an honest readiness
test and planning artifact. Production authority remains controlled by the
existing evaluator, risk engine, human approval, deployment, and Phase 0 gates.
