import "dotenv/config";
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { fetchQuotes } from "../lib/yahoo.js";
import {
  getLastFillSyncAt,
  setLastFillSyncAt,
  listOpenApprovedProposals,
  markProposalFulfilled,
  setCachedTaxReserveRatePct,
  setCachedPortfolioTotalValue,
} from "../lib/redis.js";
import {
  getServiceAccountClients,
  resolveSharedSpreadsheetId,
  getSheetIds,
  writeHoldingsTab,
  appendPerformanceRow,
  readPerformanceHistory,
  readInvestorLedger,
  writeOverviewTab,
  appendTradeLedgerEntries,
  readAllLots,
  appendLots,
  applyLotUpdatesToSheet,
} from "../lib/sheets.js";
import { matchTradeToApprovedProposal } from "../lib/agent-attribution.js";
import { openLot, consumeLotsFIFO, applyLotUpdates } from "../lib/tax-lots.js";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PYTHON_BIN = process.env.ROBINHOOD_PYTHON?.trim() || path.join(__dirname, "..", "venv", "bin", "python3");
const SCRIPT_PATH = path.join(__dirname, "..", "lib", "robinhood-sync.py");

/**
 * Processes detected Robinhood fills since the last sync: matches each to the
 * approved proposal it most likely fulfills (or "unattributed" if none), then
 * runs it through the FIFO lot ledger (buys open new lots, sells consume the
 * oldest open lots and realize a gain/loss). Writes Trade Ledger + Lots tabs.
 */
async function processFills(sheets, spreadsheetId, sheetIds, fills) {
  if (!fills.length) return;

  const [openProposals, allLots] = await Promise.all([
    listOpenApprovedProposals(),
    readAllLots(sheets, spreadsheetId),
  ]);

  let lots = allLots;
  const newLots = [];
  const tradeRows = [];
  const lotUpdatesByRowIndex = new Map();

  for (const fill of fills) {
    const trade = { ticker: fill.ticker, side: fill.side, shares: fill.shares, price: fill.price, amount: fill.amount, date: fill.date };
    const { agentId, proposalId } = matchTradeToApprovedProposal(trade, openProposals);

    let realizedGain = null;
    if (fill.side === "BUY") {
      const lot = openLot({ ticker: fill.ticker, shares: fill.shares, costPerShare: fill.price, date: fill.date, agentId });
      newLots.push(lot);
      lots = [...lots, lot];
    } else if (fill.side === "SELL") {
      try {
        const { realizedGain: gain, updatedLots } = consumeLotsFIFO(lots, fill.ticker, fill.shares, fill.price);
        realizedGain = gain;
        lots = applyLotUpdates(lots, updatedLots);
        for (const updated of updatedLots) lotUpdatesByRowIndex.set(updated.lotId, updated);
      } catch (err) {
        console.warn(`[Holdings] Could not apply FIFO consumption for SELL ${fill.ticker}: ${err.message}`);
      }
    }

    tradeRows.push({
      date: fill.date,
      ticker: fill.ticker,
      side: fill.side,
      shares: fill.shares,
      price: fill.price,
      amount: fill.amount,
      orderId: fill.orderId,
      agentId,
      proposalId,
      realizedGain,
    });

    if (proposalId) await markProposalFulfilled(proposalId, fill.orderId ?? null);
  }

  await appendTradeLedgerEntries(sheets, spreadsheetId, sheetIds["Trade Ledger"], tradeRows);
  if (newLots.length) await appendLots(sheets, spreadsheetId, sheetIds["Lots"], newLots);
  const lotUpdates = [...lotUpdatesByRowIndex.values()].filter((l) => l.rowIndex != null);
  if (lotUpdates.length) await applyLotUpdatesToSheet(sheets, spreadsheetId, lotUpdates);

  console.log(`[Holdings] Processed ${fills.length} fill(s): ${newLots.length} new lot(s), ${lotUpdates.length} lot(s) updated by sells.`);
}

