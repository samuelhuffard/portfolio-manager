import "dotenv/config";
import { fileURLToPath } from "node:url";
import {
  getServiceAccountClients,
  readHoldingsDetail,
  readInvestorLedger,
  readPerformanceHistory,
  readTradeLedger,
  resolveSharedSpreadsheetId,
} from "../lib/sheets.js";
import { getRedis, setInvestorUpdate } from "../lib/redis.js";
import { computeInvestorSummaries, isoWeekOf, renderInvestorUpdateEmail } from "../lib/investor-update.js";
import { investorUpdatesEnabled, sendEmail } from "../lib/email.js";
import { sendMessage as sendTelegram } from "../lib/telegram.js";

const SENT_TTL_SECONDS = 45 * 24 * 3600;

function sentKeyFor(isoWeek, investorId) {
  return `pm:investor-update:sent:${isoWeek}:${investorId}`;
}

async function reserveSend(redis, key) {
  if (!redis) return true;
  const result = await redis.set(key, new Date().toISOString(), { nx: true, ex: SENT_TTL_SECONDS });
  return result === "OK" || result === "ok" || result === true;
}

async function clearReservation(redis, key) {
  if (!redis) return;
  await redis.del(key);
}

export async function runInvestorWeeklyUpdate({ now = new Date() } = {}) {
  const { sheets, drive } = getServiceAccountClients();
  const spreadsheetId = await resolveSharedSpreadsheetId(sheets, drive);
  const [ledger, performanceHistory, holdings, trades] = await Promise.all([
    readInvestorLedger(sheets, spreadsheetId),
    readPerformanceHistory(sheets, spreadsheetId),
    readHoldingsDetail(sheets, spreadsheetId),
    readTradeLedger(sheets, spreadsheetId),
  ]);

  const isoWeek = isoWeekOf(now);
  const dashboardUrl = process.env.INVESTOR_UPDATE_DASHBOARD_URL?.trim();
  const subjectPrefix = process.env.INVESTOR_UPDATE_SUBJECT_PREFIX?.trim();
  const summaries = computeInvestorSummaries({ ledger, performanceHistory, holdings, trades, now });
  const redis = getRedis();
  const results = [];

  for (const summary of summaries) {
    const update = {
      isoWeek,
      generatedAt: now.toISOString(),
      investorId: summary.investorId,
      email: summary.email,
      name: summary.name,
      value: summary.value,
      netContributed: summary.netContributed,
      gainLoss: summary.gainLoss,
      gainLossPct: summary.gainLossPct,
      units: summary.units,
      navPerUnit: summary.navPerUnit,
      navAsOf: summary.navAsOf,
      weeklyTrades: summary.weeklyTrades,
      topHoldings: summary.topHoldings,
    };
    await setInvestorUpdate(summary.investorId, update);
    await setInvestorUpdate(`email:${summary.email.toLowerCase()}`, update);
  }

  if (!investorUpdatesEnabled()) {
    console.log("[InvestorUpdate] email skipped — INVESTOR_UPDATE_ENABLED is not true; dashboard updates stored.");
    return { skipped: true, sent: 0, failed: 0, stored: summaries.length };
  }

  for (const summary of summaries) {
    const sentKey = sentKeyFor(isoWeek, summary.investorId);
    const reserved = await reserveSend(redis, sentKey);
    if (!reserved) {
      results.push({ email: summary.email, skipped: true, reason: "already sent" });
      continue;
    }

    try {
      const rendered = renderInvestorUpdateEmail(summary, { isoWeek, dashboardUrl, subjectPrefix });
      const idempotencyKey = `investor-update-${isoWeek}-${summary.investorId}`.slice(0, 256);
      const sendResult = await sendEmail({ to: summary.email, ...rendered, idempotencyKey });
      results.push({ email: summary.email, ...sendResult });
    } catch (err) {
      await clearReservation(redis, sentKey);
      console.error(`[InvestorUpdate] failed for ${summary.email}:`, err.message);
      results.push({ email: summary.email, skipped: false, failed: true, error: err.message });
    }
  }

  const sent = results.filter((r) => !r.skipped && !r.failed).length;
  const skipped = results.filter((r) => r.skipped).length;
  const failed = results.filter((r) => r.failed).length;
  const summaryLine = `Investor weekly update ${isoWeek}: sent ${sent}, skipped ${skipped}, failed ${failed}.`;
  console.log(`[InvestorUpdate] ${summaryLine}`);
  if (failed > 0) {
    try {
      await sendTelegram(`${summaryLine}\nCheck portfolio-manager logs for failed recipient details.`);
    } catch (err) {
      console.error("[InvestorUpdate] Telegram failure alert failed:", err.message);
    }
  }
  return { isoWeek, sent, skipped, failed, results };
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  runInvestorWeeklyUpdate().catch((e) => {
    console.error("[InvestorUpdate] error:", e.message);
    process.exit(1);
  });
}
