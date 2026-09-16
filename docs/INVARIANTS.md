# Portfolio Manager — Invariants

Rules that must never be broken. Real family money flows through this system; each rule below exists because its violation either lost money in testing, nearly did, or would be unrecoverable. For each: why, where it's enforced, what tests protect it, what's missing.

## 1. No automatic trade execution without a signed, human approval

**Why:** the entire trust model. Agents research and propose; only Sam (FundManager) authorizes; only then does the executor touch the broker.
**Enforced:**
- No dashboard route can place an order (there is no execution endpoint; `lib/red-lines.ts` additionally blocks trade wording/routes as an advisory layer).
- `scripts/mac-companion.mjs` `verifyApprovalSignature` — refuses any proposal without a valid `decisionHmac` before contacting the broker.
- `lib/mcp-accounting.js` `validateMcpFillInput` → `lib/proposal-signature.js` `assertApprovedProposalSignature` — refuses to record unsigned/forged fills.
- Backend Python (`lib/robinhood-sync.py`, `robinhood-scan.py`) is read-only — **grep check: `rh.order_` must return nothing**.
**Tests:** `tests/mcp-accounting.test.js` ("refuses unsigned or forged approval signatures"), dashboard `tests/red-lines.test.ts`, `tests/proposals.test.ts` (signature attach/verify), and `tests/read-only-broker.test.js` (the backend Python layer contains no order-placement/mutating calls and keeps session persistence opt-in).
**Missing:** companion poll-loop coverage remains cross-repository work; it must continue to prove that an unsigned approval cannot reach its broker invocation.

## 2. Proposals are not orders

**Why:** approval records authorization; execution and accounting are separate, individually verified, reconcilable steps. Merging them removes every safety net at once.
**Enforced:** status machine `Pending → ApprovedForBrokerReview → (fulfilledAt)` with `executionState: "Executing"` as the in-flight marker; `applyProposalDecision` throws on re-deciding; fulfillment happens only after the ledger write (`recordAndFulfill` in mac-companion, ordering in `jobs/holdings-sync.js` `processFills`).
**Tests:** `tests/proposals.test.ts` (one-way decisions, expiry), `tests/mcp-accounting.test.js` (already-fulfilled rejection, orderId dedupe).
**Missing:** no test of the Executing→reconcile path; no test that fulfillment is blocked when the ledger write fails.

## 3. Execution idempotency ordering

**Why:** the duplicate-trade bug (fixed 2026-07-01) — order placed, crash before bookkeeping, blind re-execution with real money.
**Enforced:** mac-companion writes `executionState: "Executing"` BEFORE placing; passes `ref_id = proposal.id` so the broker deduplicates; stuck-Executing proposals are reconciled against `get_equity_orders`, never re-executed blindly. `EXECUTION-GUIDE.md` mandates the same ref_id convention for manual sessions.
**Tests:** the dashboard companion core has a reconcile-decision table test; backend fill-accounting tests independently reject mismatched, duplicate, unsigned, and oversize fill records.
**Missing:** companion poll-loop wiring (lock handling and the exact pre-broker `Executing` write) still needs an end-to-end harness.

## 4. Clients must never see pooled-fund views

**Why:** outside investors see only their own stake; pooled data leaks other people's money.
**Enforced:** `lib/rbac.ts` (Client = `portfolio:read`+`signals:read` only; `portfolio:full` is FundManager-only), `lib/client-access.ts` (fail-closed page allowlist), `lib/investors.ts` (Clerk userId → ledger investorId matching, verified-email fallback), `lib/projections.ts` (manager-only field stripping). FundManager requires role metadata AND `FUND_MANAGER_EMAILS` membership.
**Tests:** `tests/rbac.test.ts`, `tests/client-access.test.ts`, `tests/investors.test.ts`, `tests/projections.test.ts`.
**Missing:** a live signed-in Client smoke test (never run — requires a real Clerk client session).

## 5. Investor ledger and Trade Ledger are append-only and signed

**Why:** unit ownership and tax lots are reconstructed from these rows; silent edits corrupt everyone's stake.
**Enforced:** code only appends (`appendInvestorLedgerEntry`, `appendTradeLedgerEntries`); investor rows carry `rowHmac` (`lib/investor-ledger.js`, `INVESTOR_LEDGER_HMAC_SECRET`); `record-contribution.js` refuses unsigned unless `ALLOW_UNSIGNED_INVESTOR_LEDGER=true`; seed-owner guard prevents silently absorbing pre-existing value; withdrawals bounded by units held. Before a withdrawal mutates any money state it writes an HMAC-signed immutable plan to Withdrawal Operations; retries replay it exactly and fail closed on a partial/conflicting lot state. `process-withdrawal.js` is the ONLY withdrawal writer — `record-contribution.js --withdraw` was removed because it appended an Investors withdrawal row with no plan, no Trade Ledger rows and no tax-lot reconciliation; it now refuses and points at the right command. A ledger whose matched rows carry two different stable investor IDs refuses rather than pooling their units. `lib/ledger-verify.js` and the scheduled `scripts/verify-ledgers.js` recompute and verify investor/audit HMACs.
**Tests:** `tests/investor-ledger.test.js` (signing, seed-owner, stale NAV, withdrawal bounds), `tests/withdrawal-commit.test.js` (plan replay and partial-write refusal), and `tests/ledger-verify.test.js` (round-trip and tamper detection).