export async function syncHoldings() {
  console.log("[Holdings] Running robinhood-sync.py...");

  try {
    const taxConfigPath = path.join(__dirname, "..", "config", "tax.json");
    const { reserveRatePct } = JSON.parse(fs.readFileSync(taxConfigPath, "utf8"));
    await setCachedTaxReserveRatePct(reserveRatePct);
  } catch (err) {
    console.warn("[Holdings] Could not read/cache config/tax.json:", err.message);
  }

  const sinceIso = (await getLastFillSyncAt()) || "1970-01-01T00:00:00Z";

  let data;
  try {
    const { stdout } = await execFileAsync(PYTHON_BIN, [SCRIPT_PATH, sinceIso], { timeout: 60000 });
    // robin_stocks prints its own status lines to stdout (e.g. "Logged out
    // successfully.") around our JSON output, so scan from the end for the
    // line that's actually valid JSON instead of assuming it's the last one.
    const lines = stdout.trim().split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        data = JSON.parse(lines[i]);
        break;
      } catch {
        continue;
      }
    }
    if (data === undefined) throw new Error(`No JSON line found in output: ${stdout}`);
  } catch (err) {
    console.error("[Holdings] robinhood-sync.py failed to run — manual re-auth may be needed:", err.message);
    return;
  }

  if (data.error) {
    console.error("[Holdings] robinhood-sync.py error — manual re-auth may be needed:", data.error);
    return;
  }

  const { holdings, cash, fills = [], fillsError, syncedAt } = data;
  console.log(`[Holdings] Synced ${holdings.length} positions from Robinhood.`);
  if (fillsError) console.warn(`[Holdings] Fills fetch failed (continuing without them): ${fillsError}`);

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

  const { sheets, drive } = getServiceAccountClients();
  const spreadsheetId = await resolveSharedSpreadsheetId(sheets, drive);
  const sheetIds = await getSheetIds(sheets, spreadsheetId);

  await processFills(sheets, spreadsheetId, sheetIds, fills);
  if (syncedAt) await setLastFillSyncAt(syncedAt);

  const timestamp = new Date().toLocaleString("en-US", { timeZone: "America/New_York" });
  await writeHoldingsTab(sheets, spreadsheetId, sheetIds["Holdings"], enriched, cash, timestamp);

  const investedValue = enriched.reduce((sum, h) => sum + (h.marketValue ?? 0), 0);
  const totalValue = investedValue + (cash ?? 0);
  await setCachedPortfolioTotalValue(totalValue); // research-scan.js sizes new BUY proposals off this
  const spyPrice = quotes["SPY"]?.regularMarketPrice ?? null;

  // Read history before appending today's row so "first" reflects prior tracking start.
  const history = await readPerformanceHistory(sheets, spreadsheetId);

  // NAV per unit for the investor capital ledger — units outstanding are whatever the
  // ledger says they are; no investors yet means no NAV/unit to compute.
  const ledger = await readInvestorLedger(sheets, spreadsheetId);
  const unitsOutstanding = ledger.reduce((sum, e) => sum + e.units, 0);
  const navPerUnit = unitsOutstanding > 0 ? totalValue / unitsOutstanding : null;

  await appendPerformanceRow(sheets, spreadsheetId, sheetIds["Performance"], {
    date: new Date().toISOString().slice(0, 10),
    portfolioValue: Math.round(totalValue * 100) / 100,
    spyPrice,
    unitsOutstanding: unitsOutstanding > 0 ? Math.round(unitsOutstanding * 10000) / 10000 : null,
    navPerUnit: navPerUnit != null ? Math.round(navPerUnit * 10000) / 10000 : null,
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

  console.log(`[Holdings] Done - ${timestamp}.`);
}

/**
 * Lightweight fill check: calls robinhood-sync.py to see if any new orders have
 * filled since the last sync. If yes, runs the full syncHoldings(). If not,
 * returns without touching Yahoo or Sheets — cheap enough to poll every 5 min.
 */
export async function checkForNewFills() {
  const sinceIso = (await getLastFillSyncAt()) || "1970-01-01T00:00:00Z";
  let data;
  try {
    const { stdout } = await execFileAsync(PYTHON_BIN, [SCRIPT_PATH, sinceIso], { timeout: 60000 });
    const lines = stdout.trim().split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      try { data = JSON.parse(lines[i]); break; } catch { continue; }
    }
    if (!data) return false;
  } catch (err) {
    console.warn("[Holdings] Fill check failed:", err.message);
    return false;
  }
  if (data.error || !data.fills?.length) return false;
  console.log(`[Holdings] ${data.fills.length} new fill(s) detected — triggering full sync.`);
  await syncHoldings();
  return true;
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  syncHoldings().catch((e) => {
    console.error("[Holdings] Sync error:", e.message);
    process.exit(1);
  });
}
