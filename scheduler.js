import "dotenv/config";
import cron from "node-cron";
import { runResearchScan } from "./jobs/research-scan.js";
import { runExitMonitor } from "./jobs/monitor-positions.js";
import { runPerformanceReview } from "./jobs/performance-review.js";
import { runPremarketCheck } from "./jobs/premarket-check.js";
import { runIntradayMonitor } from "./jobs/intraday-monitor.js";
import { syncHoldings } from "./jobs/holdings-sync.js";
import { startServer } from "./server.js";

startServer();

const TZ = { timezone: "America/New_York" };

// ── Holdings sync (9:30 AM ET — market open) ────────────────────────────────
cron.schedule("30 9 * * 1-5", async () => {
  await syncHoldings().catch((e) => console.error("[Holdings] error:", e.message));
}, TZ);

// ── Holdings sync (4:30 PM ET — after close) ────────────────────────────────
cron.schedule("30 16 * * 1-5", async () => {
  await syncHoldings().catch((e) => console.error("[Holdings] error:", e.message));
}, TZ);

// ── Pre-market (8:30 AM ET) ──────────────────────────────────────────────────
// Macro snapshot refresh, regime check, overnight news on held positions.
cron.schedule("30 8 * * 1-5", async () => {
  await runPremarketCheck().catch((e) => console.error("[Premarket] error:", e.message));
}, TZ);

// ── Opening check (9:35 AM ET) ───────────────────────────────────────────────
// First look at opening prices — gap analysis, any alerts triggered at open.
cron.schedule("35 9 * * 1-5", async () => {
  await runIntradayMonitor({ context: "opening" }).catch((e) => console.error("[Opening] error:", e.message));
}, TZ);

// ── Intraday monitor (every 30 min, 10 AM–3:30 PM ET) ───────────────────────
// Price alerts, ATR stop checks, momentum break flags.
cron.schedule("0,30 10-15 * * 1-5", async () => {
  // Don't fire after 3:30 PM — the 15:30 slot is the last valid one before close
  const now = new Date();
  const etHour = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" })).getHours();
  const etMin  = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" })).getMinutes();
  if (etHour > 15 || (etHour === 15 && etMin > 30)) return;
  await runIntradayMonitor({ context: "intraday" }).catch((e) => console.error("[Intraday] error:", e.message));
}, TZ);

// ── Pre-close check (3:50 PM ET) ─────────────────────────────────────────────
// Late momentum sweep — last chance to flag a stop breach before EOD.
cron.schedule("50 15 * * 1-5", async () => {
  await runIntradayMonitor({ context: "pre-close" }).catch((e) => console.error("[PreClose] error:", e.message));
}, TZ);

// ── Exit monitor (4:45 PM ET) ────────────────────────────────────────────────
// Full ATR/fundamental/momentum exit signals with complete EOD bar data.
cron.schedule("45 16 * * 1-5", async () => {
  await runExitMonitor().catch((e) => console.error("[ExitMonitor] error:", e.message));
}, TZ);

// ── Research scan — all agents (5:15 PM ET) ─────────────────────────────────
// Full quant score → AI overlay → risk checks → queue proposals.
// Runs after exit monitor so any SELL proposals are already queued first.
cron.schedule("15 17 * * 1-5", async () => {
  await runResearchScan().catch((e) => console.error("[Research] error:", e.message));
}, TZ);

// ── Performance review (5:45 PM ET) ─────────────────────────────────────────
// Scores past recommendations whose 30/90/180-day windows have elapsed.
cron.schedule("45 17 * * 1-5", async () => {
  await runPerformanceReview().catch((e) => console.error("[Performance] error:", e.message));
}, TZ);

console.log(
  "[Portfolio Manager] Scheduler started — " +
  "pre-market 8:30 AM | opening 9:35 AM | intraday every 30 min 10 AM–3:30 PM | " +
  "pre-close 3:50 PM | exit monitor 4:45 PM | research scan 5:15 PM | perf review 5:45 PM (Mon-Fri, ET)"
);
