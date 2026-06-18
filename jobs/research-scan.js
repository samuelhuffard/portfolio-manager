import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchFundamentalsBatch, fetchHistoricalCloses, fetchQuotes, percentChange } from "../lib/yahoo.js";
import { scoreCandidates } from "../lib/quant-scorer.js";
import { tavilySearch } from "../lib/tavily.js";
import { getAIRecommendation } from "../lib/ai-overlay.js";
import { getRedis, getCachedSpreadsheetId, setCachedSpreadsheetId, getCachedNews, setCachedNews } from "../lib/redis.js";
import {
  getServiceAccountClients,
  getOrCreateSpreadsheet,
  getSheetIds,
  readHoldingsTickers,
  readStrategyNotes,
  appendRecommendations,
} from "../lib/sheets.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const watchlist = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "config", "watchlist.json"), "utf8"));
const weightsConfig = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "config", "weights.json"), "utf8"));

const TOP_N = 5;

export async function runResearchScan() {
  console.log(`[Research] Scanning ${watchlist.tickers.length} tickers...`);

  const redis = getRedis();
  const { sheets, drive } = getServiceAccountClients();
  let spreadsheetId = await getCachedSpreadsheetId();
  if (!spreadsheetId) {
    spreadsheetId = await getOrCreateSpreadsheet(sheets, drive, redis);
    await setCachedSpreadsheetId(spreadsheetId);
  }
  const sheetIds = await getSheetIds(sheets, spreadsheetId);

  const [fundamentals, holdingTickers, strategyNotes] = await Promise.all([
    fetchFundamentalsBatch(watchlist.tickers),
    readHoldingsTickers(sheets, spreadsheetId),
    readStrategyNotes(sheets, spreadsheetId),
  ]);

  const now = new Date();
  const threeMonthsAgo = new Date(now);
  threeMonthsAgo.setMonth(now.getMonth() - 3);
  const oneMonthAgo = new Date(now);
  oneMonthAgo.setMonth(now.getMonth() - 1);

  const candidates = [];
  for (const f of fundamentals) {
    if (f.error) {
      console.warn(`[Research] Skipping ${f.ticker}: ${f.error}`);
      continue;
    }
    const [closes3m, closes1m] = await Promise.all([
      fetchHistoricalCloses(f.ticker, { period1: threeMonthsAgo, period2: now }),
      fetchHistoricalCloses(f.ticker, { period1: oneMonthAgo, period2: now }),
    ]);
    candidates.push({
      ...f,
      momentum3m: percentChange(closes3m),
      momentum1m: percentChange(closes1m),
    });
  }

  const scored = scoreCandidates(candidates, weightsConfig.quant_weights);

  // AI overlay: top quant movers + any current holdings (so held positions get reviewed too)
  const toReview = new Map();
  for (const c of scored.slice(0, TOP_N)) toReview.set(c.ticker, c);
  for (const ticker of holdingTickers) {
    const c = scored.find((s) => s.ticker === ticker);
    if (c) toReview.set(ticker, c);
  }

  console.log(`[Research] Running AI overlay for ${toReview.size} tickers...`);
  const spyQuote = await fetchQuotes([watchlist.benchmark]);
  const spyEntryPrice = spyQuote[watchlist.benchmark]?.regularMarketPrice ?? null;

  const recommendations = [];
  for (const c of toReview.values()) {
    let news = await getCachedNews(c.ticker);
    if (!news) {
      try {
        news = await tavilySearch(`${c.ticker} ${c.name} stock news`, { maxResults: 3, days: 7 });
        await setCachedNews(c.ticker, news);
      } catch (err) {
        console.warn(`[Research] Tavily search failed for ${c.ticker}:`, err.message);
        news = []; // don't cache — let the next ticker/run retry instead of masking an outage for 12h
      }
    }

    const rec = await getAIRecommendation({
      ticker: c.ticker,
      name: c.name,
      quantScore: c.quantScore,
      breakdown: c.breakdown,
      news,
      strategyNotes,
      isHeld: holdingTickers.includes(c.ticker),
    });

    recommendations.push({
      date: new Date().toISOString().slice(0, 10),
      ticker: c.ticker,
      action: rec.action,
      quantScore: c.quantScore,
      rationale: rec.rationale,
      newsLinks: news.map((n) => n.url).join(", "),
      status: "pending",
      entryPrice: c.raw?.price?.regularMarketPrice ?? null,
      spyEntryPrice,
    });
  }

  await appendRecommendations(sheets, spreadsheetId, sheetIds["Recommendations"], recommendations);
  console.log(`[Research] Done — wrote ${recommendations.length} recommendations.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runResearchScan().catch((e) => {
    console.error("[Research] Scan error:", e.message);
    process.exit(1);
  });
}
