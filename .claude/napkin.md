# Napkin Runbook

## Curation Rules
- Re-prioritize on every read.
- Keep recurring, high-value notes only.
- Max 10 items per category.
- Each item includes date + "Do instead".

## Execution & Validation (Highest Priority)
1. **[2026-06-18] Investor ledger changes need money-math tests**
   Do instead: run `npm test` after changing contributions, withdrawals, NAV, investor IDs, or ledger signing.
2. **[2026-07-11] Robinhood scheduled sync requires a configured TOTP secret**
   Do instead: keep `ROBINHOOD_TOTP_SECRET` nonempty and `ROBINHOOD_STORE_SESSION=false`; restore MFA directly on the Jetson, then prove freshness with read-only reconciliation and holdings sync.

## Domain Behavior Guardrails
1. **[2026-07-11] Unattributed lots are quarantined until explicitly resolved**
   Do instead: require a signed, auditable assignment or manual/reconciled exit policy before a strategy may consume a legacy `unattributed` lot; never silently use it as ownership top-up.
2. **[2026-07-11] Strategy ownership governs exits**
   Do instead: record the originating agent on every BUY lot; permit a SELL proposal only from that agent, while Agent 4 may accept/reject the exact proposal but cannot create or force an exit.
3. **[2026-07-11] Agent 4 is a bounded portfolio manager**
   Do instead: use versioned, explainable performance/holding/macro inputs with hard allocation limits; keep Agent 4 unable to originate or mutate trades until its shadow evidence earns promotion.
4. **[2026-06-18] Backend is read-only with Robinhood**
   Do instead: keep `robinhood-sync.py` limited to holdings/cash reads and search for `rh.order_` before Robinhood-related changes.
5. **[2026-06-18] Contributions record confirmed transfers only**
   Do instead: keep `record-contribution.js` as accounting for money already received/sent, never as a money-movement command.
6. **[2026-06-29] Pending proposals are competing alternatives**
   Do instead: let all agents create pending proposals against the shared cash pool; only accepted, unfilled BUY proposals reserve cash.
7. **[2026-06-29] Backend reads durable agent memories**
   Do instead: pull global `pm:agent-memory:<agentId>:global` memories into `research-scan.js` so proposal generation reflects Sam's durable feedback.
