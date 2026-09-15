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
`tests/read-only-broker.test.js` asserts the backend Python broker layer has no order-placement/account-mutating calls.
**Missing:** make the same source guard an explicit CI job and retain the dashboard route-import assertion.

## 4. Approval signature enforcement — ✅ existing (completed 2026-07-02)
Backend: unsigned/forged proposals rejected (`mcp-accounting.test.js`); dashboard: approvals signed, tamper breaks signature, rejections unsigned (`proposals.test.ts`). Companion logic extracted to `scripts/companion-core.mjs`; `tests/companion-core.test.ts` cross-checks all three signature implementations against the same proposal and tests refusal of unsigned/forged/unverifiable proposals.

## 5. Investor ledger signing — ✅ existing (verification added 2026-07-02)
Signing, seed-owner guard, withdrawal bounds: `tests/investor-ledger.test.js`. Verify-on-read: `lib/ledger-verify.js` + `scripts/verify-ledgers.js` (scheduled daily), tamper detection + Sheet round-trip tested in `tests/ledger-verify.test.js`; audit-row verification included.

## 6. Withdrawal bounds and retry recovery — ✅ local implementation
`tests/investor-ledger.test.js` pins the unit ceiling; dashboard `withdrawal-preview` is covered via `tests/investors.test.ts` math. `tests/withdrawal-commit.test.js` pins the signed immutable plan, retry after a successful Lots write, and fail-closed handling of partial or conflicting lot updates.

## 7. Stale NAV rejection / contribution NAV selection — 🟡 local implementation
Stale-NAV rejection: ✅ (`investor-ledger.test.js`). `tests/contribution-nav.test.js` now pins the strict rule: a post-ledger contribution uses only the latest *prior-date* signed 4:30 PM ET Performance snapshot, while withdrawal valuation uses only the latest signed 4:30 PM ET close and never a newer intraday row. Both fail closed for a missing, duplicate, invalid, or other-intraday row. `tests/mcp-snapshot-provenance.test.js` pins all-or-nothing typed scheduler flags; `tests/operational-ledger.test.js` pins source-invocation HMAC verification.
**Missing:** release verification must prove that the scheduled read-worker forwards its request/invocation pair into the Performance writer, passes the durable-request match, and produces one usable 16:30 receipt; a manual CLI invocation cannot substitute for that operational proof.

## 8. Sheets schema migration — ❌ missing
No tests around `ensureTabs` / `ensureHeadersExtendable` (the recurring cache-hit-skips-migration bug family). Hard to test against live Sheets; a unit test with a stubbed sheets client asserting "existing tab + new header → extend called; blank sheet → delete bundled with adds" would pin the two historical bugs.

## 9. Redis failure behavior — 🟡 partial
`createProposal` with no Redis now logs loudly and returns null (behavior exists; untested). Dashboard fail-closed audit behavior: ✅ `tests/audit-rate-limit.test.ts`.
**Missing:** backend test that Redis-down during `processFills` cannot advance `pm:last-fill-sync-at` past unrecorded fills; test that `listAllProposals` returning `[]` (Redis down) doesn't let sizing treat reserved cash as free.

## 10. Robinhood sync failure handling — ✅ existing (2026-07-07)
Pure core extracted to `lib/fill-processing.js` (`planFillProcessing`); `tests/fill-processing.test.js` covers duplicate-orderId skip, batch dedupe, two-fills-one-proposal, FIFO sell gains, oversell warning (no throw), same-batch BUY→SELL, and lot-update dedupe. Fulfillment-failure isolation stays in the `jobs/holdings-sync.js` wrapper (per-row try/catch, untested — needs a stubbed Redis). Consecutive sync failures now alert: Redis streak + Telegram at 3 in a row (RISK_REGISTER #7).

## 11. Audit fail-closed — ✅ existing
`tests/audit-rate-limit.test.ts` (production audit failure fails request; rate-limit enforcement).
Audit-row HMAC verification and tamper detection are covered by `lib/ledger-verify.js`, the scheduled ledger verifier, and `tests/ledger-verify.test.js`.
**Gap 🟡:** retain a cross-repository payload-drift check because the audit payload format has more than one consumer.

## 12. Execution idempotency (Executing state / reconcile) — 🟡 partial (core covered 2026-07-02)
Decision table extracted to `companion-core.mjs` `decideReconcileAction` and fully tested (`tests/companion-core.test.ts`): found+filled → record; not-found / terminal → retry (+alert); working → wait. Order-instruction side correctness, fabricated-orderId rejection, and the holiday-aware market clock are tested there too.
**Still missing:** the poll-loop wiring itself (lock handling, Executing-marker write ordering) has no harness — would need `claude -p` stubbing.

## 13. Sizing and risk-engine money math — ✅ existing (strong)
`tests/proposal-sizing.test.js` (incremental BUY, SELL by market value, starter sizing, cash caps), `tests/risk-engine.test.js` (confidence missing/clamp, averaging-down, stale data, caps), `tests/tax-lots.test.js` (FIFO), `tests/conviction.test.js`, `tests/data-gates.test.js`, `tests/screener.test.js`, `tests/agent-attribution.test.js`, `tests/exit-signals.test.js`, `tests/indicators.test.js`.

## Priority order for new tests

1. ~~processFills pure-core extraction (#10)~~ — DONE 2026-07-07 (`lib/fill-processing.js` + `tests/fill-processing.test.js`).
2. **Companion poll-loop harness** (#1/#12) — prove the pre-broker `Executing` write and unsigned-approval refusal end to end.
3. **CI source/contract guards** (#3/#11) — keep the read-only Python and audit-payload guarantees continuously enforced.
4. **Scheduled 16:30 NAV end-to-end proof** (#7), Redis-down fill-cursor safety (#9), and schema-migration stubs (#8).
5. **Research correctness regressions** — peer-gated slate persistence, bounded canary accounting, hostile prior-model history, and aggregate receipt anomalies.
