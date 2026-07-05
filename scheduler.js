import "dotenv/config";
import cron from "node-cron";
import { runResearchScan } from "./jobs/research-scan.js";
import { runExitMonitor } from "./jobs/monitor-positions.js";
import { runPerformanceReview } from "./jobs/performance-review.js";
import { runPremarketCheck } from "./jobs/premarket-check.js";
import { runIntradayMonitor } from "./jobs/intraday-monitor.js";
import { syncHoldings } from "./jobs/holdings-sync.js";
import { runLedgerVerification } from "./scripts/verify-ledgers.js";
import { runWeeklyReview } from "./jobs/weekly-review.js";
import { runSystemSentinel } from "./jobs/system-sentinel.js";
import { getRedis } from "./lib/redis.js";
import { marketHolidayNameET } from "./lib/market-calendar.js";
import { startServer } from "./server.js";

startServer();

const TZ = { timezone: "America/New_York" };

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

// ── Holdings sync (9:30 AM ET — market open) ────────────────────────────────
cron.schedule("30 9 * * 1-5", wrapJob("holdings-sync", "Holdings", syncHoldings, MARKET_DAY_ONLY), TZ);

// ── Holdings sync (4:30 PM ET — after close) ────────────────────────────────
cron.schedule("30 16 * * 1-5", wrapJob("holdings-sync", "Holdings", syncHoldings, MARKET_DAY_ONLY), TZ);

// ── Pre-market (8:30 AM ET) ──────────────────────────────────────────────────
// Macro snapshot refresh, regime check, overnight news on held positions.
cron.schedule("30 8 * * 1-5", wrapJob("premarket-check", "Premarket", runPremarketCheck, MARKET_DAY_ONLY), TZ);

// ── Opening check (9:35 AM ET) ───────────────────────────────────────────────
// First look at opening prices — gap analysis, any alerts triggered at open.
cron.schedule("35 9 * * 1-5", wrapJob("intraday-monitor", "Opening", () => runIntradayMonitor({ context: "opening" }), MARKET_DAY_ONLY), TZ);

// ── Holdings sync (11 AM, 1 PM, 3 PM ET) ────────────────────────────────────
// Same full syncHoldings() as the 9:30 AM/4:30 PM runs — fresh quotes + Sheet
// write every time, not just when a fill happens. Every 5 min was reconsidered:
// each run is a full Robinhood login/logout, and this account trades rarely —
// 78 logins/day just raises the odds of tripping Robinhood's anti-automation
// device-approval challenge again. 3x/day gives real intraday freshness on
// position values at a fraction of the login volume.
for (const time of ["0 11 * * 1-5", "0 13 * * 1-5", "0 15 * * 1-5"]) {
  cron.schedule(time, wrapJob("holdings-sync", "Holdings", syncHoldings, MARKET_DAY_ONLY), TZ);
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

// ── Exit monitor (4:45 PM ET) ────────────────────────────────────────────────
// Full ATR/fundamental/momentum exit signals with complete EOD bar data.
cron.schedule("45 16 * * 1-5", wrapJob("exit-monitor", "ExitMonitor", runExitMonitor, MARKET_DAY_ONLY), TZ);

// ── Research scan — all agents (5:15 PM ET) ─────────────────────────────────
// Full quant score → AI overlay → risk checks → queue proposals.
// Runs after exit monitor so any SELL proposals are already queued first.
cron.schedule("15 17 * * 1-5", wrapJob("research-scan", "Research", runResearchScan, MARKET_DAY_ONLY), TZ);

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

// ── Weekly review (Friday 6:30 PM ET) ────────────────────────────────────────
// Closes the feedback loop: deterministic per-agent scorecard (proposals,
// decisions, matured track record, calibration) → ≤3 durable lessons written
// into agent memory → Telegram summary. Runs after ledger verify so the week's
// books are checked before being summarized.
cron.schedule("30 18 * * 5", wrapJob("weekly-review", "WeeklyReview", runWeeklyReview), TZ);

console.log(
  "[Portfolio Manager] Scheduler started — " +
  "pre-market 8:30 AM | opening 9:35 AM | holdings sync 11 AM/1 PM/3 PM | " +
  "intraday every 30 min 10 AM–3:30 PM | pre-close 3:50 PM | exit monitor 4:45 PM | " +
  "research scan 5:15 PM | perf review 5:45 PM | ledger verify 6:00 PM | " +
  "system sentinel 6:15 PM (Mon-Fri, ET) | weekly review Fri 6:30 PM ET"
);
