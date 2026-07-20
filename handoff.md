# Handoff

## Goal

Replace the broken unattended Robinhood Python login with a safe, read-only MCP sync, then restart the Phase 0 autonomy observation window from fresh evidence.

## Current State

The migration is committed, pushed, independently reviewed **SHIP**, and deployed: backend `e4e173e`, companion `6dc8a3f`. Jetson queues typed `holdings-sync`/`order-reconciliation` requests; the authenticated Mac companion claims them and has exact read-only MCP allowlists. Every account-scoped tool call is verified from Claude `stream-json` to include the configured `ROBINHOOD_ACCOUNT_NUMBER`; a model's final text alone is insufficient. Snapshot retries are idempotent and request IDs are HMAC-bound to Performance rows.

## Files in Flight

- Backend: `jobs/mcp-read-requests.js`, `scheduler.js`, MCP input/snapshot/ledger files, contracts, tests, and `docs/{RUNBOOK,ARCHITECTURE,AUTONOMY-ROADMAP}.md`.
- Dashboard: `scripts/mac-companion.mjs`, generated contract mirror, MCP policy test.
- Preserve unrelated backend WIP: `docs/CHANGE_MAP.md` and `config/agents/_TEMPLATE-STRATEGY-SPEC.md`.

## Verification

Backend `npm test`: 371/371 passed. Dashboard MCP policy tests and syntax checks pass; prior full dashboard suite: 94/94, lint/predeploy clean. Production smoke passed both read-only jobs; all signed ledgers verify clean (Performance 40/40, Trade 1/1, Lots 1/1, Investors 5/5, Audit 2,586 rows).

## Failed Attempts

Do not restore a TOTP secret or use cached Robinhood sessions: this account uses device approvals/SMS/passkeys. Do not ship a prompt-only account selection—the MCP sync must retain the trace-based account binding.

## Next Step

Begin the five-trading-day Phase 0 supervised-workflow observation window on the next clean trading day. Review MCP receipts, companion/Jetson logs, and daily parity evidence; retain the separate requirement for three genuine actionable proposals and one evaluator approval, and do not grant Agent 4 authority or cut canonical reads to Postgres.
