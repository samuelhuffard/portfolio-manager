# Portfolio Manager — Risk Register

Remaining risks after the 2026-07-01 audit fixes, ranked by (severity × likelihood). Each has concrete mitigation steps. Re-rank when one is closed.

## 1. ~~No broker-vs-ledger reconciliation job~~ — MITIGATED 2026-07-02, residual LOW

Daily reconciliation now runs from the companion after close (4:35 PM ET): read-only `get_equity_orders` for the day → `scripts/reconcile-orders.js` diffs filled orders against Trade Ledger orderIds → Telegram on any miss (report-only; fixing the books stays human). `lib/reconcile.js` + `tests/reconcile.test.js`.
**Residual:** order-level only — no position-vs-Holdings diff yet; depends on the Mac being awake by end of day (a missed day is caught the next run only if orders fall in that day's window — consider widening `created_at_gte` to 3 days).

## 2. ~~Write-only integrity HMACs~~ — MITIGATED 2026-07-02, residual LOW

`scripts/verify-ledgers.js` (`npm run ledgers:verify`) now recomputes every Investors-tab rowHmac and the last 7 days of audit-row HMACs, `timingSafeEqual`, Telegram on mismatch. Scheduled daily 6:00 PM ET in `scheduler.js`. `lib/ledger-verify.js` + `tests/ledger-verify.test.js` (round-trip + tamper detection).
**Residual:** the audit-HMAC format is mirrored from dashboard `lib/audit.ts` by hand (same drift class as #8); Trade Ledger/Lots rows are still unsigned (reconciliation #1 covers their integrity indirectly).

## 3. Execution depends on Sam's laptop being awake — HIGH severity, HIGH likelihood (mitigated, not fixed)

The companion is the only executor. Mac asleep = approved proposals sit. Heartbeat + approvals-page banner (shipped 2026-07-01) make it *visible*, not *solved*. `isMarketOpen()` also ignores market holidays — it will happily execute on Thanksgiving.
**Mitigate:** Telegram alert when an approved proposal is unexecuted >30 min during market hours (companion or backend cron); add a holiday calendar to `isMarketOpen()`; long-term, move execution to an always-on host once Robinhood MCP auth allows it.

## 4. LLM-parsed execution results — MEDIUM-HIGH severity, MEDIUM likelihood

The companion regexes JSON out of `claude -p` stdout; a hallucinated `{"ok":true, orderId...}` would be recorded as a fill (validation catches ticker/side/amount mismatches but not a plausible fabrication). Reconciliation (#1) is the systemic backstop.
**Mitigate:** switch companion invocations to `claude -p --output-format json` with strict schema; cross-check the reported orderId against `get_equity_orders` before recording (one extra read call); ship #1.

## 5. Prompt injection via news/scan/memory text — MEDIUM severity, MEDIUM likelihood — **PARTIALLY CLOSED 2026-07-02**

Tavily article text, Robinhood scan descriptions, and extracted agent memories flow into the proposal-generating prompt. A poisoned article can bias proposals (can't execute anything — human gate + risk engine hold — but can flood the queue with attacker-chosen tickers and pollute memory over time).
**Done 2026-07-02:** `lib/evidence.js` — deterministic instruction-pattern scan redacts suspicious news/scan text before any model sees it (Telegram on flag); remaining text is fenced in per-run `UNTRUSTED-*` boundary tokens the system prompt declares data-only; the generator reports `suspect_evidence`; the independent evaluator (`lib/evaluator.js`) re-checks for parroted instruction-like content and leans REJECT.
**Still open:** agent memories extracted from chat are injected unfenced (they originate from Sam, lower risk); pattern list is best-effort by nature — periodic human review of `pm:agent-memory:*` still applies; no ticker allowlist for proposals.

## 6. Google Sheets concurrency + human editability — MEDIUM severity, MEDIUM likelihood

Two writers full-rewrite Holdings (`clear`+`update` — a read landing in between sees an empty portfolio → weights computed as 0); lot updates write by row index captured at read time (a human sorting the Sheet corrupts lots); Performance gets 5+ rows/day making "today's NAV" ambiguous; the Sheet is simultaneously database and human-editable artifact.
**Mitigate:** short-term — never hand investors edit access; single-writer windows (companion sync vs scheduled sync already rarely collide); prefer 4:30 PM row for NAV. Long-term (the real fix): Postgres/Supabase as system of record, Sheets demoted to one-way export.

## 7. Legacy Python Robinhood sync fragility — MEDIUM severity, HIGH likelihood

robin_stocks login breaks regularly (device-approval challenges, re-auth); the fill-check failed live on 2026-07-01. It's now redundant with the MCP path for fills but still load-bearing for scheduled Holdings/NAV freshness.
**Mitigate:** decide explicitly: either retire scheduled Python sync in favor of MCP-driven syncs (companion cron) or keep it and alert on consecutive failures (currently it just logs). Remove `checkForNewFills` dead code. Track consecutive-failure count in Redis and Telegram after 3.

## 8. Triplicated contracts / schema drift — MEDIUM severity, HIGH likelihood over time

Proposal schema ×3, signature payload ×3, Sheet schemas ×2, agent registry ×4+, status enums ×2, expiry logic ×2. Every past cross-repo bug came from this.
**Mitigate:** short-term — CHANGE_MAP checklist (grep all copies). Real fix — extract a shared `contracts` package (Zod schemas + Redis key builders + agent registry) consumed by backend, dashboard, and companion; monorepo when convenient.

## 9. Redis unbounded growth + single shared instance — LOW-MEDIUM severity, HIGH likelihood (slow)

Orphaned `pm:approval_proposal:{id}` bodies survive list trimming forever; `research:report:{id}` same; `pm:audit:{date}` adds an immortal list daily. Shared instance with Jordan/Aide means one leaked token spans systems, and `agents:*:chat` doesn't even use the `pm:` prefix.
**Mitigate:** TTLs — decided proposals 30d after decision, reports 90d, audit 400d; delete bodies on trim; migrate chat keys under `pm:`; eventually a dedicated Redis for money-adjacent keys.

## 10. Legal/fiduciary exposure of pooled outside money — severity depends entirely on scale

Pooling friends' money into a unitized fund is regulated territory (investment club vs pooled vehicle vs adviser) regardless of code quality. Software cannot mitigate this one.
**Mitigate:** keep it tiny and friends-only until Sam gets real legal/tax advice; keep the ledger + audit trail immaculate (it's the evidence of good faith); manual tax split documented per the 2026-06-28 note.

## 11. Env/deployment drift across four surfaces — LOW severity, MEDIUM likelihood

Local Mac, Jetson, Vercel, and the companion's cascading env loading each hold overlapping secrets; the audit found the *local* clone missing the webhook secret while assuming the Jetson was. `.env.example`s are now accurate (2026-07-01) but will drift again.
**Mitigate:** RUNBOOK env table is the source of truth — update it in the same commit as any new env var; `/health` `deps` block now surfaces missing config on the Jetson; add the same presence-check habit (`grep -c`) per machine before diagnosing.

## 12. Agent One v5 mandate gaps — LOW severity (documented), LOW likelihood of surprise

Known-unimplemented: macro regime gate (QQQ/IGV/SOX/10Y), semi cycle gate, exact ATR ladder, NRR ingestion/staged exits, consecutive missing-data counter, portfolio drawdown circuit breakers (8/12/15/20%), margin/guidance credibility-event automation. Also: config keys referenced nowhere (`rebalanceFlagPct`, `prohibitLossToHold`, `maxCashReservePct`), agents 2/3 lack `blockOnStaleData`/`prohibitAveragingDown`, memo says ≥2 kill criteria but code accepts 1.
**Mitigate:** keep the gap list in `config/agents/agent-1/AGENT-ONE-PLAN.md` current; when implementing any v5 item, add its config key AND the code that reads it in one commit; give agents 2/3 the same risk-limit keys before they ever run real money.
