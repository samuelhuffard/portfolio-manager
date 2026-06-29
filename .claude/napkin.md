# Napkin Runbook

## Curation Rules
- Re-prioritize on every read.
- Keep recurring, high-value notes only.
- Max 10 items per category.
- Each item includes date + "Do instead".

## Execution & Validation (Highest Priority)
1. **[2026-06-18] Investor ledger changes need money-math tests**
   Do instead: run `npm test` after changing contributions, withdrawals, NAV, investor IDs, or ledger signing.

## Domain Behavior Guardrails
1. **[2026-06-18] Backend is read-only with Robinhood**
   Do instead: keep `robinhood-sync.py` limited to holdings/cash reads and search for `rh.order_` before Robinhood-related changes.
2. **[2026-06-18] Contributions record confirmed transfers only**
   Do instead: keep `record-contribution.js` as accounting for money already received/sent, never as a money-movement command.
3. **[2026-06-29] Pending proposals are competing alternatives**
   Do instead: let all agents create pending proposals against the shared cash pool; only accepted, unfilled BUY proposals reserve cash.
4. **[2026-06-29] Backend reads durable agent memories**
   Do instead: pull global `pm:agent-memory:<agentId>:global` memories into `research-scan.js` so proposal generation reflects Sam's durable feedback.
