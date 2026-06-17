import "dotenv/config";
import { fetchQuotes } from "../lib/yahoo.js";
import { getRedis, getCachedSpreadsheetId, setCachedSpreadsheetId } from "../lib/redis.js";
import {
  getServiceAccountClients,
  getOrCreateSpreadsheet,
  getSheetIds,
  readRecommendationsForReview,
  applyOutcomeUpdates,
  writeTrackRecordTab,
} from "../lib/sheets.js";

const HORIZONS = [30, 90, 180]; // calendar days since the recommendation date

function daysSince(dateStr) {
  return (Date.now() - new Date(dateStr).getTime()) / 86400000;
}

/**
 * Reviews past recommendations whose 30/90/180-day forward-return windows have
 * elapsed: pulls current prices, computes return + alpha vs SPY using the entry
 * prices captured at recommendation time, and locks in a directional hit/miss
 * (BUY followed by a gain, or SELL followed by a loss). Each horizon is written
 * once and never recomputed, so later price drift doesn't retroactively change
 * a past outcome. Also refreshes the Track Record tab's aggregate hit-rate stats.
 */
export async function runPerformanceReview() {
  console.log("[Performance] Reviewing past recommendations...");

  const redis = getRedis();
  const { sheets, drive } = getServiceAccountClients();
  let spreadsheetId = await getCachedSpreadsheetId();
  if (!spreadsheetId) {
    spreadsheetId = await getOrCreateSpreadsheet(sheets, drive, redis);
    await setCachedSpreadsheetId(spreadsheetId);
  }
  const sheetIds = await getSheetIds(sheets, spreadsheetId);

  const rows = await readRecommendationsForReview(sheets, spreadsheetId);
  const due = rows.filter(
    (r) => r.entryPrice != null && HORIZONS.some((h) => !r.horizonsDone[h] && daysSince(r.date) >= h)
  );

  if (!due.length) {
    console.log("[Performance] No recommendations due for review.");
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
  console.log(`[Performance] Updated ${updates.length} recommendation rows; track record refreshed.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runPerformanceReview().catch((e) => {
    console.error("[Performance] Review error:", e.message);
    process.exit(1);
  });
}
