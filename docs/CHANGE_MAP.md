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

Files: `jobs/research-scan.js` (orchestration), `lib/quant-scorer.js` (scoring), `lib/ai-overlay.js` (prompt + JSON parse), `lib/risk-engine.js` + `config/agents/<id>/risk-limits.json` (deterministic checks), `lib/screener.js`, `lib/data-gates.js`, `lib/conviction.js`, `lib/evaluator.js` (independent proposal evaluator), `lib/evidence.js` (untrusted-text fencing/redaction), `lib/circuit-breaker.js` (drawdown tiers), `config/agents/<id>/weights.json`, `lib/athena.js` (optional Athena dossier evidence, env-gated). Design rationale: `docs/LOOP-DESIGN.md`.

## Changing universe discovery / candidate selection

Files: `lib/universe.js` (NYSE/NASDAQ listing parse + Redis catalog shapes), `jobs/universe-refresh.js` (nightly listing/quotes/sector-enrichment crawler, 7:30 PM ET cron), `lib/candidate-slate.js` (pure daily slate: holdings → movers → ranked → exploration), `lib/research-ledger.js` (per-agent memory of researched names; drives rotation + the overlay's prior-research line), `config/agents/<id>/universe.json` (`source: "catalog" | "watchlist"`, `slateSize`, `aiReviewBudget`, `researchCooldownDays`, `explorationSlots`), Redis helpers in `lib/redis.js` (`pm:universe:*` chunked catalog, `pm:research-ledger:<agentId>`).

Gotchas:
- `aiReviewBudget` is the cost guardrail on Anthropic spend — holdings are exempt (a held name is always reviewed), everything else competes for the budget. Don't add an unbudgeted path to `toReview`.
- Catalog entries use short field names (`t/n/x/s/i/v/mc/advd/p/c52/qa/ea`) because the catalog is chunk-stored under Upstash request-size limits — keep new fields short and update `toScreenerCandidates`.
- `advd` is average daily DOLLAR volume (price × 3-month share volume), matching what `screenUniverse` expects — don't store raw share volume.
- The catalog/ledger are advisory discovery data: money paths must never read them, and their absence must degrade to the seed watchlist LOUDLY (console.error), never silently.
- A data-gate NO_TRADE is still recorded in the research ledger — otherwise a permanently-gated name occupies an exploration slot forever.

Gotchas:
- Preserve the pipeline shape: cheap gates → AI → deterministic downgrades → **evaluator (downgrade-only, fail-closed, one revision max)** → sizing → human queue. Neither the risk engine nor the evaluator may ever upgrade an action or confidence.
- The circuit breaker is resolved ONCE per scan run (system-wide) before any agent; it restricts (halves/blocks), never authorizes. UNKNOWN tier (no valuation data) blocks BUYs on purpose.
- News/scan text must pass through `sanitizeEvidenceItems` + `fenceUntrusted` before reaching any prompt; the cache stores ORIGINAL text and sanitization runs on every use.
- Anything volatile (cash figures, per-run values) goes in the **user message**, never the cached `system` block — it kills the prompt cache for the rest of the run.
- Anthropic prompt-cache proof lives in Redis `pm:anthropic-usage:<YYYY-MM-DD>` via `lib/anthropic-usage.js`; check `cacheReadInputTokens` and `cacheCreationInputTokens` before claiming caching is working or changing prompt structure.
- Model JSON: check `stop_reason === "max_tokens"`; missing fields must FAIL the checks that read them (see the confidence-floor bug).
- New config keys: grep that code actually consumes them — `risk-limits.json` has historically accumulated dead keys.
- Per-ticker code runs inside a try/catch that writes `scan_error` rows — keep new steps inside it.

## Changing proposal approval / execution logic

> **Shared contract (Phase 1):** single-source in `contracts/` (canonical here), mirrored to `../portfolio-dashboard/lib/contracts/` by `npm run contracts:sync`; `tests/contracts-drift.test.ts` (dashboard) enforces byte-equality. Edit in `contracts/` only, then sync. Now shared: proposal enums/limits/ticker-rule/`validateProposalInput` (`contracts/proposal.js`); the **decision-signature payload + HMAC** (`contracts/signature.js` — all three sites below now delegate to it, so the payload composition is no longer hand-copied); strategy-lot ownership (`contracts/lot.js`). The full `AllocationProposal` **shape** is still declared as a TS interface in `proposals.ts` + built by hand in `redis.js` `createProposal`, but drift is now caught by `tests/proposal-shape.test.ts` (field-set parity vs `ProposalSchema`) — if you add/rename a field, update both and that test keeps them honest. The list below still applies to shape/status-flow logic.

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

File: `scheduler.js`. Gotchas: research scan runs AFTER the exit monitor on purpose (SELLs queue first); weekly review (Fri 6:30 PM) runs AFTER ledger verify so the week's books are checked before being summarized; update the startup console summary string when times change. Market-dependent jobs pass `MARKET_DAY_ONLY` to `wrapJob` and skip full-day NYSE holidays via `lib/market-calendar.js` (computed, not a static list) — new market jobs must pass it too; verify-ledgers/weekly-review/system-sentinel deliberately run on holidays. The dashboard companion's `isMarketOpen()` still has NO holiday awareness (see RISK_REGISTER #2).

## Changing the weekly review / agent lessons

Files: `jobs/weekly-review.js` (orchestration + the one LLM call), `lib/weekly-scorecard.js` (pure scorecard math + lesson parsing), `lib/agent-memory.js` (`mergeWeeklyLessons`/`applyWeeklyLessons`), `lib/sheets.js` (`readAgentRecommendationOutcomes`).
Gotchas: lessons are `source: "weekly_review"` memories — they may only evict each other (cap 6), never Sam's chat/manual memories; the dashboard's `AgentMemorySource` union in `../portfolio-dashboard/lib/agentMemory.ts` must include any new source value; malformed lesson JSON yields ZERO lessons (fail closed), never partial garbage.

## Changing the system sentinel / sysloop

Files: `lib/sysloop/*` (pure checks — unit-test with fixtures in `tests/sysloop.test.js`), `jobs/system-sentinel.js` (Jetson Tier 0), `scripts/sysloop-{mac,triage,weekly,shared}.mjs` (Mac tiers). Design doc: `docs/SYSTEM-LOOP-PLAN.md`. Gotchas: sysloop Redis writes MUST stay inside `pm:sysloop:*` (enforced by `redisGuardSet` — don't bypass it); new checks go in `checks.js` as pure functions taking injected inputs, gathering goes in `snapshot.js`; the `claude -p` invocations in `sysloop-shared.mjs` must keep `--strict-mcp-config` and the read-only `--allowedTools` list; new expected Sheet headers come from `SYSLOOP_EXPECTED_HEADERS` in `sheets.js` (references the writer constants — never copy header strings). Deploy: backend to Jetson as usual, plus `pm2 restart portfolio-sysloop` on the Mac (runs from this repo's working tree).

## Adding tests

Backend: `tests/*.test.js`, node:test, `npm test`. Dashboard: `tests/*.test.ts`, `npm test` (tsx), plus `npm run lint` (= `tsc --noEmit`) and `npm run build`.
Pattern that works here: money math lives in pure functions (`lib/tax-lots.js`, `proposal-sizing.js`, `mcp-accounting.js`, `risk-engine.js`, `investor-ledger.js`) — put new logic in a pure lib, test it, then wire it into jobs. The mcp-accounting test fixture signs proposals with a test secret (`computeDecisionSignature`) — copy that pattern for anything touching approvals. See `docs/TEST_PLAN.md` for the missing-test priority list.

## Changing peer-relative scoring (Mandate v2 — Phase A, inert)

The v2 mandates score every metric by percentile rank within the candidate's industry
peer set (not the daily slate — that's `lib/quant-scorer.js`). Full plan +
status: `docs/MANDATE-V2-INGESTION.md`.

Files: `lib/peer-scoring.js` (pure peer/absolute primitives), `lib/peer-resolve.js`
(peer-set widening + 8/6 tier selection), `lib/absolute-rules.js` (fail-closed
declarative rule evaluator), `lib/mandate-score.js` (inert aggregate result),
`config/scoring/mandate-v2.js` (per-agent category/point maps + id map),
`config/scoring/absolute-thresholds.js` (executable Agent 1/2/3 + special-sector §5 tables),
`lib/peer-source.js` (`PeerSource` interface + `YahooIndustryPeerSource`;
`buildIndustryDistributions`), `lib/mandate-metrics.js` (`extractMetricVector` — Yahoo
`raw` → metric vector), `jobs/peer-distributions.js` (`npm run peer:dist`), the
`PEER_METRICS_ENABLED` hook in `jobs/universe-refresh.js`, Redis `pm:peer-metrics:*` /
`pm:peer-dist:*` helpers in `lib/redis.js`. Tests: `tests/peer-scoring.test.js`,
`tests/peer-resolve.test.js`, `tests/absolute-rules.test.js`,
`tests/mandate-score.test.js`, `tests/mandate-metrics.test.js`.

Gotchas:
- Two off-by-default flags gate this end to end: `PEER_METRICS_ENABLED` (accumulate
  per-name vectors nightly) then a future `PEER_SCORING` (make the engine live). Nothing
  on the scan/money path imports these modules yet — keep it that way until Phase A is
  verified on real distributions.
- Deterministic code computes the percentiles; the analyst LLM must never rank peers
  (invariant #4). It consumes sub-scores and may only downgrade.
- Missing metric ⇒ vendor-lag rescale (excluded from numerator AND denominator), never
  scored zero. Thin peer set (<~7 comps) ⇒ reported for absolute fallback, not guessed.
- `extractMetricVector` only reads Yahoo fields already fetched by
  `FUNDAMENTALS_MODULES`; 5 metrics are deliberately `null` pending new modules — add
  them by verifying yahoo-finance2 v3 field shapes first, never by guessing names.
- Peer distributions are advisory discovery data (like the universe catalog): money
  paths never read them, and `pm:peer-*` keys stay out of any signed/ledger path.

## Changing EDGAR/XBRL fundamentals ingestion (Mandate v2.1, inert)

The mandated primary fundamentals source (free). Files: `lib/edgar.js` (I/O — CIK
lookup + `fetchCompanyFacts`, SEC User-Agent, `EDGAR_RATE_MS` pacing), `lib/edgar-facts.js`
(pure XBRL parser — concept fallback chains in `CONCEPTS`, quarterly/annual/instant
series, duration-based quarter isolation, dedup-by-period), `lib/edgar-metrics.js` (pure
derivations → `deriveFundamentalMetrics` / `edgarMetricSubset`), consumed by
`lib/mandate-metrics.js` `extractMetricVector(fundamentals, companyfacts?)`. Enabled by
`PEER_METRICS_EDGAR` in `jobs/universe-refresh.js`. Tests: `tests/edgar.test.js`.

Gotchas:
- A 10-Q reports BOTH the 3-month quarter and the 6-/9-month year-to-date for the same
  concept; `quarterlySeries` keeps only ~90-day-duration facts. Don't remove that filter.
- Revenue/cost/equity concepts vary by filer — extend the `CONCEPTS` chains, don't
  hardcode one tag. Instant (balance-sheet) facts have no `start`.
- Missing concepts/periods return null/empty and flow to the engine's vendor-lag rescale
  — never fabricate. Keep SEC calls paced (`EDGAR_RATE_MS`) and the User-Agent descriptive.
- `edgarMetricSubset` uses first-cut YoY defaults shared across agents; the per-agent
  definitions (accel / YoY / multi-year) are in `_derived` and bind via config later.

## Onboarding a specialist mandate (agent-2 / agent-3)

Turning an incoming friend-authored personality into a live specialist. **Order matters — do not skip to activation.**

Files: `config/agents/agent-N/personality.md` (the compact mandate the runtime loads every scan — `jobs/research-scan.js` reads it, `lib/ai-overlay.js` puts it in the cached system block, `lib/evaluator.js` grades "mandate fit" against it), `config/agents/agent-N/AGENT-<NAME>-PLAN.md` (full versioned spec — copy `config/agents/_TEMPLATE-STRATEGY-SPEC.md`), `config/agents/agent-N/universe.json` (`source`, `slateSize`, `aiReviewBudget`, `researchCooldownDays`, `explorationSlots`), `config/agents/agent-N/weights.json` (quant weights, must sum to 1.0), `config/agents/agent-N/risk-limits.json`, `config/agents.js` (registry: `name`, `executionEligibility`).

Steps:
1. Fill `AGENT-<NAME>-PLAN.md` from the template, then write the compact `personality.md` to match it. The compact file is what the model sees — if the two disagree, the model follows the compact one.
2. Tune `weights.json` (sum to 1.0) and `risk-limits.json` to the mandate. Grep that any new risk-limit key is actually consumed by `lib/risk-engine.js` — this file accretes dead keys.
3. Set the agent's `name` in `config/agents.js`. **Leave `executionEligibility: "paper"`** — 2/3 stay propose-only until their mandate + ownership tests pass (roadmap Phase 1 gate).
4. Universe: keep `source: "watchlist"` unless you also add a mandate-specific catalog screen. Catalog mode is driven by `lib/candidate-slate.js` + a philosophy screen; agent-1's is `screenUniverse` in `lib/universe.js`/`jobs/research-scan.js`. Without an equivalent, `source: "catalog"` screens nothing coherent. Flipping to catalog is its own change — see "Changing universe discovery".
5. Add mandate tests before activation: the evaluator must reject an out-of-universe or missing-kill-criteria proposal for this agent (pattern in existing `tests/`), and ownership must hold (`tests/ownership-enforcement.test.js`, `tests/owned-lots.test.js`).

Gotchas:
- Agents share ONE real portfolio; risk limits check the shared position/sector sizes, so a new agent can block/downgrade another's proposals. Set `maxSectorPct`/`maxPositionPct` with that overlap in mind.
- Empty `personality.md` = the model runs against "general prudence" (evaluator says so explicitly). An empty file is a silent no-mandate, not a safe default — don't half-activate.
- `aiReviewBudget` is the Anthropic spend guardrail (holdings exempt). Adding a live agent adds cost; confirm the per-day budget across all agents is acceptable.

## Onboarding / changing the Agent 4 allocation policy (portfolio manager)

Agent 4 is the shadow portfolio manager, NOT a specialist — no `config/agents/agent-4/` dir, not in `AGENTS`. It reviews an immutable specialist `StrategyProposal` and may only ACCEPT/REJECT it; it can never originate a trade, mutate a proposal, or authorize an unowned SELL.

Files: `contracts/portfolio-decision.js` (canonical — `AllocationPolicySchema`, `StrategyBudgetSchema`, `AllocationSnapshotSchema`, `PortfolioRiskSnapshotSchema`, reason codes; mirrored to the dashboard via `npm run contracts:sync`), Redis keys `pm:allocation-policy:active` / `pm:allocation-policy:<version>` / `pm:allocation-snapshot:*` / `pm:portfolio-risk-snapshot:*` / `pm:portfolio-decision:*` (`PORTFOLIO_SHADOW_KEYS`), plus the dashboard's Agent 4 shadow control room. Tests: `tests/portfolio-manager-shadow.test.js`, `tests/ownership-enforcement.test.js`.

Steps:
1. Convert the friend's Agent 4 personality into a versioned `AllocationPolicy` object: `mode: "SHADOW"` (do not change), `version`, and every hard bound (`maxSingleProposalDollars`, `maxStrategyAllocationPct`, `maxTickerExposurePct`, `minCashReservePct`, `maxGrossExposurePct`, `maxBudgetChangePct`, `evidenceWindowDays`, snapshot-age caps, `minEvaluatedProposals`, `minFilledTrades`). The schema validates numeric ranges only — it does not choose a policy; the numbers are the mandate.
2. Keep Agent 4 in **shadow mode with Sam as final approver**. No live approval authority until the policy passes shadow-mode evidence (roadmap Phase 2/3 gate). There is deliberately no order-authorization or approval-signature field in these contracts.
3. Any contract shape change: edit `contracts/portfolio-decision.js`, run `npm run contracts:sync`, commit both repos together (drift-tested).

Gotchas:
- `AllocationSnapshot.budgets` must contain exactly one `StrategyBudget` per specialist in `AGENT_IDS` (currently agent-1/2/3) — adding/removing a specialist changes this invariant and its test.
- Reason codes are an enum (`PORTFOLIO_DECISION_REASON_CODES`); a new rejection cause needs a new code in the canonical file + sync, not a free-text string.

## Cross-repo schema-change checklist (run every time)

1. `grep -rn "<field-or-key>" lib/ jobs/ scripts/` in BOTH repos + `scripts/mac-companion.mjs`.
2. Update `lib/proposals.ts` ↔ `lib/redis.js` ↔ `mac-companion.mjs` together (proposals), or `sheets.js` ↔ `sheets.ts` together (tabs).
3. Update the three signature copies together if the payload changed.
4. Run both test suites; run `npm run build` on the dashboard.
5. Deploy order for breaking Redis-schema changes: writer first only if readers tolerate the new field; otherwise readers first.
