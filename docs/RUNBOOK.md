# Portfolio Manager — Runbook

Operational instructions. No secret values appear here — presence checks only (`grep -c "^VAR=" .env`).

## Local setup

```bash
# Backend
cd portfolio-manager
npm install
pip3 install --user -r requirements.txt   # legacy diagnostic tooling only
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
| TAVILY_API_KEY / FRED_API_KEY | ✅ / opt | ✗ | ✗ |
| ATHENA_AGENT_URL / ATHENA_SERVICE_TOKEN | opt (off unless both set) | ✗ | ✗ |
| ROBINHOOD_USERNAME / PASSWORD / TOTP_SECRET / ACCOUNT_NUMBER / STORE_SESSION / PYTHON | ✅ (STORE_SESSION=false) | ✗ | ✗ |
| GOOGLE_CREDENTIALS_PATH or GOOGLE_SERVICE_ACCOUNT | ✅ | ✅ (base64) | via backend checkout |
| UPSTASH_REDIS_REST_URL / TOKEN | ✅ | ✅ | ✅ (cascade, see below) |
| SPREADSHEET_ID / SAM_EMAIL | ✅ | ✗ (Redis lookup) | via backend checkout |
| INVESTOR_LEDGER_HMAC_SECRET | ✅ | ✗ | via backend checkout |
| OPERATIONAL_LEDGER_HMAC_SECRET / OPERATIONAL_LEDGER_LEGACY_HMAC_SECRETS | ✅ (dedicated signer + comma-separated migration-only legacy verification keys. Once the dedicated key exists, investor/audit keys are **not** implicitly trusted. Performance/Trade/Lot rows are long-lived: remove the legacy list only after deliberate re-sign/migration and after immutable retained records age out) | ✗ | via backend checkout |
| SYSLOOP_DEPLOY_HMAC_SECRET | ✅ (**dedicated, no fallback** — signs PM2 deploy markers) | ✗ | ✗ |
| ANTHROPIC_MONTHLY_MAX_USD / ANTHROPIC_MONTHLY_PROTECTED_RESERVE_USD | ✅ ($40 ceiling / $10 protected pool) | ✗ | ✗ |
| ANTHROPIC_BUDGET_REQUIRED | ✅ (**set `true` in production** — a missing ceiling then refuses calls instead of silently removing the cap) | ✗ | ✗ |
| AGENT_1_CATALOG_ROLLBACK / AGENT_2_CATALOG_ROLLBACK / AGENT_3_CATALOG_ROLLBACK | opt ✅ (emergency per-agent fallback only; leave `false` for the live shared catalog) | ✗ | ✗ |
| AUDIT_HMAC_SECRET | ✅ (must match Vercel) | ✅ | ✅ (signs/verifies approvals) |
| PORTFOLIO_SERVER_PORT / PORTFOLIO_WEBHOOK_SECRET | ✅ (**required** — fail-closed) | ✅ (URL + same secret) | ✗ |
| PORTFOLIO_BACKEND_URL | ✗ | ✅ | ✗ |
| Clerk keys / FUND_MANAGER_EMAILS / AUDIT_ENFORCE / RATE_LIMIT_ENFORCE | ✗ | ✅ | ✗ |
| TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID | ✅ | ✗ | ✅ (via cascade) |
| RESEND_API_KEY / INVESTOR_UPDATE_* | opt ✅ | ✗ | ✗ |
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
npm run investors:weekly-update # sends weekly investor emails only when enabled

# Dashboard
npm test && npm run lint && npm run build
```

## Deploys

**Backend → Jetson** (after pushing the exact reviewed release named in
`docs/roadmaps/portfolio-master-plan.md`; do not assume `main`):
```bash
ssh sam@100.102.93.103
cd ~/portfolio-manager
git fetch origin
git switch <reviewed-release-branch>
git pull --ff-only origin <reviewed-release-branch>
git rev-parse HEAD  # must equal the reviewed release SHA
npm test
npm run deploy:restart
curl -sS http://localhost:3200/health
npm run sysloop:check
```
`npm run deploy:restart` is mandatory: it permits exactly one clean PM2 restart
edge and signs it with the dedicated deploy key. Never substitute `pm2 restart`
or another unmarked restart. The immediate sentinel run must trust and atomically
consume that marker without a PM2 anomaly. Healthy also means
`{"ok":true,...,"deps":{redis,sheetsAuth,anthropicKey,webhookSecret,telegram: all true}}`,
PM2 online with zero unstable restarts and exit code zero, the loaded branch/SHA
matching the reviewed release, and a fresh timestamped startup log with no crash.
A deploy is not complete until all of those checks are clean.

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

## Sysloop (system autoresearch loop)

