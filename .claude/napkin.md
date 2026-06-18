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
