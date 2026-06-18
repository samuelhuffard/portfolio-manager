import "dotenv/config";
import { fileURLToPath } from "node:url";
import { fetchQuotes } from "../lib/yahoo.js";
import { getCachedSpreadsheetId, setCachedSpreadsheetId } from "../lib/redis.js";
import {
  getServiceAccountClients,
  getOrCreateSpreadsheet,
  getSheetIds,
  ensureTabs,
  readRecommendationsForReview,
  applyOutcomeUpdates,
  writeTrackRecordTab,
} from "../lib/sheets.js";
import { AGENTS } from "../config/agents.js";

const HORIZONS = [30, 90, 180]; // calendar days since the recommendation date

function daysSince(dateStr) {
  return (Date.now() - new Date(dateStr).getTime()) / 86400000;
}

/**
 * Reviews one agent's past recommendations whose 30/90/180-day forward-return
 * windows have elapsed: pulls current prices, computes return + alpha vs SPY
 * using the entry prices captured at recommendation time, and locks in a
 * directional hit/miss (BUY followed by a gain, or SELL followed by a loss).
 * Each horizon is written once and never recomputed, so later price drift
 * doesn't retroactively change a past outcome. Also refreshes that agent's
 * own Track Record tab — fully independent of the other agents' track records.
 */
async function runPerformanceReviewForAgent(agent) {
  const configuredSpreadsheetId = process.env[agent.spreadsheetEnvVar]?.trim();
  if (!configuredSpreadsheetId) {
    console.log(`[Performance] ${agent.id}: ${agent.spreadsheetEnvVar} not set, skipping (not provisioned yet).`);
    return;
  }

  const { sheets, drive } = getServiceAccountClients();
  let spreadsheetId = await getCachedSpreadsheetId(agent.id);
  if (!spreadsheetId) {
    spreadsheetId = await getOrCreateSpreadsheet(sheets, drive, configuredSpreadsheetId);
    await setCachedSpreadsheetId(agent.id, spreadsheetId);
  } else {
    // getOrCreateSpreadsheet's ensureTabs only runs on a cache miss; run it
    // explicitly here too so newly-added tabs (e.g. Track Record) get created
    // on a spreadsheet that was already cached before this job existed.
    await ensureTabs(sheets, spreadsheetId);
  }
  const sheetIds = await getSheetIds(sheets, spreadsheetId);

  const rows = await readRecommendationsForReview(sheets, spreadsheetId);
  const due = rows.filter(
    (r) => r.entryPrice != null && HORIZONS.some((h) => !r.horizonsDone[h] && daysSince(r.date) >= h)
  );

  if (!due.length) {
    console.log(`[Performance] ${agent.id}: no recommendations due for review.`);
    await writeTrackRecordTab(sheets, spreadsheetId, sheetIds["Track Record"]);
    return;
  }

  const tickers = [...new Set(due.map((r) => r.ticker).concat(["SPY"]))];
  const quotes = await fetchQuotes(tickers);

  const updates = [];
  for (const row of due) {
    const currentPrice = quotes[row.ticker]?.regularMarketPrice;
    const spyPrice = quotes.SPY?.regularMarketPrice;
    if (currentPrice == null) continue;

    const patch = {};
    for (const h of HORIZONS) {
      if (row.horizonsDone[h] || daysSince(row.date) < h) continue;
      const ret = (currentPrice - row.entryPrice) / row.entryPrice;
      const spyRet = row.spyEntryPrice && spyPrice != null ? (spyPrice - row.spyEntryPrice) / row.spyEntryPrice : null;
      const alpha = spyRet != null ? ret - spyRet : null;
      let hit = "N/A";
      if (row.action === "BUY") hit = ret > 0 ? "✅" : "❌";
      else if (row.action === "SELL") hit = ret < 0 ? "✅" : "❌";
      patch[h] = { return: ret, alpha, hit };
    }
    if (Object.keys(patch).length) updates.push({ rowIndex: row.rowIndex, patch });
  }

  await applyOutcomeUpdates(sheets, spreadsheetId, sheetIds["Recommendations"], updates);
  await writeTrackRecordTab(sheets, spreadsheetId, sheetIds["Track Record"]);
  console.log(`[Performance] ${agent.id}: updated ${updates.length} recommendation rows; track record refreshed.`);
}

/** Runs every configured agent's performance review in sequence — fully independent track records. One agent's failure doesn't block the others. */
export async function runPerformanceReview() {
  for (const agent of AGENTS) {
    try {
      await runPerformanceReviewForAgent(agent);
    } catch (err) {
      console.error(`[Performance] ${agent.id} failed:`, err.message);
    }
  }
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  runPerformanceReview().catch((e) => {
    console.error("[Performance] Review error:", e.message);
    process.exit(1);
  });
}
