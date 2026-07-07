# Portfolio Manager — Architecture

End-to-end map of the system as it actually runs (2026-07-02). Covers all three runtimes: this backend repo, `portfolio-dashboard` (sibling repo), and the Mac companion executor (which lives in the dashboard repo but runs as its own process).

## The three runtimes

| Runtime | Code | Host | Process |
|---|---|---|---|
| Backend scheduler + HTTP server | `portfolio-manager` | Jetson (`~/portfolio-manager`) | PM2 `portfolio-manager` → `scheduler.js` (also serves `server.js` on :3200) |
| Dashboard (UI + API) | `portfolio-dashboard` | Vercel prod (`portfolio-dashboard-ivory-five.vercel.app`) | Next.js 16, Clerk auth |
| Trade executor ("Mac companion") | `portfolio-dashboard/scripts/mac-companion.mjs` | Sam's Mac | PM2 `portfolio-executor` |

They share two stores: **one Google Spreadsheet** (system of record for holdings/ledger/performance) and **one Upstash Redis** (cross-service bus: proposals, triggers, caches, agent memory, audit log — shared instance with Jordan/Aide, `pm:` prefix).

## Backend jobs (scheduler.js, all Mon–Fri America/New_York)

| Time (ET) | Job | File | What it does |
|---|---|---|---|
| 8:30 AM | Pre-market check | `jobs/premarket-check.js` | Macro refresh, regime check, overnight news on held positions |
| 9:30 AM, 11, 1, 3, 4:30 | Holdings sync | `jobs/holdings-sync.js` | `lib/robinhood-sync.py` (read-only robin_stocks) → fills processed into Trade Ledger + FIFO Lots → Holdings/Performance/Overview tabs + NAV/unit + cached total value. 5×/day, not more — each run is a full Robinhood login and too many trips the device-approval challenge |
| 9:35 AM | Opening check | `jobs/intraday-monitor.js` (`context: "opening"`) | Gap analysis, open-triggered alerts |
| every 30 min, 10:00–3:30 | Intraday monitor | `jobs/intraday-monitor.js` | Price alerts (Telegram push via `lib/telegram.js`), ATR stop checks on losing positions → SELL proposals |
| 3:50 PM | Pre-close sweep | same, `context: "pre-close"` | Last stop-breach check before EOD |
| 4:45 PM | Exit monitor | `jobs/monitor-positions.js` | Full ATR/relative-strength/fundamental exit signals (`lib/exit-signals.js`, `lib/indicators.js`) → SELL proposals |
| 5:15 PM | Research scan | `jobs/research-scan.js` | The main pipeline (below); runs after the exit monitor so SELLs queue first |
| 5:45 PM | Performance review | `jobs/performance-review.js` | Locks in 30/90/180-day forward returns + alpha vs SPY on past recommendations; Track Record tab |

## Agent research flow (`jobs/research-scan.js`)

