/**
 * Pre-market check — runs at 8:30 AM ET Mon-Fri.
 *
 * Agent One needs to know what happened overnight before the market opens:
 * macro regime, earnings on the calendar today/tomorrow, and any breaking news
 * on held positions. No proposals are generated here — this is awareness and
 * logging only. The data is cached so the 9:35 AM opening check and intraday
 * monitor can reuse it without re-fetching.
 */

import "dotenv/config";
import { fileURLToPath } from "node:url";
import { fetchQuotes } from "../lib/yahoo.js";
import { fetchMacroSnapshot, formatMacroSnapshot } from "../lib/fred.js";
import { tavilySearch } from "../lib/tavily.js";
import {
  setCachedMacro,
  getCachedNews,
  setCachedNews,
} from "../lib/redis.js";
import {
  getServiceAccountClients,
  resolveSharedSpreadsheetId,
  readHoldingsTickers,
} from "../lib/sheets.js";

const REGIME_TICKERS = ["QQQ", "SPY", "IGV", "SOXX", "^TNX"];

export async function runPremarketCheck() {
  console.log("[Premarket] Starting pre-market check...");

  // 1. Macro snapshot — refresh cache so the day's scans get fresh FRED data
  const macro = await fetchMacroSnapshot();
  if (macro) {
    await setCachedMacro(macro);
    console.log("[Premarket] Macro snapshot refreshed.");
    console.log("[Premarket]", formatMacroSnapshot(macro));
  } else {
    console.warn("[Premarket] Macro snapshot unavailable (FRED_API_KEY not set or fetch failed).");
  }

  // 2. Regime check — QQQ/IGV/SOXX vs recent closes to flag macro gate issues
  try {
    const quotes = await fetchQuotes(REGIME_TICKERS);
    const qqq = quotes["QQQ"]?.regularMarketPrice;
    const spy = quotes["SPY"]?.regularMarketPrice;
    const igv = quotes["IGV"]?.regularMarketPrice;
    const soxx = quotes["SOXX"]?.regularMarketPrice;
    const tny = quotes["^TNX"]?.regularMarketPrice;
    console.log(
      `[Premarket] Regime — QQQ $${qqq} | SPY $${spy} | IGV $${igv} | SOXX $${soxx} | 10Y ${tny}%`
    );
  } catch (e) {
    console.warn("[Premarket] Regime quote fetch failed:", e.message);
  }

  // 3. Overnight news on held positions — refresh Tavily cache so intraday
  //    monitor doesn't burn quota re-fetching what we already just pulled.
  try {
    const { sheets, drive } = getServiceAccountClients();
    const spreadsheetId = await resolveSharedSpreadsheetId(sheets, drive);
    const held = await readHoldingsTickers(sheets, spreadsheetId);

    if (held.length) {
      console.log(`[Premarket] Fetching overnight news for ${held.length} held positions: ${held.join(", ")}`);
      for (const ticker of held) {
        const cached = await getCachedNews(ticker);
        if (!cached) {
          try {
            const news = await tavilySearch(`${ticker} stock news overnight`, { maxResults: 3, days: 1 });
            await setCachedNews(ticker, news);
            if (news.length) console.log(`[Premarket] ${ticker}: ${news.length} overnight item(s)`);
          } catch (e) {
            console.warn(`[Premarket] Tavily failed for ${ticker}:`, e.message);
          }
        }
      }
    } else {
      console.log("[Premarket] No held positions to check.");
    }
  } catch (e) {
    console.warn("[Premarket] Holdings read failed:", e.message);
  }

  console.log("[Premarket] Pre-market check complete.");
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  runPremarketCheck().catch((e) => {
    console.error("[Premarket] Error:", e.message);
    process.exit(1);
  });
}
