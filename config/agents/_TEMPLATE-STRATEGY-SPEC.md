---
date: "YYYY-MM-DD"
status: draft            # draft → active. Stays draft until mandate + ownership tests pass.
agent: agent-N
source: "<incoming-doc-filename>"
scope: "Agent N only"
---

# Agent N Strategy Specification vX

> TEMPLATE. Copy to `config/agents/agent-N/AGENT-<NAME>-PLAN.md` and fill every
> section from the incoming personality/mandate. This is the FULL, versioned spec
> (the human-readable source of truth). The **compact** version the runtime
> actually loads each scan lives in `config/agents/agent-N/personality.md` — keep
> the two consistent; if they disagree, the compact `personality.md` is what the
> model sees. Do NOT invent investment rules the friend did not supply — mark
> anything missing as an explicit open question at the bottom.

This file governs Agent N only. Its rules must not leak into other agents unless
those agents adopt them in their own strategy files. The portfolio-wide meta
architecture stays in `docs/roadmaps/portfolio-master-plan.md`.

## Core Boundary

Agent N does not trade. It researches and proposes structured BUY / SELL / HOLD /
NO_TRADE recommendations. The backend validates, a FundManager approves or rejects,
and broker execution happens only after approval through the Robinhood MCP path.
(Same for every specialist — do not weaken this.)

## Mandate

<One-paragraph edge hypothesis: what inefficiency this strategy exploits, entry
posture, sizing posture, exit posture. This is the single most load-bearing
paragraph — the evaluator grades "mandate fit" against it.>

## Universe

Permitted:
- <asset classes / sectors / sub-verticals / market-cap posture>

Forbidden:
- <instrument types, behaviors — e.g. ADRs, OTC, ETFs, options, leverage, averaging down, reclassifying losers as holds>

Market-cap posture:
- <hard limits / preferred hunting grounds / liquidity floors, e.g. micro-cap ADDV minimum>

> Universe wiring note: until this section is real, keep `universe.json` at
> `source: "watchlist"`. Flipping to `source: "catalog"` requires a mandate-specific
> screen function (agent-1's is `screenUniverse`); agents 2/3 have no catalog screen
> yet, so catalog mode without one screens nothing useful. See CHANGE_MAP →
> "Onboarding a specialist mandate".

## Entry Gates

Before any BUY proposal, Agent N must clear:
- <ordered list of gates: universe check, data freshness, liquidity, balance-sheet/quality, price structure, regime/macro, conviction floor, kill criteria present, ...>

## Conviction And Position Sizing

- <tier → score band → target-weight range>
- Hard limits: max entry %, rebalance-review flag %, minimum position %, max sector/sub-vertical concentration %, cash-reserve rule.
- Starter-account behavior below $500 (if applicable): <how percentages relax>.

## Required Proposal Shape

Every proposal includes: `agent_id`, `recommendation`, `ticker`, `target_weight`,
`time_horizon_months`, falsifiable thesis, variant view, conviction score + tier,
key metrics, data completeness, missing-data fields, risks, **≥2 kill criteria**,
sources, strategy rule checks. Malformed/incomplete proposals are rejected before
FundManager review. (This shape is shared across agents — do not shrink it.)

## Continuous Monitoring

Daily / Weekly / On-earnings / On-material-event review cadence and the specific
signals each triggers. <fill from mandate>

## Exit Rules

Primary exit triggers (price / momentum / fundamental). Staged-trim rules. What
justifies a full exit vs a trim vs a review-only flag. <fill from mandate>

## Partial-Data Defensive Rules

How missing/stale data changes behavior (new entry, existing holding, forced
reductions on repeated missing data). <fill from mandate>

## Portfolio Drawdown Circuit Breakers

Note: drawdown breakers are enforced system-wide by `lib/circuit-breaker.js` on
NAV/unit (8/12/15/20% tiers), not per agent. Record here only if this mandate
specifies agent-specific tiers, and confirm whether they're enforced or advisory.

## Current Runtime Alignment

- Implemented now: <which clauses are actually enforced in code>
- Specified but not implemented: <clauses that are prose-only today>

Every clause must be classifiable as **enforced**, **deliberately advisory**, or
**not-yet-built**. Until the enforced set is adequate, Agent N stays `paper`
(propose-only, no execution eligibility) in `config/agents.js`.

## Open Questions For The Author

- <anything ambiguous or missing in the incoming doc — do not guess; ask.>
