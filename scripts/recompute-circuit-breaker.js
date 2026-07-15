import "dotenv/config";
import { assessCircuitBreaker, deriveDailyNavBreakerBasis } from "../lib/circuit-breaker.js";
import { getServiceAccountClients, readPerformanceHistory, resolveSharedSpreadsheetId } from "../lib/sheets.js";
import {
  getBreakerState,
  getPortfolioHighWaterMark,
  setBreakerState,
  setPortfolioHighWaterMark,
} from "../lib/redis.js";
import { sendMessage } from "../lib/telegram.js";

const apply = process.argv.includes("--apply");
const { sheets, drive } = getServiceAccountClients();
const spreadsheetId = await resolveSharedSpreadsheetId(sheets, drive);
const history = await readPerformanceHistory(sheets, spreadsheetId);
const basis = deriveDailyNavBreakerBasis(history);
if (basis.current == null || basis.highWaterMark == null || basis.dailyRows < 2) {
  throw new Error("At least two usable signed daily NAV/unit rows are required to recompute the breaker.");
}

const assessment = assessCircuitBreaker({ current: basis.current, highWaterMark: basis.highWaterMark });
const previousState = await getBreakerState();
const previousHighWaterMark = await getPortfolioHighWaterMark();
const report = {
  apply,
  source: "signed-performance-final-row-per-date-v1",
  currentDate: basis.currentDate,
  dailyRows: basis.dailyRows,
  ignoredSameDayOrInvalidRows: basis.ignoredRows,
  previous: {
    tier: previousState?.tier ?? null,
    drawdownPct: previousState?.drawdownPct ?? null,
    basis: previousState?.basis ?? null,
    highWaterMark: previousHighWaterMark?.value ?? null,
  },
  recomputed: {
    tier: assessment.tier,
    drawdownPct: assessment.drawdownPct,
    basis: "navPerUnit",
    highWaterMark: assessment.highWaterMark,
    current: basis.current,
  },
};
console.log(JSON.stringify(report, null, 2));

if (apply) {
  await setPortfolioHighWaterMark({
    value: assessment.highWaterMark,
    basis: "navPerUnit",
    dailyRows: basis.dailyRows,
    ledgerHighWaterMark: basis.highWaterMark,
  });
  await setBreakerState({ tier: assessment.tier, drawdownPct: assessment.drawdownPct, basis: "navPerUnit" });
  const verifiedHighWaterMark = await getPortfolioHighWaterMark();
  const verifiedState = await getBreakerState();
  const hwmMatches = verifiedHighWaterMark?.basis === "navPerUnit"
    && Math.abs(Number(verifiedHighWaterMark.value) - assessment.highWaterMark) < 1e-9;
  const stateMatches = verifiedState?.basis === "navPerUnit"
    && verifiedState?.tier === assessment.tier
    && Math.abs(Number(verifiedState.drawdownPct) - assessment.drawdownPct) < 1e-9;
  if (!hwmMatches || !stateMatches) {
    throw new Error("Circuit-breaker repair did not survive Redis read-back; Telegram success notice was not sent.");
  }
  await sendMessage(
    `Portfolio circuit breaker recomputed from signed daily NAV history: ${previousState?.tier ?? "UNKNOWN"} → ${assessment.tier}. ` +
    `${basis.ignoredRows} duplicate-date or invalid row(s) excluded; no trade or proposal was created.`
  );
}
