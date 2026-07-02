# Portfolio Manager — Runbook

Operational instructions. No secret values appear here — presence checks only (`grep -c "^VAR=" .env`).

## Local setup

```bash
# Backend
cd portfolio-manager
npm install
pip3 install --user -r requirements.txt   # robin_stocks for the legacy sync
cp .env.example .env                       # fill in values; see env table below
npm test                                   # 88+ tests, must pass clean

# Dashboard
cd ../portfolio-dashboard
npm install
cp .env.example .env.local
npm test && npm run lint && npm run build
```

Google Sheet: create a blank Sheet in a personal Drive, share it Editor with the service account (service accounts on personal Google accounts CANNOT create spreadsheets — 403), put the ID in `SPREADSHEET_ID`. First backend job run calls `ensureTabs` and seeds Redis `pm:shared:spreadsheet-id` (the dashboard hard-fails until that key exists).

## Env vars by runtime (names only)

| Var | Backend (Jetson) | Dashboard (Vercel) | Companion (Mac) |
|---|---|---|---|
| ANTHROPIC_API_KEY | ✅ | ✅ | ✗ (stripped — uses claude.ai login) |
| TAVILY_API_KEY / FRED_API_KEY / ALPHA_VANTAGE_API_KEY | ✅ / opt / opt | ✗ | ✗ |
| ROBINHOOD_USERNAME / PASSWORD / TOTP_SECRET / ACCOUNT_NUMBER / STORE_SESSION / PYTHON | ✅ (STORE_SESSION=false) | ✗ | ✗ |
| GOOGLE_CREDENTIALS_PATH or GOOGLE_SERVICE_ACCOUNT | ✅ | ✅ (base64) | via backend checkout |
| UPSTASH_REDIS_REST_URL / TOKEN | ✅ | ✅ | ✅ (cascade, see below) |
| SPREADSHEET_ID / SAM_EMAIL | ✅ | ✗ (Redis lookup) | via backend checkout |
| INVESTOR_LEDGER_HMAC_SECRET | ✅ | ✗ | via backend checkout |
| AUDIT_HMAC_SECRET | ✅ (must match Vercel) | ✅ | ✅ (signs/verifies approvals) |
| PORTFOLIO_SERVER_PORT / PORTFOLIO_WEBHOOK_SECRET | ✅ (**required** — fail-closed) | ✅ (URL + same secret) | ✗ |
| PORTFOLIO_BACKEND_URL | ✗ | ✅ | ✗ |
| Clerk keys / FUND_MANAGER_EMAILS / AUDIT_ENFORCE / RATE_LIMIT_ENFORCE | ✗ | ✅ | ✗ |
| TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID | ✅ | ✗ | ✅ (via cascade) |
| CLAUDE_BIN | ✗ | ✗ | opt (default `~/.local/bin/claude`) |

Companion env cascade: `portfolio-dashboard/.env.local` → `.env` → `../portfolio-manager/.env` (first hit wins per var). The Mac therefore needs a working `portfolio-manager` checkout as a **sibling directory** — `record-trade.js`/sync scripts are invoked at `../../portfolio-manager/`.

**Secret handling rules:** move values with `printf ... | ssh` or file copies, never `echo` into a terminal; verify with `grep -c`; `.trim()` every env read in code.

## Local verification commands

```bash
# Backend
npm test                       # full suite
node --check <file>.js         # syntax after edits
npm run tavily:check           # Tavily key live check
npm run proposals:approved     # queue state + signatureValid per proposal

# Dashboard
npm test && npm run lint && npm run build
```

## Deploys

**Backend → Jetson** (after push to GitHub main):
```bash
ssh sam@100.102.93.103
cd ~/portfolio-manager && git pull && npm test
pm2 restart portfolio-manager --update-env
sleep 3 && curl -sS http://localhost:3200/health
```
Healthy = `{"ok":true,...,"deps":{redis,sheetsAuth,anthropicKey,webhookSecret,telegram: all true}}` and a startup log line listing the schedule. A deploy is NOT complete until health responds and the fresh log shows no crash.

**Dashboard → Vercel:**
```bash
cd portfolio-dashboard
npx vercel --prod --scope samuelhuffard-9533s-projects
# smoke:
curl -o /dev/null -w "%{http_code}\n" https://portfolio-dashboard-ivory-five.vercel.app/sign-in        # 200
curl -o /dev/null -w "%{http_code}\n" https://portfolio-dashboard-ivory-five.vercel.app/api/portfolio  # 401 signed-out
```

