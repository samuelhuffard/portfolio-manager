import "dotenv/config";
import cron from "node-cron";
import { runResearchScan } from "./jobs/research-scan.js";
import { runExitMonitor } from "./jobs/monitor-positions.js";
import { runPerformanceReview } from "./jobs/performance-review.js";
import { runPremarketCheck } from "./jobs/premarket-check.js";
import { runIntradayMonitor } from "./jobs/intraday-monitor.js";
import { runLedgerVerification } from "./scripts/verify-ledgers.js";
import { runWeeklyReview } from "./jobs/weekly-review.js";
import { runInvestorWeeklyUpdate } from "./jobs/investor-weekly-update.js";
import { runSystemSentinel } from "./jobs/system-sentinel.js";
import { runUniverseRefresh } from "./jobs/universe-refresh.js";
import { requestMcpHoldingsSync, requestMcpOrderReconciliation } from "./jobs/mcp-read-requests.js";
import { runDailyDbParityCheck } from "./jobs/db-parity-check.js";
import { getRedis, getResearchScanStatus, setResearchScanStatus } from "./lib/redis.js";
import { marketHolidayNameET } from "./lib/market-calendar.js";
import { startServer } from "./server.js";

startServer();

const TZ = { timezone: "America/New_York" };

async function repairInterruptedResearchScan() {
  try {
    const status = await getResearchScanStatus();
    if (!status || status.status !== "running") return;
    const completedAt = new Date().toISOString();
    await setResearchScanStatus({
      ...status,
      status: "failed",
      completedAt,
      durationMs: status.startedAt ? Date.parse(completedAt) - Date.parse(status.startedAt) : null,
      error: "Process restarted before research scan completed.",
    });
    console.warn(`[Scheduler] marked interrupted research scan ${status.runId ?? "unknown"} as failed.`);
  } catch (e) {
    console.warn("[Scheduler] failed to repair interrupted research scan:", e.message);
  }
}

await repairInterruptedResearchScan();

// Records every scheduled run to pm:job:<name>:last-run so the system sentinel
// (jobs/system-sentinel.js) can detect missed crons and failed runs. Purely
// observational — a Redis hiccup here must never break the job itself.
//
// marketDayOnly jobs skip full-day NYSE holidays (lib/market-calendar.js) —
// the cron Mon–Fri masks don't know that e.g. July 4th 2026 closed the market
// on Friday July 3rd, which ran a full research scan against a closed market.
// A skip still records a last-run (with skippedHoliday) so the sentinel's
// missed-cron check stays quiet.
function wrapJob(name, label, fn, { marketDayOnly = false } = {}) {
  return async (...args) => {
    const started = Date.now();
    let ok = true;
    let error = null;
    const holiday = marketDayOnly ? marketHolidayNameET() : null;
    if (holiday) {
      console.log(`[${label}] skipped — market holiday: ${holiday}`);
    } else {
      try {
        await fn(...args);
      } catch (e) {
        ok = false;
        error = e.message;
        console.error(`[${label}] error:`, e.message);
      }
    }
    try {
      const redis = getRedis();
      if (redis) {
        const dateET = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
        await redis.set(`pm:job:${name}:last-run`, JSON.stringify({
          ts: new Date().toISOString(), dateET, ok, durationMs: Date.now() - started, error,
          ...(holiday ? { skippedHoliday: holiday } : {}),
        }));
      }
    } catch (e) {
      console.warn(`[Scheduler] failed to record last-run for ${name}:`, e.message);
    }
  };
}

const MARKET_DAY_ONLY = { marketDayOnly: true };

// MCP broker jobs are not complete when Jetson queues them: completion means
// the Mac has claimed the durable request, obtained a validated read-only
// response, and written its receipt. Keep the ordinary `last-run` key for that
// receipt so the sentinel never mistakes a queued request for fresh broker data.
async function queueMcpReadJob(name, label, requestFn) {
  const started = Date.now();
  const holiday = marketHolidayNameET();
  const redis = getRedis();
  const dateET = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
  if (holiday) {
    if (redis) await redis.set(`pm:job:${name}:last-run`, JSON.stringify({
      ts: new Date().toISOString(), dateET, ok: true, durationMs: Date.now() - started, error: null, skippedHoliday: holiday,
    }));
    console.log(`[${label}] skipped — market holiday: ${holiday}`);
    return;
  }
  try {
    const { queued, request } = await requestFn();
    if (redis) await redis.set(`pm:job:${name}:last-request`, JSON.stringify({
      ts: new Date().toISOString(), dateET, queued, requestId: request.id, durationMs: Date.now() - started,
    }));
    console.log(`[${label}] ${queued ? "queued" : "already pending"} request ${request.id}`);
  } catch (error) {
    if (redis) await redis.set(`pm:job:${name}:last-run`, JSON.stringify({
      ts: new Date().toISOString(), dateET, ok: false, durationMs: Date.now() - started, error: error.message,
    }));
    console.error(`[${label}] request error:`, error.message);
  }
}