## 6. NAV/unit math uses current data unless explicitly overridden

**Why:** contributions at a stale NAV transfer value between investors invisibly.
**Enforced:** for a post-ledger contribution, `record-contribution.js` selects the latest date strictly before the deposit date and requires exactly one signed `16:30` ET Performance snapshot for that date. Withdrawal valuation likewise selects only the latest date's signed `16:30` close; it never falls through to a newer intraday row. A provenance-bearing snapshot is written only after its request ID and invocation ID match the durable scheduler-created `holdings-sync` request; it refuses a same-day or intraday fallback. The first seed entry remains a separate bootstrap path.
**Tests:** `tests/investor-ledger.test.js` (stale-NAV rejection), `tests/contribution-nav.test.js` (only the 16:30 snapshot, duplicate/missing/invalid rejection, strict prior-date selection, and withdrawal close selection), `tests/mcp-snapshot-provenance.test.js` (complete typed request/invocation flags only), and `tests/operational-ledger.test.js` (source-invocation HMAC tamper rejection).
**Missing:** this is locally implemented but not yet release-verified through the dashboard read-worker on a real scheduled 16:30 request. The external accounting-policy decision to use the strict prior close rather than same-day close remains recorded for Sam's confirmation.

## 7. Auth, audit, and signature checks fail CLOSED

**Why:** `if (!SECRET) return true` shipped the backend effectively unauthenticated. A missing env var must degrade to "refuse," never "allow."
**Enforced:** `server.js` `auth()` returns false without `PORTFOLIO_WEBHOOK_SECRET` (timingSafeEqual); dashboard `requireApiPermission` fails closed at every layer; production audit-write failure fails the request (`AUDIT_ENFORCE`); `applyProposalDecision` refuses to approve in production without `AUDIT_HMAC_SECRET`; `assertApprovedProposalSignature` refuses without a secret unless `ALLOW_UNSIGNED_PROPOSALS=true`.
**Tests:** dashboard `tests/audit-rate-limit.test.ts`, `tests/proxy-routes.test.ts` (routes must keep RBAC); backend signature tests.
**Missing:** no test for `server.js` auth behavior (unset secret → 401, wrong secret → 401); no test that production approval without the secret throws.

## 8. Secrets are never logged or committed

**Why:** one leaked `.env` = Robinhood login + Redis (= proposal queue) + Anthropic billing.
**Enforced:** `.gitignore`/`.vercelignore` cover `.env*`, `credentials.json`, `.clerk/`; holdings-sync logs no portfolio totals; secrets moved via `printf`/pipes in ops; `docs/RUNBOOK.md` codifies it.
**Tests:** none automated.
**Missing:** a pre-commit/CI secret scan (gitleaks or a grep script). Until then: manual `git status` + diff scan before every push (CLAUDE.md rule).

## 9. Robinhood session storage stays disabled

**Why:** a persisted robin_stocks session pickle on disk is a stealable full login.
**Enforced:** `robinhood-sync.py` defaults `store_session=False`; only `ROBINHOOD_STORE_SESSION=true` (deliberate) changes it. Jetson `.env` has it explicitly `false`.
**Tests:** `tests/read-only-broker.test.js` pins the opt-in session-storage policy in both Python broker-read scripts.
**Missing:** environment drift remains an operational concern; verify the Jetson setting by presence/value policy without printing any secret.

## 10. The AI can only ever be downgraded, never upgraded

**Why:** the model is an untrusted reasoner over partially untrusted inputs (news, scan text, memory). Deterministic gates before it, deterministic checks after it.
**Enforced:** `lib/data-gates.js` NO_TRADE before the call; `lib/risk-engine.js` only moves actions toward HOLD, clamps weights, fails missing confidence; sizing caps by cash and $10k; the queue is still human-gated after all of that.
**Tests:** `tests/risk-engine.test.js` (incl. missing-confidence and clamp tests), `tests/data-gates.test.js`, `tests/proposal-sizing.test.js`, `tests/screener.test.js`, evidence-fencing tests, and prompt-history regressions.
**Missing:** injection detection is necessarily heuristic. New source types must be fenced and covered by a hostile-input regression before reaching either model; deterministic gates remain the authority boundary even if the model parrots hostile text.

## 11. Shared schema changes ship to all copies at once

**Why:** the proposal schema lives in `portfolio-dashboard/lib/proposals.ts` (canonical), `portfolio-manager/lib/redis.js`, and `scripts/mac-companion.mjs`; the signature payload in three files; Sheet schemas in `sheets.js` + `sheets.ts`. Drift here caused real bugs (`fulfilledTradeId` vs `fulfilledOrderId`).
**Enforced:** by convention + comments only.
**Tests:** none cross-repo.
**Missing:** the real fix is a shared contracts package (risk register #8). Until then: grep both repos + companion for every schema-touching change (CHANGE_MAP has the checklist).
