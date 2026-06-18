import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchFundamentals, fetchFundamentalsBatch, fetchHistoricalCloses, fetchQuotes, percentChange } from "../lib/yahoo.js";
import { scoreCandidates } from "../lib/quant-scorer.js";
import { tavilySearch } from "../lib/tavily.js";
import { fetchRecentFilings } from "../lib/edgar.js";
import { fetchMacroSnapshot, formatMacroSnapshot } from "../lib/fred.js";
import { getAIRecommendation } from "../lib/ai-overlay.js";
import { applyRiskChecks } from "../lib/risk-engine.js";
import { getCachedSpreadsheetId, setCachedSpreadsheetId, getCachedNews, setCachedNews, getCachedMacro, setCachedMacro } from "../lib/redis.js";
import {
  getServiceAccountClients,
  getOrCreateSpreadsheet,
  ensureTabs,
  getSheetIds,
  readHoldingsTickers,
  readHoldingsAllocation,
  readStrategyNotes,
  appendRecommendations,
} from "../lib/sheets.js";
import { AGENTS } from "../config/agents.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOP_N = 5;

function loadAgentConfig(agentId) {
  const dir = path.join(__dirname, "..", "config", "agents", agentId);
  return {
    watchlist: JSON.parse(fs.readFileSync(path.join(dir, "watchlist.json"), "utf8")),
    weights: JSON.parse(fs.readFileSync(path.join(dir, "weights.json"), "utf8")),
    riskLimits: JSON.parse(fs.readFileSync(path.join(dir, "risk-limits.json"), "utf8")),
    personality: fs.readFileSync(path.join(dir, "personality.md"), "utf8").trim(),
  };
}

/** Runs one agent's full scan (quant score -> AI overlay -> risk engine -> write) against its own watchlist and spreadsheet, fully independent of the other agents. */
async function runResearchScanForAgent(agent) {
  const configuredSpreadsheetId = process.env[agent.spreadsheetEnvVar]?.trim();
  if (!configuredSpreadsheetId) {
    console.log(`[Research] ${agent.id}: ${agent.spreadsheetEnvVar} not set, skipping (not provisioned yet).`);
    return;
  }

  const { watchlist, weights: weightsConfig, riskLimits, personality } = loadAgentConfig(agent.id);
  console.log(`[Research] ${agent.id}: scanning ${watchlist.tickers.length} tickers...`);

  const { sheets, drive } = getServiceAccountClients();
  let spreadsheetId = await getCachedSpreadsheetId(agent.id);
  if (!spreadsheetId) {
    spreadsheetId = await getOrCreateSpreadsheet(sheets, drive, configuredSpreadsheetId);
    await setCachedSpreadsheetId(agent.id, spreadsheetId);
  } else {
    await ensureTabs(sheets, spreadsheetId);
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
      console.warn(`[Research] ${agent.id}: skipping ${f.ticker}: ${f.error}`);
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

  console.log(`[Research] ${agent.id}: running AI overlay for ${toReview.size} tickers...`);
  const spyQuote = await fetchQuotes([watchlist.benchmark]);
  const spyEntryPrice = spyQuote[watchlist.benchmark]?.regularMarketPrice ?? null;

  // Current sector exposure (% of invested capital), for the risk engine's sector-concentration check.
  const heldAllocation = await readHoldingsAllocation(sheets, spreadsheetId);
  const investedTotal = heldAllocation.reduce((sum, h) => sum + (h.marketValue ?? 0), 0);
  const tickerWeightPct = {};
  const sectorWeightPct = {};
  for (const h of heldAllocation) {
    if (!h.marketValue || !investedTotal) continue;
    const weightPct = (h.marketValue / investedTotal) * 100;
    tickerWeightPct[h.ticker] = weightPct;
    const known = candidates.find((c) => c.ticker === h.ticker)?.sector;
    const sector = known ?? (await fetchFundamentals(h.ticker)).sector;
    if (sector) sectorWeightPct[sector] = (sectorWeightPct[sector] ?? 0) + weightPct;
  }

  // Macro backdrop is a shared market fact (not agent memory/opinion) — fetch/cache once globally, not per-agent.
  let macroSnapshot = await getCachedMacro();
  if (!macroSnapshot) {
    macroSnapshot = await fetchMacroSnapshot();
    if (macroSnapshot) await setCachedMacro(macroSnapshot);
  }
  const macroText = formatMacroSnapshot(macroSnapshot);

  const recommendations = [];
  for (const c of toReview.values()) {
    // News is a market fact too — shared cache by ticker is fine and saves Tavily quota across agents.
    let news = await getCachedNews(c.ticker);
    if (!news) {
      try {
        news = await tavilySearch(`${c.ticker} ${c.name} stock news`, { maxResults: 3, days: 7 });
        await setCachedNews(c.ticker, news);
      } catch (err) {
        console.warn(`[Research] ${agent.id}: Tavily search failed for ${c.ticker}:`, err.message);
        news = []; // don't cache — let the next ticker/run retry instead of masking an outage for 12h
      }
    }

    const recentFilings = await fetchRecentFilings(c.ticker, { limit: 3 });

    const proposal = await getAIRecommendation({
      ticker: c.ticker,
      name: c.name,
      quantScore: c.quantScore,
      breakdown: c.breakdown,
      news,
      strategyNotes,
      isHeld: holdingTickers.includes(c.ticker),
      nextEarningsDate: c.nextEarningsDate,
      analystTrend: c.analystTrend,
      insiderActivity: c.insiderActivity,
      recentFilings,
      macro: macroText,
      personality,
    });

    const rec = applyRiskChecks(
      proposal,
      {
        sector: c.sector,
        currentSectorWeightPct: sectorWeightPct[c.sector] ?? 0,
        currentPositionWeightPct: tickerWeightPct[c.ticker] ?? 0,
      },
      riskLimits
    );

    const rationale = [
      rec.thesis,
      rec.risks.length ? `Risks: ${rec.risks.join("; ")}` : null,
      rec.killCriteria.length ? `Kill criteria: ${rec.killCriteria.join("; ")}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    recommendations.push({
      date: new Date().toISOString().slice(0, 10),
      ticker: c.ticker,
      action: rec.action,
      quantScore: c.quantScore,
      rationale,
      newsLinks: news.map((n) => n.url).join(", "),
      status: "pending",
      entryPrice: c.raw?.price?.regularMarketPrice ?? null,
      spyEntryPrice,
      targetWeight: rec.targetWeight,
      confidence: rec.confidence,
      ruleCheck: rec.overrideNotes.length ? rec.overrideNotes.join("; ") : "OK",
    });
  }

  await appendRecommendations(sheets, spreadsheetId, sheetIds["Recommendations"], recommendations);
  console.log(`[Research] ${agent.id}: done — wrote ${recommendations.length} recommendations.`);
}

/** Runs every configured agent's scan in sequence — fully independent watchlists, spreadsheets, and risk limits. One agent's failure doesn't block the others. */
export async function runResearchScan() {
  for (const agent of AGENTS) {
    try {
      await runResearchScanForAgent(agent);
    } catch (err) {
      console.error(`[Research] ${agent.id} failed:`, err.message);
    }
  }
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  runResearchScan().catch((e) => {
    console.error("[Research] Scan error:", e.message);
    process.exit(1);
  });
}