Three agents (`config/agents.js`: agent-1/2/3; agent-1 "Agent One" is the only real-money mandate — `config/agents/agent-1/AGENT-ONE-PLAN.md` + `personality.md`). Each agent, sequentially (one failing doesn't block the others):

1. **Universe** — per `config/agents/<id>/universe.json`:
   - `source: "catalog"` (agent-1): a daily **candidate slate** (`lib/candidate-slate.js`) narrowed from the full NYSE/NASDAQ common-stock catalog (`jobs/universe-refresh.js` nightly: listing + bulk quotes + paced sector enrichment; chunked in Redis `pm:universe:*`), philosophy-screened by `lib/screener.js`. Slate buckets: holdings (always) → Robinhood movers → top-ranked fresh names (small/mid-cap band + momentum, skipping names researched within `researchCooldownDays` per the research ledger `lib/research-ledger.js`) → exploration slots (never-researched names, deterministic daily rotation). AI overlay reviews are hard-capped at `aiReviewBudget`/day (holdings exempt). `watchlist.json` is seed/fallback only, used loudly when the catalog is unavailable.
   - `source: "watchlist"` (agents 2/3 until they have mandates): agent watchlist (`config/agents/<id>/watchlist.json`) + up to 5 Robinhood scan candidates (`lib/market-scan-sync.js` pulls scans directly via robin_stocks before any agent runs; rows ranked by score, then |changePct|).
2. **Fundamentals** via `lib/yahoo.js` (yahoo-finance2 v3 — class API, `new YahooFinance()`), plus `lib/edgar.js` (SEC filings, keyless), `lib/fred.js` (macro, optional key), `lib/tavily.js` (news, shared per-ticker cache), and optionally `lib/athena.js` (per-ticker dossier from the local Athena research platform — fenced untrusted evidence, active only when `ATHENA_AGENT_URL` + `ATHENA_SERVICE_TOKEN` are set).
3. **Screener + data gates** (`lib/screener.js`, `lib/data-gates.js`): universe screen (agent-1 v5 sub-verticals, micro-cap ADDV gate) and missing/stale-data NO_TRADE gate — both run **before** the expensive AI call.
4. **Quant score** (`lib/quant-scorer.js`): cross-sectional min-max normalization over 9 weighted metrics (`config/agents/<id>/weights.json`); missing metric = neutral 50.
5. **AI overlay** (`lib/ai-overlay.js`, claude-sonnet-4-6): static context (personality, strategy notes from the agent's Sheet tab, persistent memory from Redis `pm:agent-memory:<id>:global`, macro) in a cached `system` block (`cache_control: ephemeral`); volatile per-call data (ticker facts, live cash policy) in the user message. Returns structured JSON (action / target_weight_pct / thesis / risks / kill_criteria / confidence). Anthropic usage/cache metrics are recorded by `lib/anthropic-usage.js` into `pm:anthropic-usage:<YYYY-MM-DD>` so cache hits can be verified instead of assumed.
6. **Risk engine** (`lib/risk-engine.js`, `config/agents/<id>/risk-limits.json`): deterministic post-checks — stale-data block, averaging-down block, bear-case requirement, confidence floor (missing confidence fails), position-cap clamp, sub-vertical exposure cap. **Only ever downgrades toward HOLD, never upgrades.**
7. **Conviction + sizing** (`lib/conviction.js`, `lib/proposal-sizing.js`): BUY = increment toward target weight × total account value, capped by idle cash after accepted-unfilled BUY reserves; SELL = actual position market value; starter sizing below $500. Dedup via `hasOpenProposal` / `hasRecentProposal` (7-day ordinary-SELL cooldown).
8. **Queue** (`lib/redis.js` `createProposal`) → the same Redis approval queue the dashboard reads. Every ticker also gets a row in its agent's Sheet tab (per-ticker try/catch: one API failure writes a `scan_error` row instead of discarding the run).

Each step can only narrow what the previous step allowed. Keep that shape.

## Proposal approval + execution flow

```
research scan / exit monitor / dashboard form
        │ createProposal → Redis (status: Pending, expires 48h)
        ▼
dashboard /approvals (FundManager only)
        │ accept → applyProposalDecision: status ApprovedForBrokerReview,
        │          decisionHmac = HMAC(AUDIT_HMAC_SECRET, trade fields)   ← signature
        ▼
mac-companion.mjs (polls 15 min market hours; pm:exec_trigger for immediate)
        │ verifyApprovalSignature (refuse + Telegram if unsigned/invalid)
        │ set executionState "Executing" ON the proposal   ← before any order
        │ claude -p + Robinhood MCP place_equity_order, ref_id = proposal.id
        │ recordTrade → scripts/record-trade.js → lib/mcp-accounting.js
        │   (validates fill vs proposal: signature, status, orderId dedupe,
        │    ticker/side/agent match, maxPrice, amount tolerance —
        │    SELL may undershoot, never overshoot)
        │ only after ledger write: fulfilledAt + fulfilledOrderId, clear Executing
        │ background: scripts/sync-holdings-from-mcp.js → lib/portfolio-snapshot.js
        ▼
crash/timeout/sleep anywhere above → next poll sees "Executing" and RECONCILES
against get_equity_orders (by ref_id) instead of re-executing.
```

Manual path: `EXECUTION-GUIDE.md` + `scripts/list-approved-proposals.js` (annotates `signatureValid`; never execute `false`).

## Robinhood sync boundary

- **Read-only Python** (`lib/robinhood-sync.py`, `lib/robinhood-scan.py`): robin_stocks + TOTP, positions/cash/fills only. No `rh.order_*` calls anywhere — grep for it; that's the check. `ROBINHOOD_STORE_SESSION=false`, `ROBINHOOD_ACCOUNT_NUMBER` pins the Agentic account (robin_stocks silently defaults to `is_default=true` otherwise — was a real bug).
- **Write path** exists ONLY through the Robinhood Agentic Trading MCP (`https://agent.robinhood.com/mcp/trading`, registered in `.mcp.json`), driven by the Mac companion or a human session, always against a signed approved proposal.
- Legacy 4:30 PM Python sync also sweeps fills (`processFills`) — dedupes against Trade Ledger orderIds so MCP-recorded trades aren't double-booked.

## Google Sheets data model

One spreadsheet ("Sam's Portfolio Manager"), ID from `SPREADSHEET_ID` env, cached in Redis `pm:shared:spreadsheet-id`. Tabs (`lib/sheets.js` `TABS`):

| Tab | Written by | Read by |
|---|---|---|
| Overview | `writeOverviewTab` (holdings-sync, portfolio-snapshot) | humans |
| Holdings | `writeHoldingsTab` (both sync paths — clear+rewrite) | dashboard, research scan (allocation/cash/returns), sizing |
| Market Scans | `writeMarketScansTab` | research scan, dashboard Lab→Scans |
| Performance | `appendPerformanceRow` (one row per sync — 5+/day) | NAV/unit lookup, dashboard chart |
| Trade Ledger | `appendTradeLedgerEntries` (append-only) | orderId dedupe, agent books |
| Lots | `appendLots` / `applyLotUpdatesToSheet` (FIFO tax lots, `lib/tax-lots.js`) | realized gains, tax reserve |
| Investors | `appendInvestorLedgerEntry` (append-only, HMAC per row) | NAV/unit, dashboard /investors |
| Track Record | `writeAgentTrackRecordBlock` | dashboard |
| Agent-1/2/3 | `appendAgentRecommendations`, strategy notes | performance review, dashboard |

Dashboard has its own independent TS reader (`portfolio-dashboard/lib/sheets.ts`) — **the schemas are duplicated by hand between the two files; keep them in sync** (see CHANGE_MAP).

## Investor ledger / NAV / unit accounting

- Pooled fund, unitized: contributions/withdrawals buy/sell units at that day's NAV/unit; investor value = units × current NAV/unit. `lib/investor-ledger.js` (+ `scripts/record-contribution.js`, `scripts/process-withdrawal.js` — always run manually AFTER money actually moves).
- NAV/unit computed in holdings-sync: `totalValue ÷ unitsOutstanding` (ledger sum), written to Performance.
- Guardrails: rows HMAC-signed (`INVESTOR_LEDGER_HMAC_SECRET`, `AUDIT_HMAC_SECRET` fallback; `ALLOW_UNSIGNED_INVESTOR_LEDGER=true` escape hatch — don't), `--seed-owner` required before recording outside money into a non-empty fund, stale-NAV rejection unless `--nav-date`/`--allow-stale-nav`, withdrawal bounded by units held. Signatures are currently **write-only** (no verify-on-read — see RISK_REGISTER).
- Agent attribution: `lib/agent-attribution.js` matches fills to proposals; `lib/agent-books.js` tracks per-agent books inside the shared pool.

## Redis usage (shared Upstash instance — `pm:` prefix except chat)

| Key | Purpose | Written by → read by |
|---|---|---|
| `pm:approval_proposal:{id}` + list `pm:approval_proposals` | proposal queue (cap 250) | dashboard + backend → all three runtimes |
| `pm:exec_lock:{id}` | 300s execution lock | companion |
| `pm:exec_trigger`, `pm:market_scan_trigger` | manual wake keys (TTL) | dashboard → companion |
| `pm:companion:last-seen` | executor heartbeat (30s) | companion → dashboard GET /api/companion/trigger |
| `pm:portfolio:total-value` | cached sizing input | holdings-sync → research scan |
| `pm:shared:spreadsheet-id` | spreadsheet ID cache | backend → dashboard (dashboard hard-fails without it) |
| `pm:agent-memory:<id>:*` | persistent agent memory | dashboard (write/extract) → backend prompts |
| `pm:anthropic-usage:{date}` | Anthropic usage/cache telemetry (45d TTL, capped list) | generator/evaluator/weekly review → ops cost checks |
| `agents:{agent}:{user}:chat` | per-agent chat history (cap 40) | dashboard |
| `pm:audit:{date}` | append-only audit log, HMAC rows | dashboard `lib/audit.ts` |
| `pm:rate:*` | rate limits | dashboard `lib/rate-limit.ts` |
| `pm:price-alerts` | intraday alerts | server.js/dashboard → intraday monitor |
| `pm:last-fill-sync-at`, `pm:tax:reserve-rate-pct`, news/macro caches | cursors/caches | backend |
| `research:report:{id}` + `research:history` (cap 100) | saved Lab reports | dashboard |

## Dashboard surface

Pages: `/` command center, `/holdings`, `/recommendations` (signals + catalysts), `/agents` (3 tabs × Alerts/Proposals/Chat/Memory), `/approvals`, `/research` = Lab (Research/Comps/Scans), `/investors`, `/strategy`, `/history`, `/alerts`, `/news`, `/compare`, `/market-scans` (compat wrapper), `/sign-in`.

API routes (all under `app/api/`, ALL gated by `requireApiPermission` — no exceptions): portfolio, recommendations, news, strategy, research(+export), compare(+export), history(+export), investors, withdrawals/preview, proposals(+[id]), agents/[agentId]/{chat,memory,book}, alerts(+[id]) and scan (proxy to Jetson :3200 with `PORTFOLIO_BACKEND_URL` + bearer `PORTFOLIO_WEBHOOK_SECRET`), market-scans, companion/trigger.

## Auth / RBAC / audit (dashboard)

- Clerk middleware (`proxy.ts`) blocks everything unauthenticated first.
- `lib/rbac.ts`: roles `FundManager` / `Client`. FundManager requires Clerk `publicMetadata.role === "FundManager"` **AND** email in `FUND_MANAGER_EMAILS`. Client gets `portfolio:read` + `signals:read` only. Fail-closed (unknown role → null → 403).
- `lib/auth.ts` `requireApiPermission`: Clerk auth → role resolve → red-line check (`lib/red-lines.ts`, advisory wording/route filter) → permission (`canAccess`) → rate limit (`lib/rate-limit.ts`) → HMAC'd audit event (`lib/audit.ts`). In production, audit-write failure fails the request closed (`AUDIT_ENFORCE`).
- Client isolation: `lib/client-access.ts` (fail-closed page allowlist) + `lib/investors.ts` (userId/email matching) + `lib/projections.ts` (field stripping).
- Backend `server.js` auth: fail-closed bearer secret, `timingSafeEqual`; `/health` (unauthenticated, booleans only) probes Redis + env deps and 503s when broken.

## Deployment targets

- Backend → Jetson: `ssh sam@100.102.93.103`, `cd ~/portfolio-manager && git pull && npm test && pm2 restart portfolio-manager --update-env`, verify `curl localhost:3200/health`.
- Dashboard → Vercel: `npx vercel --prod --scope samuelhuffard-9533s-projects` from the dashboard repo.
- Companion → local Mac: `pm2 restart portfolio-executor --update-env` (runs from the working tree — a git pull is a deploy).

See `RUNBOOK.md` for the full operational detail and `INVARIANTS.md` before touching any money path.