// ── Holdings sync (9:30 AM ET — market open) ────────────────────────────────
cron.schedule("30 9 * * 1-5", () => queueMcpReadJob("holdings-sync", "HoldingsMcpRequest", requestMcpHoldingsSync), TZ);

// ── Holdings sync (4:30 PM ET — after close) ────────────────────────────────
cron.schedule("30 16 * * 1-5", () => queueMcpReadJob("holdings-sync", "HoldingsMcpRequest", requestMcpHoldingsSync), TZ);

// ── Broker-vs-ledger reconciliation (4:40 PM ET) ───────────────────────────
// Jetson records the durable request; the Mac companion performs the exact
// read-only MCP call and writes a receipt. Device approval cannot be automated
// safely from Jetson's legacy Python login path.
cron.schedule("40 16 * * 1-5", () => queueMcpReadJob("order-reconciliation", "ReconcileMcpRequest", requestMcpOrderReconciliation), TZ);

// ── Pre-market (8:30 AM ET) ──────────────────────────────────────────────────
// Macro snapshot refresh, regime check, overnight news on held positions.
cron.schedule("30 8 * * 1-5", wrapJob("premarket-check", "Premarket", runPremarketCheck, MARKET_DAY_ONLY), TZ);

// ── Opening check (9:35 AM ET) ───────────────────────────────────────────────
// First look at opening prices — gap analysis, any alerts triggered at open.
cron.schedule("35 9 * * 1-5", wrapJob("intraday-monitor", "Opening", () => runIntradayMonitor({ context: "opening" }), MARKET_DAY_ONLY), TZ);

// ── Holdings sync (11 AM, 1 PM, 3 PM ET) ────────────────────────────────────
// Jetson queues a durable MCP snapshot request. The Mac's existing Robinhood
// authorization supplies the read-only broker data; it performs no Python
// login, avoids triggering device approvals, and writes the existing Sheet/NAV
// projection only after a validated positions response.
for (const time of ["0 11 * * 1-5", "0 13 * * 1-5", "0 15 * * 1-5"]) {
  cron.schedule(time, () => queueMcpReadJob("holdings-sync", "HoldingsMcpRequest", requestMcpHoldingsSync), TZ);
}

// ── Intraday monitor (every 30 min, 10 AM–3:30 PM ET) ───────────────────────
// Price alerts, ATR stop checks, momentum break flags.
cron.schedule("0,30 10-15 * * 1-5", wrapJob("intraday-monitor", "Intraday", async () => {
  // Don't fire after 3:30 PM — the 15:30 slot is the last valid one before close
  const now = new Date();
  const etHour = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" })).getHours();
  const etMin  = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" })).getMinutes();
  if (etHour > 15 || (etHour === 15 && etMin > 30)) return;
  await runIntradayMonitor({ context: "intraday" });
}, MARKET_DAY_ONLY), TZ);

// ── Pre-close check (3:50 PM ET) ─────────────────────────────────────────────
// Late momentum sweep — last chance to flag a stop breach before EOD.
cron.schedule("50 15 * * 1-5", wrapJob("intraday-monitor", "PreClose", () => runIntradayMonitor({ context: "pre-close" }), MARKET_DAY_ONLY), TZ);

// ── Exit monitor (4:45 PM ET, Sun–Thu) ───────────────────────────────────────
// Full ATR/fundamental/momentum exit signals with complete EOD bar data.
// Shifted off Friday: proposals expire 48h after creation (lib/redis.js), so a
// Friday-evening proposal expired Sunday evening — before Monday's market even
// opened. Running the Friday-close-data scan on Sunday instead means the same
// proposal now expires Tuesday evening, leaving all of Monday's session to act.
cron.schedule("45 16 * * 0-4", wrapJob("exit-monitor", "ExitMonitor", runExitMonitor, MARKET_DAY_ONLY), TZ);

