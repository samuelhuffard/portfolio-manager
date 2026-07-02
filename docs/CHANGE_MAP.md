# Portfolio Manager — Change Map

Where to change things, with exact files and the gotchas that have actually bitten. Repos: `portfolio-manager` (backend, this repo) and `../portfolio-dashboard` (dashboard + Mac companion).

## Adding or changing a Google Sheet tab

Files:
- `lib/sheets.js` — add to `TABS` (line ~8), write header constants + reader/writer functions here.
- `../portfolio-dashboard/lib/sheets.ts` — if the dashboard reads it, mirror the schema there (independent hand-written copy).
- Consumers: jobs that read/write the tab.

Gotchas (all real bugs):
- **`ensureTabs` is skipped on Redis cache hits** in some paths — after adding a tab, call `ensureTabs` explicitly in every job that touches it (see `performance-review.js`, `holdings-sync.js` precedents), or run any job once manually to create it.
- Never delete the last sheet in a batch — bundle deletes with adds in one `batchUpdate` (the "can't remove all sheets" provisioning bug).
- Column-order changes are a **cross-repo breaking change**: `sheets.ts` destructures by position (e.g. `REC_DATA_START_ROW = 13` magic numbers exist in both files).
- Extending headers on an existing tab: use `ensureHeadersExtendable` (migrates in place), and remember it writes by row index captured at read time.
- Holdings parsing relies on sentinel strings (`"Cash"`, `"Last synced"`, `"⚠️"`) — don't reformat those rows.

## Changing recommendation / research logic

Files: `jobs/research-scan.js` (orchestration), `lib/quant-scorer.js` (scoring), `lib/ai-overlay.js` (prompt + JSON parse), `lib/risk-engine.js` + `config/agents/<id>/risk-limits.json` (deterministic checks), `lib/screener.js`, `lib/data-gates.js`, `lib/conviction.js`, `lib/evaluator.js` (independent proposal evaluator), `lib/evidence.js` (untrusted-text fencing/redaction), `lib/circuit-breaker.js` (drawdown tiers), `config/weights.json`. Design rationale: `docs/LOOP-DESIGN.md`.

Gotchas:
- Preserve the pipeline shape: cheap gates → AI → deterministic downgrades → **evaluator (downgrade-only, fail-closed, one revision max)** → sizing → human queue. Neither the risk engine nor the evaluator may ever upgrade an action or confidence.
- The circuit breaker is resolved ONCE per scan run (system-wide) before any agent; it restricts (halves/blocks), never authorizes. UNKNOWN tier (no valuation data) blocks BUYs on purpose.
- News/scan text must pass through `sanitizeEvidenceItems` + `fenceUntrusted` before reaching any prompt; the cache stores ORIGINAL text and sanitization runs on every use.
- Anything volatile (cash figures, per-run values) goes in the **user message**, never the cached `system` block — it kills the prompt cache for the rest of the run.
- Model JSON: check `stop_reason === "max_tokens"`; missing fields must FAIL the checks that read them (see the confidence-floor bug).
- New config keys: grep that code actually consumes them — `risk-limits.json` has historically accumulated dead keys.
- Per-ticker code runs inside a try/catch that writes `scan_error` rows — keep new steps inside it.

## Changing proposal approval / execution logic

Files (ALL THREE, always):
- `../portfolio-dashboard/lib/proposals.ts` — canonical schema, validation, decisions, `computeDecisionSignature`.
- `lib/redis.js` (this repo) — backend mirror (`createProposal`, `markProposalFulfilled`, expiry).
- `../portfolio-dashboard/scripts/mac-companion.mjs` — executor's raw JSON handling + mirrored signature function.
- Also: `lib/proposal-signature.js` (backend verify), `lib/mcp-accounting.js` (fill validation), `lib/proposal-sizing.js` (auto-queue sizing/dedupe), `EXECUTION-GUIDE.md` (manual path).

Gotchas:
- **Any field in the signature payload (id/status/agentId/ticker/side/amountDollars/maxPrice/decidedAt/decidedByUserId) is frozen at approval** — changing the payload composition invalidates every outstanding approved proposal and must update all three signature copies at once.
- Status flow: `Pending → ApprovedForBrokerReview | Rejected | Expired`, `executionState: "Executing"` in-flight, `fulfilledAt` terminal. Keep decisions one-way; keep ledger-write-before-fulfill; keep Executing-before-order.
- The companion does blind read-modify-write on the proposal JSON — don't add concurrent writers to the same fields.
- Write BOTH `fulfilledTradeId` and `fulfilledOrderId` (schema-drift bridge).

## Adding a dashboard page

Files: `../portfolio-dashboard/app/<page>/page.tsx`, nav in `components/Sidebar.tsx`, and if Clients may see it: `lib/client-access.ts` (fail-closed allowlist — a page not listed is manager-only by default).
Gotchas: dark "Portfolio OS" terminal theme (`app/globals.css`, `terminal-panel` classes, Sora + JetBrains Mono); handle the backend-offline state (styled error, not a crash); `npm run lint` runs `tsc --noEmit`.