- Jetson sentinel runs 6:15 PM ET Mon–Fri for timely alerts and again at 8:10 PM
  immediately before the Phase 0 observer (`npm run sysloop:check`, or `--dry-run`
  for a no-publish smoke test). Snapshot → `pm:sysloop:snapshot:<date>` (7d TTL)
  + `ops/health/<date>.json`; heartbeat → `pm:sysloop:last-run`.
- Phase 0 Redis records are a 90-day transport. Signed create-once archives live
  under ignored `ops/phase0-observations/` (or `PHASE0_EVIDENCE_DIR`) and must be
  included in Jetson backups; verify their HMAC before using them as evidence.
- Phase 0 also requires bounded per-invocation histories: holdings at 9:30/11:00/
  13:00/15:00/16:30, reconciliation at 16:40, all 14 intraday checks, and both
  sentinel runs. Histories retain every attempt; for the same exact invocation,
  a valid final retry satisfies the slot, while a final failure remains blocking.
- `npm run phase0:observe` is diagnostic-only and does not persist. The scheduler
  is the persistence authority at 8:20 PM ET; even an explicit persistence call
  is rejected before that cutoff. A gate-closing release must predate the
  observation date, so release day never counts.
- MCP reads are queued FIFO by invocation ID. A failed request remains retryable
  at the head, while later scheduled slots remain distinct behind it instead of
  being coalesced away.
- Jetson queues the 4:40 PM ET report-only broker-vs-ledger reconciliation for the Mac companion. The companion performs the MCP read against the pinned Agentic account, writes a durable receipt, alerts on a missing or malformed ledger match, and never records a trade or alters an order.
- Mac PM2 process `portfolio-sysloop` (this repo's working tree): cross-watch every 30 min, triage 6:35 PM Mon–Fri (`npm run sysloop:triage`), weekly Sun 10 AM (`npm run sysloop:weekly`). Both accept `--force` to bypass the once-per-period Redis rate cap.
- Findings ledger: `ops/findings/*.md` (git-tracked). To close one, edit `status: open` → `fixed`; if the fingerprint reappears it auto-flips to `regressed` and escalates. Weekly artifacts: `ops/reports/`, `ops/proposed-tests/`, `ops/proposed-patches/` — all propose-only, nothing is applied automatically.
- **`ops/FIXLIST.md` is the single readable view** of everything above — regenerated after every triage/weekly pass, or manually via `npm run sysloop:fixlist` after editing a finding's status. Claude Code sessions read it at session start (pointer in `CLAUDE.md`).
- LLM tiers run `claude -p` on the Mac (subscription, not API), read-only tools, no MCP. Telegram alerts come from the Jetson sentinel; Mac-side alerts are console-only until `TELEGRAM_*` is added to the Mac `.env`.

## Common failure modes and what they usually mean

| Symptom | Usual meaning |
|---|---|
| `MCP trace did not include required ...` or `...without the configured Agentic account_number` | The companion refused to project broker data because it could not prove the scheduled MCP call targeted the pinned account. Check the Robinhood MCP connection and account configuration; do not bypass this guard. |
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

- Scheduled path: Jetson writes one typed request under `pm:mcp-read:<kind>:request`; the Mac companion claims it with a lease, runs only its fixed read-tool allowlist, proves every account-scoped tool call used `ROBINHOOD_ACCOUNT_NUMBER`, and writes `pm:mcp-read:<kind>:last-run` on completion.
- A request is safe to retry: its request ID is bound to the signed Performance row, so retries replay Holdings/Overview projections but cannot append a second performance row.
- The former `robin_stocks` path is diagnostic-only and must not be used as an unattended authentication workaround for device approvals, SMS, or passkeys.
- MCP path: use ONLY read tools (`get_equity_positions`, `get_portfolio`, `get_equity_orders`) and pipe into `npm run holdings:sync` (`sync-holdings-from-mcp.js`). The scan sync explicitly disallows all order/mutation tools (`MARKET_SYNC_DISALLOWED_TOOLS` in mac-companion).
- Never call `place_equity_order`/`review_equity_order` as part of "verification."

## Recording contributions / withdrawals safely

Order of operations is the safety mechanism:
1. Money actually moves (bank/Robinhood) FIRST. Verify it landed.
2. Same-day 4:30 PM holdings sync has run (fresh NAV row). For a first-ever contribution into a fund with pre-existing value, seed the owner first: `node scripts/record-contribution.js agent-1 <email> "<name>" <value> --seed-owner`.
3. `node scripts/record-contribution.js <agentId> <email> "<name>" <amount> [--investor-id=<clerk-user-id>]` — prefer stable Clerk IDs; requires `INVESTOR_LEDGER_HMAC_SECRET`; refuses stale NAV without explicit `--nav-date`/`--allow-stale-nav`.
4. Withdrawals: preview in the dashboard (`/api/withdrawals/preview`), then `scripts/process-withdrawal.js` — bounded by units held.
5. Never edit the Investors tab by hand; corrections are new appended entries.
