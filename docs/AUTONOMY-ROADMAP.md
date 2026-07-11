# Portfolio Manager — Roadmap to Supervised Autonomy

**Goal:** build a professional, observable, and reversible autonomous investment operating system. The near-term destination is a system that can research, allocate, approve, and execute within tested mandates; it is **not** a roadmap to accepting capital or becoming a fund. The long-term fund ambition raises the standard for controls, recordkeeping, attribution, and clarity now.

The operating model is deliberately asymmetric:

- **Agents 1–3 are specialist strategies.** Each researches its versioned mandate and may only create proposals.
- **Agent 4 is the portfolio manager.** It evaluates those proposals in portfolio context, dynamically assigns each strategy a virtual risk/capital budget, accepts or rejects proposals, and authorizes accepted orders for the deterministic execution service.
- **The execution service is mechanical.** It submits only Agent 4-authorized, signed orders and reconciles them to the broker. It never interprets strategy or invents a trade.
- **Sam retains the promotion and emergency authority** until a later evidence-based autonomy level explicitly changes that policy.

## Binding control model

```text
Agent 1 / Agent 2 / Agent 3
  mandate + evidence -> BUY / SELL / HOLD proposal
                              |
                              v
                         Agent 4
  performance + holdings + macro + portfolio risk -> accept / reject
                              |
                              v
                 signed immutable OrderIntent
                              |
                              v
            deterministic executor -> broker -> ledger -> reconciliation
```

### Ownership and authority rules

1. A specialist never executes an order and cannot approve its own proposal.
2. Every BUY creates strategy-owned lot records. **Only the specialist that owns those lots may propose a SELL or reduction.**
3. Agent 4 cannot create a new trade, alter a proposed side/ticker/size, or force a sale. It can accept or reject the specialist's exact proposal within the active policy.
4. Agent 4 may dynamically allocate virtual strategy budgets using attributable performance, current holdings/exposures, mandate fit, and macro/regime evidence. The decision must be explainable, versioned, bounded by hard portfolio limits, and never become simple return chasing.
5. Global deterministic controls can block, shrink, expire, or demote an order; they cannot manufacture a substitute order or bypass strategy ownership.
6. Missing, stale, ambiguous, unsigned, or inconsistent state blocks action loudly. Ledger and broker reconciliation failures immediately return the system to human-supervised mode.

The existing safety invariants remain: downgrade-only risk controls, deterministic gates around model calls, fenced untrusted evidence, pure tested money math, append-only signed ledgers, and the `Executing -> order -> ledger -> fulfilled` sequence with an exact broker reference.

---

## Phase 0 — Stabilize the live supervised system

**Status:** Current. The Phase 0A local work is not yet deployed; its observation clock has not started. Preserve existing WIP and verify runtime health before any diagnosis.

Finish the existing 0A/0B/0C work: fail-closed research and fill attribution, signed ledger reads, truthful degraded-run status, Jetson-owned monitoring/reconciliation, live companion health, budget governance, and a unified manager surface.

**Exit gate:** 10 consecutive trading days after deployment with no missed critical job, ambiguous fill, manual ledger repair, hidden failure, or unsafe client exposure; at least three genuine actionable proposals and one evaluator approval; every holding monitored despite quote failures; health, dashboard, logs, and reconciliation agree.

---

## Phase 1 — Mandate onboarding and proposal ownership

**Goal:** make the incoming Agent 2, Agent 3, and Agent 4 personalities operationally precise before reactivating strategy proposals.

For each specialist mandate, capture and version: universe, horizon, edge hypothesis, benchmark, entry/exit/abstention rules, evidence requirements, liquidity/turnover constraints, position limits, expected regimes, invalidation conditions, and evaluation criteria.

For Agent 4, capture and version: portfolio objective, permitted accept/reject criteria, dynamic allocation inputs, allocation bounds, rebalance cadence, conflict treatment, macro/regime framework, escalation rules, and explanation requirements. Agent 4's mandate must explicitly prohibit forced sales and self-originated trades.

Build the contract required for the model:

- `StrategyProposal` contains mandate/version, thesis, evidence IDs, requested action, requested size, owned-lot references for SELLs, and expiry.
- `StrategyLot` records the originating agent, remaining shares, and realized attribution. A SELL fails closed unless it consumes that agent's owned lots.
- `PortfolioDecision` records Agent 4's accept/reject result, allocation snapshot, portfolio/risk snapshot, explanations, policy version, and signature.
- The dashboard shows proposal lineage, lot ownership, active strategy budgets, Agent 4 decisions, conflicts, and decision rationale as authoritative state—not separate agent chats.