**Companion → Mac:** it runs from the working tree, so `git pull` (or local edits) + `pm2 restart portfolio-executor --update-env` IS the deploy. Verify: `pm2 logs portfolio-executor --lines 5 --nostream` shows the startup line, and Redis `pm:companion:last-seen` updates within ~30s.

## PM2 / log checks

```bash
# Jetson
pm2 ls; pm2 logs portfolio-manager --lines 30 --nostream
ls -la ~/.pm2/logs/            # CHECK MTIMES — stale error logs have misled diagnosis before
# Mac
pm2 describe portfolio-executor
```

## Health checks

- Jetson: `curl localhost:3200/health` — 503 means a dependency is down; the `deps` block says which.
- Auth boundary: `curl -X POST localhost:3200/scan` with no header must be **401**.
- Executor: approvals page shows an offline banner when the heartbeat is stale while accepted proposals wait; or read `pm:companion:last-seen` directly.
- Production: sign-in 200, all `/api/*` 401 signed-out.

## Common failure modes and what they usually mean

| Symptom | Usual meaning |
|---|---|
| `robinhood-sync.py failed — manual re-auth may be needed` | robin_stocks login broken (device approval / password change). Re-auth interactively; expect a ~120s device-approval wait. Not fatal to MCP path. |
| `Synced 0 positions` | Not a bug if the account is unfunded/empty. |
| 401s in PM2 error log with `invalid x-api-key` shape | That's an **Anthropic** error shape, not Tavily — check `ANTHROPIC_API_KEY` on the box. Check the log file mtime before assuming it's current. |
| Scan runs, zero proposals, no errors | Historic silent-drop mode. Now logs `[Redis] NOT CONFIGURED ... proposal DROPPED` — if you see that, Upstash env is missing/broken. |
| Dashboard pages all 500 | Redis down or `pm:shared:spreadsheet-id` missing (dashboard hard-depends on it). |
| `/api/scan` or alerts 502/timeout | Jetson or tunnel down; rest of dashboard keeps working (reads Sheets/Redis directly). |
| Proposal stuck `ApprovedForBrokerReview`, no fill | Mac asleep (check banner/heartbeat) or market closed. If `executionState: "Executing"` persists across polls, read companion logs — it's reconciling against the broker. |
| Telegram alert: "EXECUTED but ledger recording FAILED" | Money moved, books didn't. The companion retries recording next poll from stored order fields. If it persists: run `scripts/record-trade.js` manually with the orderId from the alert. |
| Duplicate-looking Trade Ledger rows | Should be impossible now (orderId dedupe both paths) — if seen, treat as a new bug, don't hand-delete rows (append a correcting entry instead). |
| PM2 `↺` restart count climbing | Crash loop — `pm2 logs` before anything else. |

## Verifying Robinhood sync safely (no trades)

- Legacy path: `npm run holdings:sync:legacy` — read-only by construction (grep `rh.order_` returns nothing).
- MCP path: use ONLY read tools (`get_equity_positions`, `get_portfolio`, `get_equity_orders`) and pipe into `npm run holdings:sync` (`sync-holdings-from-mcp.js`). The scan sync explicitly disallows all order/mutation tools (`MARKET_SYNC_DISALLOWED_TOOLS` in mac-companion).
- Never call `place_equity_order`/`review_equity_order` as part of "verification."

## Recording contributions / withdrawals safely

Order of operations is the safety mechanism:
1. Money actually moves (bank/Robinhood) FIRST. Verify it landed.
2. Same-day 4:30 PM holdings sync has run (fresh NAV row). For a first-ever contribution into a fund with pre-existing value, seed the owner first: `node scripts/record-contribution.js agent-1 <email> "<name>" <value> --seed-owner`.
3. `node scripts/record-contribution.js <agentId> <email> "<name>" <amount> [--investor-id=<clerk-user-id>]` — prefer stable Clerk IDs; requires `INVESTOR_LEDGER_HMAC_SECRET`; refuses stale NAV without explicit `--nav-date`/`--allow-stale-nav`.
4. Withdrawals: preview in the dashboard (`/api/withdrawals/preview`), then `scripts/process-withdrawal.js` — bounded by units held.
5. Never edit the Investors tab by hand; corrections are new appended entries.
