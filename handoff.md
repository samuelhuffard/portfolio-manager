# Handoff

## Goal

Replace the broken unattended Robinhood Python login with a safe, read-only MCP sync, then restart the Phase 0 autonomy observation window from fresh evidence.

## Current State

The migration is implemented locally in `portfolio-manager` and `portfolio-dashboard`, independently reviewed **SHIP**, and not yet committed, pushed, or deployed. Jetson queues typed `holdings-sync`/`order-reconciliation` requests; the authenticated Mac companion claims them and has exact read-only MCP allowlists. Every account-scoped tool call is now verified from Claude `stream-json` to include the configured `ROBINHOOD_ACCOUNT_NUMBER`; a model's final text alone is insufficient. Snapshot retries are idempotent and request IDs are HMAC-bound to Performance rows.

## Files in Flight

- Backend: `jobs/mcp-read-requests.js`, `scheduler.js`, MCP input/snapshot/ledger files, contracts, tests, and `docs/{RUNBOOK,ARCHITECTURE,AUTONOMY-ROADMAP}.md`.
- Dashboard: `scripts/mac-companion.mjs`, generated contract mirror, MCP policy test.
- Preserve unrelated backend WIP: `docs/CHANGE_MAP.md` and `config/agents/_TEMPLATE-STRATEGY-SPEC.md`.

## Verification

Backend `npm test`: 371/371 passed. Dashboard MCP policy test passes via Node type stripping; prior full dashboard suite: 94/94, lint/predeploy clean. `git diff --check` and companion syntax checks clean. Full dashboard rerun is constrained by sandbox `tsx` IPC, not a test failure.

## Failed Attempts

Do not restore a TOTP secret or use cached Robinhood sessions: this account uses device approvals/SMS/passkeys. Do not ship a prompt-only account selection—the MCP sync must retain the trace-based account binding.

## Next Step

Commit the exact migration files in each repo, scan staged files for secrets, push/deploy both sides, then run one real **read-only** MCP smoke and verify account trace, one idempotent snapshot, receipt freshness, and report-only reconciliation before starting the new 10-trading-day observation window.