**Exit gate:** all three incoming mandates have a written, testable version; every BUY/SELL proposal and fill can be traced to one strategy and mandate version; Agent 4 cannot authorize an unowned SELL, changed proposal, or self-originated trade; the dashboard can explain every accepted/rejected decision.

---

## Phase 2 — One contract, one pipeline, one financial truth

**Goal:** eliminate cross-runtime schema drift and mutable accounting before authority expands.

- Create shared contracts for mandates, proposals, ownership lots, portfolio decisions, signatures, risk snapshots, broker events, and financial precision.
- Route scheduled research, Lab requests, price alerts, exit signals, and manual requests through the same compiler.
- Use typed state/version checks; invalidation follows material quote, portfolio, mandate, or allocation-policy changes.
- Move canonical accounting to Postgres through an audited dual-write/shadow-read migration; retain Sheets as a read-only reporting projection.
- Use append-only double-entry events, exact broker IDs, idempotency, locks/fencing, backups, restore tests, and broker/order/position reconciliation.

**Exit gate:** no executable proposal bypasses the compiler; schema copies are removed or generated; 30 days of zero unexplained broker/Postgres/Sheet differences; crash-injection and clean restore prove no duplicate order or partial book.

---

## Phase 3 — Portfolio-manager shadow coordination

**Goal:** prove that Agent 4 makes better-coordinated decisions without gaining execution autonomy yet.

- Run all specialists with their mandates; keep their proposals individually attributable.
- Have Agent 4 produce shadow accept/reject decisions and virtual strategy allocations alongside Sam's supervised decisions.
- Measure proposal quality and outcomes by specialist, mandate version, allocation state, market regime, and Agent 4 decision.
- Require Agent 4 to surface—not silently net—duplicate theses, conflicts, concentration, cash pressure, and unowned sell attempts.
- Prevent performance chasing: allocations use a documented rolling evidence window, minimum sample rules, capped change size, drawdown/regime controls, and diversification limits.

**Exit gate:** at least 8–12 weeks plus a meaningful current-version sample (minimum 30 evaluator-graded actionable proposals and 10 filled trades); no ownership violations, accounting incidents, or unresolved reconciliation; Agent 4's shadow decisions are explainable and demonstrably aligned with portfolio limits.

---

## Phase 4 — Bounded Agent 4 autonomy

**Goal:** transition only the approval/authorization role from Sam to Agent 4, in reversible increments.

1. **Shadow manager:** Agent 4 records decisions and allocations; Sam approves every order.
2. **Bounded accepts:** Agent 4 may accept eligible specialist BUYs within strict daily, per-strategy, and portfolio caps; specialist SELL proposals remain human-supervised initially.
3. **Bounded specialist exits:** Agent 4 may accept a SELL only when proposed by the owner strategy and all lot, risk, and reconciliation gates pass.
4. **Full mandate autonomy:** Agent 4 authorizes eligible specialist proposals; Sam supervises health, allocations, performance, and policy versions rather than each trade.

Every promotion requires a written policy version, capital/risk caps, observation window, live rollback drill, and clean evidence at the prior level. A reconciliation, ledger, heartbeat, signature, contract, stale-state, risk, or mandate anomaly immediately demotes to human-supervised mode.

---

## Immediate next milestone — mandates arriving tomorrow

When the Agent 2, Agent 3, and Agent 4 personalities arrive:

1. Convert each into the Phase 1 mandate template; identify every ambiguous rule before code changes.
2. Add the registry/contract/lot-ownership design and tests before re-enabling Agent 2 or 3 proposals.
3. Initially run Agent 4 in shadow-manager mode while Sam remains the final approver.
4. Do not implement autonomous execution, portfolio-wide forced sells, new outside-capital features, or fund structure work while Phase 0 is incomplete.

## Standing session protocol

Before meaningful Portfolio Manager work: read this roadmap, `CLAUDE.md`, `docs/INVARIANTS.md`, `docs/CHANGE_MAP.md`, and `ops/FIXLIST.md`; protect existing WIP; verify runtime evidence; state the phase and exit criterion advanced; add money-math and failure-path tests; obtain independent review before financial/autonomous-write deployment; and update the canonical vault roadmap when reality changes.
