# Portfolio Manager — Research Decision Register

> **Narrow authority: investment-policy decisions.** Accepted answers here bind
> implementation inside their scope. The canonical phase order, current status,
> and promotion/reset gates live in [the master plan](portfolio-master-plan.md).

**Rev 2026-07-13 · primary-reviewer decisions and unresolved investment-policy inputs**

This register prevents executor models from inventing rules. Accepted decisions may be implemented. Open decisions block only the packets named under “Blocks”; unrelated packets may proceed.

## Accepted decisions

### D-001 — Canonical specialist mandates

- **Decision:** Agent 1/2/3 v3 files under `agent_mandates/` are canonical at version `3.0`.
- **Reason:** They explicitly define universe, peer fallback, data handling, output, and authority boundaries.
- **Implementation:** add explicit machine-readable mandate metadata; do not parse version from Markdown at runtime.
- **Blocks cleared:** E1.1, E1.4, E2.1, E3.1.

### D-002 — Agent 1 target universe versus current production restriction

- **Decision:** v3’s target is sector-agnostic across eligible NYSE/NASDAQ operating-company common equities. The current technology-subvertical screen remains a temporary production restriction until Phase 2 gates pass.
- **Reason:** This honors the canonical mandate without prematurely exposing unimplemented special-sector economics.
- **Implementation:** status/observations must record both `mandateUniverseVersion` and active `productionUniversePolicyVersion`.
- **Blocks cleared:** architecture and coverage work. Live screen removal remains gated.

### D-003 — Agents 2/3 authority during migration

- **Decision:** retain current `supervised` proposal eligibility for their existing static-watchlist research. Do not expand them to catalog sourcing until canonical proposal lineage, evidence adapters, and canary evidence pass.
- **Reason:** Human approval preserves the immediate boundary; returning to paper-only is not necessary for the current narrow source, but expansion without lineage would compound governance debt.
- **Blocks cleared:** Phase 1–4 data work. Phase 5 catalog activation remains gated.

### D-004 — Durable research store

- **Decision:** Postgres is the append-only research record; Redis is latest-view/status cache only.
- **Reason:** Research history must outlive TTLs and retain point-in-time provenance.
- **Blocks cleared:** E1.1–E1.6.

### D-005 — Partial-score use

- **Decision:** store partial scores; compare them only inside identical coverage/version cohorts; never make them proposal-actionable unless thesis-critical fields are present and at least 80 points are available.
- **Reason:** This matches v3 rescaling rules and avoids treating coverage arrival as edge.
- **Current effect:** the first Agent 1 EDGAR adapter is research-only because it exposes fewer than 80 available points.
- **Blocks cleared:** E1.1–E3.3.

### D-006 — Score-change eligibility

- **Decision:** only economic causes (`filing`, `market`, `estimate`, `ownership`) may compete for AI review. Coverage, peer-set, restatement, version, retry, and initial observations remain shadow telemetry.
- **Blocks cleared:** event collection and shadow selection in E3.1–E4.2. Q-005 still blocks positive-canary and live event eligibility.

### D-007 — Nightly sequencing

- **Decision:** one workflow lock/run ID chains refresh → enrichment → peers → scores → events → shadow selection. Separate cron times are removed once the workflow exists.
- **Blocks cleared:** E1.5/E1.6.
- **Implementation note:** the prerequisite-gated ordered workflow is verified in the local worktree. It is not deployed or activated, and this note is not runtime proof.

### D-008 — Proposal-lineage architecture

- **Decision:** keep immutable `StrategyProposal` records separate from live allocation proposals. Live proposals reference `strategyProposalId` and `strategyProposalFingerprint`. A versioned approval signature v2 binds the fingerprint to the authorized trade.
- **Compatibility:** legacy v1 proposals remain readable. After the cutover, new system and manual proposals must have canonical lineage and signature v2. Outstanding v1 approvals are allowed only through their existing expiry or are deliberately rejected before enforcement.
- **Reason:** separates research truth from mutable lifecycle bookkeeping while cryptographically binding the approved trade to its lineage.
- **Blocks cleared:** ADR/design for E5.1–E5.4 only. Implementation remains blocked until the exact signature-v2 signed payload is frozen and outstanding v1 approvals are inventoried with an explicit expire/reject/migrate disposition; implementation is then high-risk and separately reviewed.

### D-009 — Selection rollout

- **Decision:** shadow → bounded canary → live. Holdings and mandatory exits are never displaced. Rollback is a config change to shadow mode.
- **Blocks cleared:** E4.1 and the shadow-recording portion of E4.2. Positive canary and live selection remain gated on Q-005, observed shadow evidence, and explicit promotion review.

## Open decisions requiring Sam/investing-partner input

### Q-008 — Agent 3 long-term selection policy

- Rank the durable-business, valuation, balance-sheet, profitability/returns,
  moat, capital-allocation, and momentum inputs; identify any hard
  requirements.
- Define the acceptable evidence for a weak-price-trend entry, valuation
  premium, company profile, and review cadence. This must never become a
  proposal quota.
- **Blocks:** Agent 3's distinct shadow selection/scoring policy and any later
  promotion beyond the current shared scoring configuration.

### Q-001 — Agent 1 balance-sheet definitions

- Define `isProfitable`, `isPreProfit`, `netCash`, and `netDebtEbitda` from approved EDGAR concepts.
- Specify EBITDA fallback order, treatment of negative EBITDA, zero debt, financial companies, and cash restricted by operations.
- **Blocks:** E2.3 balance-sheet completion and Agent 1 proposal-actionable scoring.

### Q-002 — Current-estimate freshness

- Define the maximum acceptable age of a “current” free-source estimate snapshot for new entries and holdings.
- **Blocks:** estimate freshness/actionability, not EDGAR data collection.

### Q-003 — Entry quote and relative-volume freshness

- Define maximum quote age and whether premarket/after-hours timestamps qualify for proposal creation.
- **Blocks:** exact entry actionability, not historical scoring.

### Q-004 — Consensus and 13F completeness policy

- Confirm whether these remain temporarily optional under the v3 ≥80-point rescale rule or whether either is thesis-critical for any agent/sector.
- **Blocks:** full completeness/actionability policy for E2.3/E2.4.

### Q-005 — Score-event materiality thresholds

- Define per-agent absolute score delta, rank delta, or metric-specific event thresholds.
- Recommended method: calibrate in shadow from observed delta distributions before freezing thresholds.
- **Blocks:** E3.1 live materiality policy and E4 canary, not event collection.

### Q-006 — Cash-challenger policy

- Define deployable-cash measure, threshold, idle duration, regime exceptions, challenger count, alert cooldown, and evaluation horizon.
- **Blocks:** E6.1/E6.2 only.

### Q-007 — Backtest cost assumptions

- Confirm base and stressed spread/slippage assumptions by liquidity bucket and tax treatment scope.
- **Blocks:** populated net-return fields, final historical results, and any net-edge claim. It does not block pure outcome math, additive persistence, or aggregate-safe report structure when those surfaces keep costs explicitly unavailable.

## Decisions reserved for later evidence gates

- Shadow-to-canary promotion date and slot count.
- Canary-to-live selection promotion.
- Exact signature-v2 signed payload and the reviewed disposition of every outstanding v1 approval before E5 enforcement.
- Ownership and production cadence for E7 outcome maturation.
- Postgres money-read cutover.
- Agent 4 authority promotion.
- Any statement that a strategy or system demonstrates edge.
