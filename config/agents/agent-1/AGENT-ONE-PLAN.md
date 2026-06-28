---
date: "2026-06-28"
status: active
agent: agent-1
source: "Agent_One_Master_Plan_v5.docx"
scope: "Agent One only"
---

# Agent One Strategy Specification v5

This file governs Agent One only. The portfolio-wide meta architecture remains in `docs/portfolio-master-plan.md`.

Agent One is the aggressive technology-growth sleeve of the three-agent system. Its rules should not be copied to Agent Two or Agent Three unless those agents explicitly adopt them in their own strategy files.

## Core Boundary

Agent One does not trade.

Agent One researches and proposes. The backend validates. A FundManager approves or rejects. Broker execution happens only after approval, through the configured Robinhood MCP execution path. Accounting records fills only after matching them to approved proposals.

## Mandate

Find the fastest-growing, highest-quality technology companies at any market cap, enter quickly when data confirms the thesis, size based on conviction, and exit when measurable evidence shows the thesis is breaking.

Agent One is allowed to be aggressive on entry, but must be equally fast on exit.

## Universe

Permitted:

- US-listed NYSE/NASDAQ equities.
- Software/SaaS.
- Semiconductors.
- Tech Infrastructure.
- Tech Hardware.
- Tech-Adjacent High-Growth.
- Cash.

Forbidden:

- ADRs.
- OTC stocks.
- Foreign listings.
- ETFs.
- Options.
- Leverage or margin.
- Averaging down into losing positions.
- Reclassifying a losing trade as a long-term hold.
- Opening a new position when critical data is missing or stale.

Market-cap posture:

- No hard market-cap restriction.
- Small and mid-cap are preferred hunting grounds.
- Micro-cap is allowed only when average daily dollar volume is at least $3M.
- Large-cap is allowed when the growth profile is exceptional.

## Entry Gates

Before any BUY proposal, Agent One must clear:

- Approved universe check.
- Data freshness check.
- Liquidity check.
- Balance-sheet health check.
- Price structure check.
- Macro/growth regime check.
- Conviction score floor.
- Kill criteria present.

The v5 growth-regime gates are:

- QQQ above its 200-day moving average.
- IGV and/or SOX showing positive relative strength versus SPY over 60 trading days.
- 10-year Treasury yield not rising more than 50 bps over the prior 30 trading days.
- Semiconductor cycle check for semis.

If all three primary regime gates fail at once, Agent One should suspend all new entries until at least two clear.

## Conviction And Position Sizing

Position sizing is conviction-based, not equal-weight.

- Tier 1, 85-100 score: 10-15% of portfolio at entry.
- Tier 2, 65-84 score: 5-10%.
- Tier 3, 45-64 score: 2-5%.
- Below 45 with full data: NO_TRADE.
- Below 35 with partial data: no new entry; use partial-data exit rules for existing holdings.

Hard limits:

- Max position at entry: 15%.
- Rebalance review flag: 18%.
- Minimum position: 2%; below that, close rather than maintain dust.
- Max sub-vertical concentration: 75%.
- Cash reserve: 5-10% in normal conditions.

### Starter Account Sizing

When Agent One is still being seeded with a very small account value, strict percentage weights are too small to be useful. Below $500 of total account value, target weights are treated as long-run risk guidance, not literal order sizing.

For starter accounts below $500:

- Use at most two starter positions.
- Keep roughly 10% cash unless the FundManager deliberately overrides.
- Size each new starter BUY around half of deployable value.
- Require the same universe, data, conviction, and kill-criteria gates as normal.
- Do not use starter sizing to add aggressively to an existing position; adds revert to percentage sizing.
- Resume normal percentage sizing once total account value is at least $500.

Example: with $50 funded, Agent One may propose one or two starter BUYs of roughly $22.50 each instead of a 10-15% target-weight order of $5-$7.50.

## Required Proposal Shape

Every proposal should include:

