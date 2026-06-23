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
import {
  getCachedNews,
  setCachedNews,
  getCachedMacro,
  setCachedMacro,
  getCachedPortfolioTotalValue,
  listAllProposals,
  createProposal,
} from "../lib/redis.js";
import { sizeProposalAmount, hasOpenProposal } from "../lib/proposal-sizing.js";
import {
  getServiceAccountClients,
  resolveSharedSpreadsheetId,
  getSheetIds,
  readHoldingsTickers,
  readHoldingsAllocation,
  readAgentStrategyNotes,
  appendAgentRecommendations,
  agentTabName,
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

/**
 * Runs one agent's full scan (quant score -> AI overlay -> risk engine -> write) against
 * its own watchlist, but the SAME shared portfolio/spreadsheet as the other two agents —
 * so risk checks (sector/position-size limits) see real combined exposure across all
 * three agents, and one agent's proposal can be downgraded because of another agent's
 * existing position. One agent's failure doesn't block the others (see runResearchScan).
 */
async function runResearchScanForAgent(agent, sheets, spreadsheetId, sheetIds) {
  const { watchlist, weights: weightsConfig, riskLimits, personality } = loadAgentConfig(agent.id);
  console.log(`[Research] ${agent.id}: scanning ${watchlist.tickers.length} tickers...`);

  const [fundamentals, holdingTickers, strategyNotes] = await Promise.all([
    fetchFundamentalsBatch(watchlist.tickers),
    readHoldingsTickers(sheets, spreadsheetId),
    readAgentStrategyNotes(sheets, spreadsheetId, agent.id),
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

  // Sizing/dedup context for auto-queueing risk-gated BUY/SELL calls into the approval
  // queue. openProposals is mutated as we queue within this loop so a later ticker (or
  // the next agent's run) doesn't double-queue against a list fetched before this run started.
  const totalPortfolioValue = await getCachedPortfolioTotalValue();
  const openProposals = await listAllProposals();

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

    const entryPrice = c.raw?.price?.regularMarketPrice ?? null;

    // Risk-gated BUY/SELL calls go straight into Sam's approval queue instead of
    // waiting for him to read the Sheet and re-type a proposal by hand. He still
    // approves or rejects every one in the dashboard before anything is placed.
    if (rec.action !== "HOLD" && !hasOpenProposal(openProposals, { agentId: agent.id, ticker: c.ticker, side: rec.action })) {
      const sized = sizeProposalAmount({
        action: rec.action,
        targetWeightPct: rec.targetWeight,
        totalPortfolioValue,
        currentPositionWeightPct: tickerWeightPct[c.ticker] ?? 0,
      });

      if (sized) {
        const maxPrice = rec.action === "BUY" && entryPrice ? Math.round(entryPrice * 1.02 * 100) / 100 : null;
        const riskSummary = `Quant score ${c.quantScore}/100. Confidence ${rec.confidence ?? "n/a"}. Risk checks: ${
          rec.overrideNotes.length ? rec.overrideNotes.join("; ") : "all passed"
        }.${sized.clamped ? " Sized amount clamped to the $10,000 proposal cap." : ""}`;

        try {
          const created = await createProposal({
            agentId: agent.id,
            ticker: c.ticker,
            side: rec.action,
            amountDollars: sized.amountDollars,
            maxPrice,
            rationale,
            riskSummary,
          });
          if (created) {
            openProposals.push(created);
            console.log(`[Research] ${agent.id}: queued ${rec.action} ${c.ticker} proposal ($${sized.amountDollars}).`);
          }
        } catch (err) {
          console.warn(`[Research] ${agent.id}: failed to queue proposal for ${c.ticker}:`, err.message);
        }
      }
    }

    recommendations.push({
      date: new Date().toISOString().slice(0, 10),
      ticker: c.ticker,
      action: rec.action,
      quantScore: c.quantScore,
      rationale,
      newsLinks: news.map((n) => n.url).join(", "),
      status: "pending",
      entryPrice,
      spyEntryPrice,
      targetWeight: rec.targetWeight,
      confidence: rec.confidence,
      ruleCheck: rec.overrideNotes.length ? rec.overrideNotes.join("; ") : "OK",
    });
  }

  await appendAgentRecommendations(sheets, spreadsheetId, sheetIds[agentTabName(agent.id)], agent.id, recommendations);
  console.log(`[Research] ${agent.id}: done — wrote ${recommendations.length} recommendations.`);
}

/** Runs every agent's scan against the shared portfolio in sequence. One agent's failure doesn't block the others. */
export async function runResearchScan() {
  const { sheets, drive } = getServiceAccountClients();
  const spreadsheetId = await resolveSharedSpreadsheetId(sheets, drive);
  const sheetIds = await getSheetIds(sheets, spreadsheetId);

  for (const agent of AGENTS) {
    try {
      await runResearchScanForAgent(agent, sheets, spreadsheetId, sheetIds);
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
