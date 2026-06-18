import "dotenv/config";
import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { fetchQuotes } from "../lib/yahoo.js";
import { getRedis, getCachedSpreadsheetId, setCachedSpreadsheetId } from "../lib/redis.js";
import {
  getServiceAccountClients,
  getOrCreateSpreadsheet,
  getSheetIds,
  writeHoldingsTab,
  appendPerformanceRow,
  readPerformanceHistory,
  writeOverviewTab,
} from "../lib/sheets.js";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PYTHON_BIN = process.env.ROBINHOOD_PYTHON?.trim() || path.join(__dirname, "..", "venv", "bin", "python3");
const SCRIPT_PATH = path.join(__dirname, "..", "lib", "robinhood-sync.py");

export async function syncHoldings() {
  console.log("[Holdings] Running robinhood-sync.py...");

  let data;
  try {
    const { stdout } = await execFileAsync(PYTHON_BIN, [SCRIPT_PATH], { timeout: 60000 });
    const lastLine = stdout.trim().split("\n").pop();
    data = JSON.parse(lastLine);
  } catch (err) {
    console.error("[Holdings] robinhood-sync.py failed to run — manual re-auth may be needed:", err.message);
    return;
  }

  if (data.error) {
    console.error("[Holdings] robinhood-sync.py error — manual re-auth may be needed:", data.error);
    return;
  }

  const { holdings, cash, portfolioValue } = data;
  console.log(`[Holdings] Synced ${holdings.length} positions — portfolio value $${portfolioValue}`);

  const tickers = holdings.map((h) => h.ticker);
  const quotes = await fetchQuotes([...tickers, "SPY"]);

  const enriched = holdings.map((h) => {
    const price = quotes[h.ticker]?.regularMarketPrice ?? null;
    const marketValue = price != null ? price * h.shares : null;
    const costBasis = h.avgCost * h.shares;
    const gainLoss = marketValue != null ? marketValue - costBasis : null;
    const gainLossPct = marketValue != null && costBasis ? (gainLoss / costBasis) * 100 : null;
    return {
      ...h,
      name: quotes[h.ticker]?.longName ?? quotes[h.ticker]?.shortName ?? h.ticker,
      currentPrice: price,
      marketValue,
      costBasis,
      gainLoss,
      gainLossPct,
    };
  });

  const redis = getRedis();
  const { sheets, drive } = getServiceAccountClients();
  let spreadsheetId = await getCachedSpreadsheetId();
  if (!spreadsheetId) {
    spreadsheetId = await getOrCreateSpreadsheet(sheets, drive, redis);
    await setCachedSpreadsheetId(spreadsheetId);
  }
  const sheetIds = await getSheetIds(sheets, spreadsheetId);

  const timestamp = new Date().toLocaleString("en-US", { timeZone: "America/New_York" });
  await writeHoldingsTab(sheets, spreadsheetId, sheetIds["Holdings"], enriched, cash, timestamp);

  const investedValue = enriched.reduce((sum, h) => sum + (h.marketValue ?? 0), 0);
  const totalValue = investedValue + (cash ?? 0);
  const spyPrice = quotes["SPY"]?.regularMarketPrice ?? null;

  // Read history before appending today's row so "first" reflects prior tracking start.
  const history = await readPerformanceHistory(sheets, spreadsheetId);

  await appendPerformanceRow(sheets, spreadsheetId, sheetIds["Performance"], {
    date: new Date().toISOString().slice(0, 10),
    portfolioValue: Math.round(totalValue * 100) / 100,
    spyPrice,
  });

  let portfolioReturnPct = null;
  let spyReturnPct = null;
  const first = history[0];
  if (first?.portfolioValue) {
    portfolioReturnPct = ((totalValue - first.portfolioValue) / first.portfolioValue) * 100;
  }
  if (first?.spyPrice && spyPrice) {
    spyReturnPct = ((spyPrice - first.spyPrice) / first.spyPrice) * 100;
  }

  const totalCostBasis = enriched.reduce((sum, h) => sum + (h.costBasis ?? 0), 0);
  const totalGainLoss = enriched.reduce((sum, h) => sum + (h.gainLoss ?? 0), 0);
  const totalGainLossPct = totalCostBasis ? (totalGainLoss / totalCostBasis) * 100 : 0;

  const withPct = enriched.filter((h) => h.gainLossPct != null);
  const best = withPct.length ? withPct.reduce((a, b) => (a.gainLossPct > b.gainLossPct ? a : b)) : null;
  const worst = withPct.length ? withPct.reduce((a, b) => (a.gainLossPct < b.gainLossPct ? a : b)) : null;

  const allocation = enriched
    .filter((h) => h.marketValue != null)
    .map((h) => ({
      ticker: h.ticker,
      name: h.name,
      marketValue: Math.round(h.marketValue * 100) / 100,
      pct: totalValue ? (h.marketValue / totalValue) * 100 : 0,
    }))
    .sort((a, b) => b.marketValue - a.marketValue);

  await writeOverviewTab(sheets, spreadsheetId, sheetIds["Overview"], {
    timestamp,
    totalValue: Math.round(totalValue * 100) / 100,
    cash: cash ?? 0,
    investedValue: Math.round(investedValue * 100) / 100,
    totalGainLoss: Math.round(totalGainLoss * 100) / 100,
    totalGainLossPct: Math.round(totalGainLossPct * 100) / 100,
    numHoldings: enriched.length,
    best,
    worst,
    portfolioReturnPct,
    spyReturnPct,
    allocation,
    isSample: false,
  });

  console.log(`[Holdings] Done — ${timestamp}. Total value: $${totalValue.toFixed(2)}`);
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  syncHoldings().catch((e) => {
    console.error("[Holdings] Sync error:", e.message);
    process.exit(1);
  });
}
