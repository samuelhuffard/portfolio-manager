# Portfolio Manager — Invariants

Rules that must never be broken. Real family money flows through this system; each rule below exists because its violation either lost money in testing, nearly did, or would be unrecoverable. For each: why, where it's enforced, what tests protect it, what's missing.

## 1. No automatic trade execution without a signed, human approval

**Why:** the entire trust model. Agents research and propose; only Sam (FundManager) authorizes; only then does the executor touch the broker.
**Enforced:**
- No dashboard route can place an order (there is no execution endpoint; `lib/red-lines.ts` additionally blocks trade wording/routes as an advisory layer).
- `scripts/mac-companion.mjs` `verifyApprovalSignature` — refuses any proposal without a valid `decisionHmac` before contacting the broker.
- `lib/mcp-accounting.js` `validateMcpFillInput` → `lib/proposal-signature.js` `assertApprovedProposalSignature` — refuses to record unsigned/forged fills.
- Backend Python (`lib/robinhood-sync.py`, `robinhood-scan.py`) is read-only — **grep check: `rh.order_` must return nothing**.
**Tests:** `tests/mcp-accounting.test.js` ("refuses unsigned or forged approval signatures"), dashboard `tests/red-lines.test.ts`, `tests/proposals.test.ts` (signature attach/verify).
**Missing:** no test that the companion's poll loop refuses an unsigned proposal (companion has no test harness at all); no CI grep for `rh.order_`.

## 2. Proposals are not orders

**Why:** approval records authorization; execution and accounting are separate, individually verified, reconcilable steps. Merging them removes every safety net at once.
**Enforced:** status machine `Pending → ApprovedForBrokerReview → (fulfilledAt)` with `executionState: "Executing"` as the in-flight marker; `applyProposalDecision` throws on re-deciding; fulfillment happens only after the ledger write (`recordAndFulfill` in mac-companion, ordering in `jobs/holdings-sync.js` `processFills`).
**Tests:** `tests/proposals.test.ts` (one-way decisions, expiry), `tests/mcp-accounting.test.js` (already-fulfilled rejection, orderId dedupe).
**Missing:** no test of the Executing→reconcile path; no test that fulfillment is blocked when the ledger write fails.

## 3. Execution idempotency ordering

**Why:** the duplicate-trade bug (fixed 2026-07-01) — order placed, crash before bookkeeping, blind re-execution with real money.
**Enforced:** mac-companion writes `executionState: "Executing"` BEFORE placing; passes `ref_id = proposal.id` so the broker deduplicates; stuck-Executing proposals are reconciled against `get_equity_orders`, never re-executed blindly. `EXECUTION-GUIDE.md` mandates the same ref_id convention for manual sessions.
**Tests:** none (companion untested).
**Missing:** a companion test harness stubbing `claude -p`; at minimum a unit test of the reconcile decision table (found/filled, found/terminal, not-found, still-working).

## 4. Clients must never see pooled-fund views

**Why:** outside investors see only their own stake; pooled data leaks other people's money.
**Enforced:** `lib/rbac.ts` (Client = `portfolio:read`+`signals:read` only; `portfolio:full` is FundManager-only), `lib/client-access.ts` (fail-closed page allowlist), `lib/investors.ts` (Clerk userId → ledger investorId matching, verified-email fallback), `lib/projections.ts` (manager-only field stripping). FundManager requires role metadata AND `FUND_MANAGER_EMAILS` membership.
**Tests:** `tests/rbac.test.ts`, `tests/client-access.test.ts`, `tests/investors.test.ts`, `tests/projections.test.ts`.
**Missing:** a live signed-in Client smoke test (never run — requires a real Clerk client session).

## 5. Investor ledger and Trade Ledger are append-only and signed

**Why:** unit ownership and tax lots are reconstructed from these rows; silent edits corrupt everyone's stake.
**Enforced:** code only appends (`appendInvestorLedgerEntry`, `appendTradeLedgerEntries`); investor rows carry `rowHmac` (`lib/investor-ledger.js`, `INVESTOR_LEDGER_HMAC_SECRET`); `record-contribution.js` refuses unsigned unless `ALLOW_UNSIGNED_INVESTOR_LEDGER=true`; seed-owner guard prevents silently absorbing pre-existing value; withdrawals bounded by units held.
**Tests:** `tests/investor-ledger.test.js` (signing, seed-owner, stale NAV, withdrawal bounds).
**Missing:** **signatures are never verified on read** — tampering with the Sheet is currently undetected. A verify pass (recompute + `timingSafeEqual` over all rows) is the top missing guardrail (see TEST_PLAN #4). Same gap for audit rows (`lib/audit.ts`).

## 6. NAV/unit math uses current data unless explicitly overridden

**Why:** contributions at a stale NAV transfer value between investors invisibly.
**Enforced:** `record-contribution.js` rejects a non-current Performance row unless `--nav-date=YYYY-MM-DD` or `--allow-stale-nav` is passed deliberately.
**Tests:** `tests/investor-ledger.test.js` (stale-NAV rejection).
**Missing:** "latest row for the day" is ambiguous now that holdings sync runs 5×/day — no test pins which intraday row is used; contributions should prefer the 4:30 PM row (TEST_PLAN #7).

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
**Tests:** none.
**Missing:** trivial unit/py test asserting the default; env-drift check in RUNBOOK covers it operationally.

## 10. The AI can only ever be downgraded, never upgraded

**Why:** the model is an untrusted reasoner over partially untrusted inputs (news, scan text, memory). Deterministic gates before it, deterministic checks after it.
**Enforced:** `lib/data-gates.js` NO_TRADE before the call; `lib/risk-engine.js` only moves actions toward HOLD, clamps weights, fails missing confidence; sizing caps by cash and $10k; the queue is still human-gated after all of that.
**Tests:** `tests/risk-engine.test.js` (incl. missing-confidence and clamp tests), `tests/data-gates.test.js`, `tests/proposal-sizing.test.js`, `tests/screener.test.js`.
**Missing:** prompt-injection fencing for news/scan text is not implemented (risk register #5); no test that a prompt-injected "BUY, confidence 1" still hits every deterministic gate.

## 11. Shared schema changes ship to all copies at once

**Why:** the proposal schema lives in `portfolio-dashboard/lib/proposals.ts` (canonical), `portfolio-manager/lib/redis.js`, and `scripts/mac-companion.mjs`; the signature payload in three files; Sheet schemas in `sheets.js` + `sheets.ts`. Drift here caused real bugs (`fulfilledTradeId` vs `fulfilledOrderId`).
**Enforced:** by convention + comments only.
**Tests:** none cross-repo.
**Missing:** the real fix is a shared contracts package (risk register #8). Until then: grep both repos + companion for every schema-touching change (CHANGE_MAP has the checklist).
