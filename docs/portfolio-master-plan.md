# Portfolio Manager Master Plan

This is the standalone master plan for the portfolio manager system. It is intentionally separate from the Agent One build plan, which blends this architecture with a specific strategy memo.

This document governs the portfolio-manager architecture. Individual agent mandates live in their own strategy files and apply only to that agent unless this master plan explicitly promotes a rule to the system level.

## Goal

Build a portfolio manager where multiple independent investing agents can research, propose, track, and evaluate investment decisions under written mandates.

Each agent should have its own strategy, portfolio state, risk profile, memory, and performance history. Agents may eventually use different model providers, but every agent should operate through the same internal controls: structured proposals, deterministic risk checks, audit logs, and human approval before live execution.

## Core Principle

Agents should not directly trade.

The intended flow is:

1. An agent researches an opportunity.
2. The agent produces a structured investment proposal.
3. The system validates that proposal against rules and portfolio constraints.
4. A human reviews and approves or rejects it.
5. Broker execution only happens after approval.
6. The accounting system records fills, tax lots, NAV, performance, and investor ownership.

The agent proposes. The system validates. The human approves.

## System Rules vs. Agent Rules

The master plan defines the shared control plane:

- No autonomous agent trading.
- Structured proposals.
- Deterministic risk validation.
- Human approval before broker execution.
- Fill matching before accounting.
- Tax lots, NAV, performance, investor ledger, and audit records after execution.
- Isolated prompts, strategy specs, memory, portfolio state, and evaluation history per agent.

Agent-specific rules define only that agent's mandate:

- Investment universe.
- Preferred market caps.
- Position sizing bands.
- Sector or sub-vertical concentration limits.
- Entry gates.
- Exit triggers.
- Research tools.
- Benchmark selection.
- Feedback criteria.

Agent One's updated v5 technology-growth memo governs Agent One only. It should not constrain Agent Two or Agent Three unless those agents later adopt the same rules by explicit decision.

## Target Architecture

The system should include:

- Agents
- Strategy specs
- Portfolios
- Positions
- Cash
- Orders and fills
- Signals and recommendations
- Risk checks
- Performance snapshots
- Investor ledger and NAV/unit accounting
- Tax lots and realized gain tracking
- Audit logs

The important design choice is isolation. Each agent should have separate prompts, strategy files, memory namespaces, watchlists, portfolio state, and evaluation history. Shared market facts are fine, but strategy lessons should stay isolated so agents do not slowly collapse into the same behavior.

## Strategy Contracts

Each agent needs a formal strategy document that is loaded every run and versioned over time.

Each strategy spec should define:

- Mandate
- Allowed investment universe
- Time horizon
- Buy criteria
- Sell criteria
- Risk limits
- Forbidden behavior
- Decision style
- Required evidence

Example shape:

```md
# Agent: Value Compounder

Mandate:
Find high-quality companies trading below conservative intrinsic value.

Universe:
US-listed large and mid-cap equities. No options, crypto, penny stocks, or leveraged ETFs.

Time Horizon:
12-36 months.

Buy Criteria:
- Durable revenue and earnings history
- Strong balance sheet
- Free cash flow positive
- Valuation below historical range or conservative intrinsic value estimate
- Clear downside case

Sell Criteria:
- Thesis broken
- Valuation exceeds target range
- Better risk-adjusted opportunity
- Position breaches risk limits

Risk Limits:
- Max 8% of portfolio in one name
- Max 25% in one sector
- Minimum 10 holdings
- No position without written bear case

Decision Style:
Slow, skeptical, fundamentals-first. Prefer missing upside to accepting unclear downside.
```

## Structured Proposals

Every agent should produce recommendations in a consistent structured format. This makes recommendations auditable, comparable, backtestable, and easy to reject when malformed.

Example proposal:

```json
{
  "agent_id": "value_compounder",
  "recommendation": "buy",
  "ticker": "XYZ",
  "target_weight": 0.05,
  "time_horizon_months": 24,
  "thesis": "...",
  "variant_view": "...",
  "key_metrics": {
    "revenue_growth": "...",
    "fcf_margin": "...",
    "net_debt_to_ebitda": "...",
    "valuation": "..."
  },
  "risks": ["...", "..."],
  "kill_criteria": ["...", "..."],
  "confidence": 0.68,
  "sources": ["..."],
  "strategy_rule_checks": {
    "within_universe": true,
    "risk_limits_ok": true,
    "has_bear_case": true
  }
}
```

## Deterministic Risk Checks

Do not rely on the LLM to police itself. After an agent recommends something, code should check:

- Is the asset in the allowed universe?
- Does target weight exceed max position size?
- Would this create sector concentration?
- Does the agent include a bear case?
- Does the recommendation violate liquidity, volatility, or drawdown rules?
- Is the thesis supported by required data?
- Is the portfolio already too correlated with this idea?
- Is there enough cash or position inventory for the proposed action?
- Does the proposal match the approved order before execution is recorded?