- `agent_id`.
- `recommendation`: BUY, SELL, HOLD, or NO_TRADE.
- `ticker`.
- `target_weight`.
- `time_horizon_months`.
- Falsifiable thesis.
- Variant view.
- Conviction score and tier.
- Key metrics.
- Data completeness.
- Missing data fields, if any.
- Risks.
- At least two kill criteria.
- Sources.
- Strategy rule checks.

Malformed or incomplete proposals should be rejected before FundManager review.

## Continuous Monitoring

Daily:

- Price action.
- RSI.
- MACD.
- Relative volume.
- News and SEC filing alerts.
- ATR stop levels.

Weekly:

- Full metric rescore.
- ATR drawdown check.
- Relative strength versus the relevant growth-tech benchmark.
- Position size versus conviction tier.
- Missing-data counter.

On earnings:

- Full re-underwriting.
- EPS/revenue actuals versus consensus.
- NRR or substitute margin trend.
- Billings.
- Guidance.
- Analyst revisions.
- Ownership flow.

On material event:

- Immediate unscheduled review.

## Exit Rules

Agent One exits quickly. It does not average down and it does not convert broken trades into long-term holds.

Primary exit triggers:

- ATR-based price deterioration from recent 20-day high.
- Momentum deterioration: RSI below 40 and falling, MACD bearish confirmation, or relative strength deterioration.
- Fundamental deterioration: EPS/revenue miss greater than 5%, guidance cut, margin compression without credible reinvestment rationale, significant institutional plus insider selling, accounting restatement, unexpected CFO departure, or material adverse SEC filing.

NRR staged exit rules for recurring-revenue businesses:

- NRR below 115%: trim 25% when original thesis depended on best-in-class NRR.
- NRR below 105%: trim 50% or reduce to Tier 3 max size.
- NRR below 100%: full exit unless revenue is still accelerating and management gives credible, time-bound recovery evidence.

For semiconductors and hardware, gross margin trend substitutes for NRR where NRR is not meaningful.

## Partial-Data Defensive Rules

Missing data is a risk signal.

- New entry with missing critical data: NO_TRADE.
- Existing holding with missing key data: cannot increase.
- Available data score below 35: full exit permitted.
- Available data score 35-50: partial exit 30-50%.
- Available data score above 50 with no triggers: HOLD and flag missing fields.
- Two consecutive reviews with missing critical data: auto-reduce to maximum 5%.

## Portfolio Drawdown Circuit Breakers

These are Agent One v5 portfolio-level rules and should be backend-enforced before live scale:

- 8% drawdown from peak: pause new buys for 5 trading days.
- 12% drawdown: reduce all Tier 3 positions by 50%; no new buys.
- 15% drawdown: raise cash to at least 20%; no new buys.
- 20% drawdown: suspend new activity pending full strategy review.

## Current Runtime Alignment

Implemented now:

- Approval-gated proposal flow.
- MCP fill matching before accounting.
- FIFO tax lots and realized gain tracking.
- NAV/performance/holdings/tax reserve snapshot update after MCP sync.
- Agent One v5 allowed sub-vertical classifier.
- Micro-cap ADDV floor.
- Large-cap permission.
- 15% max entry cap.
- 75% sub-vertical concentration cap.
- 5-10% normal cash reserve config.
- Stale/missing data NO_TRADE gate for new entries.
- No averaging down.
- Basic conviction sizing clamp.
- Held-position exit monitor for T1/T2/T3-style SELL/TRIM proposals.
- Manager approval queue.
- Audit/RBAC boundary in the dashboard.

Specified but not fully implemented yet:

- Full QQQ/IGV/SOX/10-year macro regime gate.
- Semiconductor cycle gate.
- Exact ATR 1.5x/2.0x/2.5x recent-high ladder.
- NRR ingestion and staged NRR exits.
- Consecutive missing-data counter with forced 5% max reduction.
- Portfolio drawdown circuit breakers at 8/12/15/20%.
- Full margin/guidance/credibility-event fundamental exit automation.

Until those gaps are closed, Agent One can be funded only in the limited sense of small, manager-supervised capital with human review of every proposal. It should not be treated as a fully autonomous or fully v5-complete strategy.
