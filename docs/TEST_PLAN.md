# Portfolio Manager — Test Plan

Status of the tests that matter most, prioritized by "would this catch a catastrophic mistake." Legend: ✅ existing · 🟡 partial · ❌ missing. Backend suite: `npm test` (node:test, `tests/*.test.js`, 88+). Dashboard suite: `npm test` (`tests/*.test.ts`, 36+), plus `npm run lint` (tsc) and `npm run build`.

## 1. Client isolation — ✅ existing
`tests/rbac.test.ts`, `tests/client-access.test.ts`, `tests/investors.test.ts`, `tests/projections.test.ts` (dashboard). Clients can't reach pooled views, `portfolio:full` is manager-only, investor matching is userId-first.
**Gap:** no live signed-in Client smoke test against production (needs a real Clerk session — manual checklist item, not automatable cheaply).

## 2. Proposal immutability / one-way decisions — ✅ existing
`tests/proposals.test.ts`: decided proposals can't be re-decided, expired can't be decided, expiry math. `tests/mcp-accounting.test.js`: already-fulfilled fills rejected.
**Gap 🟡:** no test that `updateProposalFields` (edits) refuses non-Pending proposals — verify and pin that behavior.

## 3. No trade execution endpoints/wording — 🟡 partial
`tests/red-lines.test.ts` (wording/route patterns), `tests/proxy-routes.test.ts` (proxy routes keep RBAC).
**Missing:** CI-level grep asserting `rh.order_` appears nowhere in Python; a test that no `app/api` route imports any order-placing capability. Cheap and worth adding.

## 4. Approval signature enforcement — ✅ existing (completed 2026-07-02)
Backend: unsigned/forged proposals rejected (`mcp-accounting.test.js`); dashboard: approvals signed, tamper breaks signature, rejections unsigned (`proposals.test.ts`). Companion logic extracted to `scripts/companion-core.mjs`; `tests/companion-core.test.ts` cross-checks all three signature implementations against the same proposal and tests refusal of unsigned/forged/unverifiable proposals.

## 5. Investor ledger signing — ✅ existing (verification added 2026-07-02)
Signing, seed-owner guard, withdrawal bounds: `tests/investor-ledger.test.js`. Verify-on-read: `lib/ledger-verify.js` + `scripts/verify-ledgers.js` (scheduled daily), tamper detection + Sheet round-trip tested in `tests/ledger-verify.test.js`; audit-row verification included.

## 6. Withdrawal bounds — ✅ existing
`tests/investor-ledger.test.js` (can't withdraw more units than held); dashboard `withdrawal-preview` covered via `tests/investors.test.ts` math.

## 7. Stale NAV rejection / current NAV selection — 🟡 partial
Stale-NAV rejection: ✅ (`investor-ledger.test.js`).
**Missing:** with 5 Performance rows/day, no test pins WHICH intraday row a contribution uses. Decide (4:30 PM row), implement, test.

## 8. Sheets schema migration — ❌ missing
No tests around `ensureTabs` / `ensureHeadersExtendable` (the recurring cache-hit-skips-migration bug family). Hard to test against live Sheets; a unit test with a stubbed sheets client asserting "existing tab + new header → extend called; blank sheet → delete bundled with adds" would pin the two historical bugs.

## 9. Redis failure behavior — 🟡 partial
`createProposal` with no Redis now logs loudly and returns null (behavior exists; untested). Dashboard fail-closed audit behavior: ✅ `tests/audit-rate-limit.test.ts`.
**Missing:** backend test that Redis-down during `processFills` cannot advance `pm:last-fill-sync-at` past unrecorded fills; test that `listAllProposals` returning `[]` (Redis down) doesn't let sizing treat reserved cash as free.

## 10. Robinhood sync failure handling — ✅ existing (2026-07-07)
Pure core extracted to `lib/fill-processing.js` (`planFillProcessing`); `tests/fill-processing.test.js` covers duplicate-orderId skip, batch dedupe, two-fills-one-proposal, FIFO sell gains, oversell warning (no throw), same-batch BUY→SELL, and lot-update dedupe. Fulfillment-failure isolation stays in the `jobs/holdings-sync.js` wrapper (per-row try/catch, untested — needs a stubbed Redis). Consecutive sync failures now alert: Redis streak + Telegram at 3 in a row (RISK_REGISTER #7).

## 11. Audit fail-closed — ✅ existing
`tests/audit-rate-limit.test.ts` (production audit failure fails request; rate-limit enforcement).
**Gap 🟡:** audit rows' HMACs never verified (same as #5) — no tamper-detection test possible until a verifier exists.

## 12. Execution idempotency (Executing state / reconcile) — 🟡 partial (core covered 2026-07-02)
Decision table extracted to `companion-core.mjs` `decideReconcileAction` and fully tested (`tests/companion-core.test.ts`): found+filled → record; not-found / terminal → retry (+alert); working → wait. Order-instruction side correctness, fabricated-orderId rejection, and the holiday-aware market clock are tested there too.
**Still missing:** the poll-loop wiring itself (lock handling, Executing-marker write ordering) has no harness — would need `claude -p` stubbing.

## 13. Sizing and risk-engine money math — ✅ existing (strong)
`tests/proposal-sizing.test.js` (incremental BUY, SELL by market value, starter sizing, cash caps), `tests/risk-engine.test.js` (confidence missing/clamp, averaging-down, stale data, caps), `tests/tax-lots.test.js` (FIFO), `tests/conviction.test.js`, `tests/data-gates.test.js`, `tests/screener.test.js`, `tests/agent-attribution.test.js`, `tests/exit-signals.test.js`, `tests/indicators.test.js`.

## Priority order for new tests

1. ~~processFills pure-core extraction (#10)~~ — DONE 2026-07-07 (`lib/fill-processing.js` + `tests/fill-processing.test.js`).
2. **Signature triple-implementation cross-check** (#4) — protects execution authority.
3. **Ledger verify-on-read script + tamper test** (#5/#11).
4. **Reconcile decision table** (#12) — needs the same companion extraction as #2.
5. `rh.order_` grep + no-execution-route assertions (#3) — one-line CI insurance.
6. NAV row selection (#7), Redis-down fill-cursor safety (#9), schema-migration stubs (#8).