// ── Research scan — all agents (5:15 PM ET, Sun–Thu) ─────────────────────────
// Full quant score → AI overlay → risk checks → queue proposals.
// Runs after exit monitor so any SELL proposals are already queued first.
// See exit-monitor comment above for why this moved off the Friday slot.
cron.schedule("15 17 * * 0-4", wrapJob("research-scan", "Research", runResearchScan, MARKET_DAY_ONLY), TZ);

// ── Performance review (5:45 PM ET) ─────────────────────────────────────────
// Scores past recommendations whose 30/90/180-day windows have elapsed.
cron.schedule("45 17 * * 1-5", wrapJob("performance-review", "Performance", runPerformanceReview, MARKET_DAY_ONLY), TZ);

// ── Ledger verification (6:00 PM ET) ─────────────────────────────────────────
// Recomputes the Investors-tab row HMACs and the last week of audit-log row
// HMACs. Signed rows were previously write-only — this is what makes them
// actually tamper-evident. Report-only; Telegrams on any mismatch.
cron.schedule("0 18 * * 1-5", wrapJob("verify-ledgers", "Verify", runLedgerVerification), TZ);

// ── System sentinel (6:15 PM ET) ─────────────────────────────────────────────
// Tier 0 of the system autoresearch loop (docs/SYSTEM-LOOP-PLAN.md): watches
// PM2, /health, cron freshness, the dashboard, the approval queue, Sheets
// schema, and PM2 logs. Deterministic; publishes a snapshot for the Mac tier.
// Runs last so it can see whether today's whole pipeline actually ran.
cron.schedule("15 18 * * 1-5", wrapJob("system-sentinel", "Sysloop", runSystemSentinel), TZ);

// ── Universe refresh (7:30 PM ET weeknights) ─────────────────────────────────
// Maintains the NYSE/NASDAQ common-stock catalog the research scan's candidate
// slate draws from (jobs/universe-refresh.js): listing refresh, bulk quotes,
// and a paced nightly batch of sector enrichment. Off the 5:15 PM scan path on
// purpose; failure Telegrams and the next scan uses the last good catalog.
// Not market-day-gated — enrichment on a holiday evening is harmless and useful.
cron.schedule("30 19 * * 1-5", wrapJob("universe-refresh", "Universe", runUniverseRefresh), TZ);

// ── Postgres shadow parity (8:00 PM ET, daily) ──────────────────────────────
// Sheets/Redis remain authoritative. Missing sources and mismatches fail this
// observational job loudly; the result is retained for the 30-day shadow gate.
cron.schedule("0 20 * * *", wrapJob("db-parity", "Parity", runDailyDbParityCheck), TZ);

// ── Weekly review (Friday 6:30 PM ET) ────────────────────────────────────────
// Closes the feedback loop: deterministic per-agent scorecard (proposals,
// decisions, matured track record, calibration) → ≤3 durable lessons written
// into agent memory → Telegram summary. Runs after ledger verify so the week's
// books are checked before being summarized.
cron.schedule("30 18 * * 5", wrapJob("weekly-review", "WeeklyReview", runWeeklyReview), TZ);

// ── Investor weekly email update (Friday 6:45 PM ET) ─────────────────────────
// Accounting update to each investor: executed BUY/SELL actions this week, their
// unitized value/gain-loss, and largest pro-rata exposures. Explicitly opt-in via
// INVESTOR_UPDATE_ENABLED=true so a new Resend key cannot accidentally blast emails.
cron.schedule("45 18 * * 5", wrapJob("investor-weekly-update", "InvestorUpdate", runInvestorWeeklyUpdate), TZ);

console.log(
  "[Portfolio Manager] Scheduler started — " +
  "pre-market 8:30 AM | opening 9:35 AM | holdings sync 11 AM/1 PM/3 PM | reconciliation 4:40 PM | " +
  "intraday every 30 min 10 AM–3:30 PM | pre-close 3:50 PM | exit monitor 4:45 PM | " +
  "research scan 5:15 PM | perf review 5:45 PM | ledger verify 6:00 PM | " +
  "system sentinel 6:15 PM | universe refresh 7:30 PM (Mon-Fri, ET) | " +
  "weekly review Fri 6:30 PM ET | investor update Fri 6:45 PM ET | shadow parity 8:00 PM daily"
);