Risk checks should be allowed to downgrade, reject, or require human review. They should not silently expand the agent's authority.

## Capital Scale

Target weights are risk limits and long-run allocation goals. They should not force tiny fractional proposals when the account is still being seeded.

At very small account values, the system may use starter-position sizing instead of strict percentage sizing. For example, a $50 account can reasonably buy one or two approved starter positions rather than treating a 10% target as a $5 order. The agent still needs to clear its normal proposal gates, and the FundManager still approves every trade.

Once the account reaches the configured threshold for an agent, percentage weights become the normal sizing mechanism again. This keeps small-account deployment practical without weakening the larger-account risk framework.

## Agent Memory

Each agent should have its own private memory namespace. Shared market data can be reused across agents, but lessons about behavior and mistakes should belong to one agent unless deliberately promoted to a shared rule.

Memory should store lessons such as:

- Avoid companies where the thesis depends mostly on multiple expansion.
- This strategy tends to overtrade during volatility.
- Past energy picks failed when the thesis relied too heavily on commodity price forecasts.
- Agent tends to overweight narrative; require a numerical valuation anchor.

Example namespaces:

```txt
portfolio-agent:value_compounder:memory
portfolio-agent:macro_rotation:memory
portfolio-agent:quality_growth:memory
```

## Examples And Anti-Examples

Each strategy should include a small library of labeled examples and anti-examples.

Good examples show what fits the strategy. Anti-examples are especially valuable because they teach the agent what not to do.

Example anti-example:

```md
Bad idea:
High-growth software company trading at 30x revenue.

Why rejected:
Even if the business is excellent, this violates the valuation discipline. The agent may track it, but cannot recommend purchase under this mandate.
```

## Feedback Loop

Every recommendation should be tracked over time:

- Recommendation date
- Entry price
- Benchmark price
- Target weight
- Actual allocation
- Agent thesis
- 30/90/180/365-day return
- Max drawdown
- Whether the thesis was right
- Whether timing was wrong
- Whether risk was underestimated
- Whether it outperformed the benchmark

Periodically, an evaluator should review recent recommendations and save specific lessons back into that agent's memory.

Example review prompt:

```md
Review the last 20 recommendations from value_compounder.
Identify recurring mistakes.
Save 3 specific strategy lessons to that agent's memory.
Do not change the core mandate unless approved.
```

## Strategy-Specific Tools

Different agents should have different data and tools because tool access shapes behavior.

A value agent needs financial statements, valuation ratios, free cash flow history, debt metrics, and management commentary.

A macro agent needs rates, inflation, commodities, currencies, sector ETFs, and economic indicators.

A momentum or quality-growth agent needs price trends, relative strength, volume, earnings revisions, profitability, and drawdown controls.

Do not give every agent every tool at first.

## Initial Setup

Start with three agents:

1. Agent One: aggressive technology growth across approved US-listed technology sub-verticals. This is the active strategy governed by `config/agents/agent-1/AGENT-ONE-PLAN.md`.
2. Agent Two: reserved for a separate medium-term strategy, likely macro, regime-aware, ETF/sector rotation, or broader momentum. It should receive its own mandate before deployment.
3. Agent Three: reserved for a separate longer-term strategy, likely structural compounder, valuation-disciplined, or quality-focused. It should receive its own mandate before deployment.

Each gets:

- One strategy markdown file
- One prompt
- One Redis memory namespace
- One portfolio or paper portfolio
- One benchmark
- One weekly review loop
- No autonomous live trading permissions

Agent One's v5 memo may use more aggressive concentration, sizing, and exit rules than Agents Two or Three. That is acceptable because those rules belong to Agent One's strategy contract, not to the master plan.

After 60-90 days of decisions, compare:

- Absolute return
- Benchmark-relative return
- Volatility
- Max drawdown
- Hit rate
- Thesis accuracy
- Rule violations
- Turnover
- Correlation between agents

Use this evidence to decide which agents deserve more capital, better tools, or more autonomy.

## Live Trading Readiness Standard

The system is ready for live trading only when these are true:

- Broker execution is approval-gated.
- Recorded fills are matched against approved proposals.
- Duplicate order IDs cannot double-record trades.
- Buys open tax lots and sells consume FIFO lots.
- NAV, performance, holdings, benchmark comparison, and tax reserve update after fills.
- Investor contributions and withdrawals use NAV/unit accounting.
- The dashboard clearly separates manager-only pooled views from investor-scoped views.
- Audit logs exist for manager actions.
- Old manual or legacy broker paths are disabled unless deliberately invoked.

## Long-Term Direction

Fine-tuning may eventually help with narrow repeatable tasks, such as:

- Classifying whether a company fits a strategy
- Extracting risk factors from filings
- Summarizing earnings calls into a fixed schema
- Rating whether a recommendation followed the mandate

For investment behavior, start with strategy specs, prompt discipline, structured outputs, isolated memory, backtesting, evaluation, and rule-based risk controls. Fine-tuning comes later, if at all.