## Adding or modifying dashboard API routes

Files: `../portfolio-dashboard/app/api/<route>/route.ts`.
Every handler starts with `requireApiPermission({ permission, action, request })` — no exceptions (the one route that skipped it became a finding). New audit actions must be added to the `AuditAction` union in `lib/audit.ts`. Rate-limit sensitive mutations via the existing action names in `lib/rate-limit.ts`. Routes proxying to the Jetson (`/api/scan`, `/api/alerts*`) must forward `Authorization: Bearer ${PORTFOLIO_WEBHOOK_SECRET}` — the backend fails closed. `tests/proxy-routes.test.ts` asserts proxy routes keep RBAC — extend it for new proxies.

## Changing RBAC permissions

Files: `../portfolio-dashboard/lib/rbac.ts` (Permission union + `ROLE_PERMISSIONS`), `lib/client-access.ts` (page-level), `tests/rbac.test.ts` + `tests/client-access.test.ts`.
Gotchas: FundManager = Clerk `publicMetadata.role` AND `FUND_MANAGER_EMAILS` (Vercel env) — both, always. Client additions are the dangerous direction; anything touching pooled data stays manager-only (INVARIANTS #4).

## Changing investor ledger / NAV behavior

Files: `lib/investor-ledger.js`, `scripts/record-contribution.js`, `scripts/process-withdrawal.js`, `jobs/holdings-sync.js` (NAV/unit computation), `../portfolio-dashboard/lib/investors.ts` + `lib/withdrawal-preview.ts` (read side).
Gotchas: append-only, HMAC-signed (INVARIANTS #5/#6); the seed-owner guard and stale-NAV rejection are load-bearing — never bypass them "temporarily"; Performance now has 5+ rows/day, so "today's NAV" should mean the 4:30 PM row for contributions; scripts run manually AFTER money moves, never before.

## Changing Robinhood sync behavior

Files: `lib/robinhood-sync.py` (read-only positions/cash/fills), `lib/robinhood-scan.py`, `jobs/holdings-sync.js` (legacy full sync + `processFills`), `scripts/sync-holdings-from-mcp.js` + `lib/portfolio-snapshot.js` (MCP-driven sync), `lib/market-scan-sync.js` (direct robin_stocks scan pull).
Gotchas:
- Python stays read-only forever — no `rh.order_*`. The write path is MCP-only.
- `ROBINHOOD_ACCOUNT_NUMBER` pins the account; robin_stocks silently defaults to `is_default=true` otherwise (was a real wrong-account bug).
- Login volume is rationed deliberately (5 scheduled logins/day) — don't add sync frequency without reading the comment in `scheduler.js`.
- `processFills` must dedupe against Trade Ledger orderIds — both sync paths write the same ledger.
- 150s subprocess timeout exists for the device-approval flow — don't shorten it.

## Changing scheduler cadence

File: `scheduler.js`. Gotchas: research scan runs AFTER the exit monitor on purpose (SELLs queue first); weekly review (Fri 6:30 PM) runs AFTER ledger verify so the week's books are checked before being summarized; update the startup console summary string when times change; no holiday awareness exists yet anywhere.

## Changing the weekly review / agent lessons

Files: `jobs/weekly-review.js` (orchestration + the one LLM call), `lib/weekly-scorecard.js` (pure scorecard math + lesson parsing), `lib/agent-memory.js` (`mergeWeeklyLessons`/`applyWeeklyLessons`), `lib/sheets.js` (`readAgentRecommendationOutcomes`).
Gotchas: lessons are `source: "weekly_review"` memories — they may only evict each other (cap 6), never Sam's chat/manual memories; the dashboard's `AgentMemorySource` union in `../portfolio-dashboard/lib/agentMemory.ts` must include any new source value; malformed lesson JSON yields ZERO lessons (fail closed), never partial garbage.

## Adding tests

Backend: `tests/*.test.js`, node:test, `npm test`. Dashboard: `tests/*.test.ts`, `npm test` (tsx), plus `npm run lint` (= `tsc --noEmit`) and `npm run build`.
Pattern that works here: money math lives in pure functions (`lib/tax-lots.js`, `proposal-sizing.js`, `mcp-accounting.js`, `risk-engine.js`, `investor-ledger.js`) — put new logic in a pure lib, test it, then wire it into jobs. The mcp-accounting test fixture signs proposals with a test secret (`computeDecisionSignature`) — copy that pattern for anything touching approvals. See `docs/TEST_PLAN.md` for the missing-test priority list.

## Cross-repo schema-change checklist (run every time)

1. `grep -rn "<field-or-key>" lib/ jobs/ scripts/` in BOTH repos + `scripts/mac-companion.mjs`.
2. Update `lib/proposals.ts` ↔ `lib/redis.js` ↔ `mac-companion.mjs` together (proposals), or `sheets.js` ↔ `sheets.ts` together (tabs).
3. Update the three signature copies together if the payload changed.
4. Run both test suites; run `npm run build` on the dashboard.
5. Deploy order for breaking Redis-schema changes: writer first only if readers tolerate the new field; otherwise readers first.
