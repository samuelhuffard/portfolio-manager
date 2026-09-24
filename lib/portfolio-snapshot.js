import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { appendPerformanceRow, readInvestorLedger, readPerformanceHistory, writeHoldingsTab, writeOverviewTab } from "./sheets.js";
import { setCachedPortfolioTotalValue, setCachedTaxReserveRatePct } from "./redis.js";
import { shadowReplacePositions, shadowWriteNavSnapshot } from "./pg/dual-write.js";
import { positionsProjectionFromHoldings } from "./pg/positions-projection.js";
import { etDateString } from "./market-calendar.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function round2(value) {
  return Math.round(value * 100) / 100;
}

export async function cacheTaxReserveRate() {
  try {
    const taxConfigPath = path.join(__dirname, "..", "config", "tax.json");
    const { reserveRatePct } = JSON.parse(fs.readFileSync(taxConfigPath, "utf8"));
    await setCachedTaxReserveRatePct(reserveRatePct);
  } catch (err) {
    console.warn("[PortfolioSnapshot] Could not read/cache config/tax.json:", err.message);
  }
}

export function computePortfolioSnapshot({ holdings, cash }) {
  const investedValue = holdings.reduce((sum, h) => sum + (h.marketValue ?? 0), 0);
  const totalValue = investedValue + (cash ?? 0);
  const totalCostBasis = holdings.reduce((sum, h) => sum + (h.costBasis ?? 0), 0);
  const totalGainLoss = holdings.reduce((sum, h) => sum + (h.gainLoss ?? 0), 0);
  const totalGainLossPct = totalCostBasis ? (totalGainLoss / totalCostBasis) * 100 : 0;
  const withPct = holdings.filter((h) => h.gainLossPct != null);
  const best = withPct.length ? withPct.reduce((a, b) => (a.gainLossPct > b.gainLossPct ? a : b)) : null;
  const worst = withPct.length ? withPct.reduce((a, b) => (a.gainLossPct < b.gainLossPct ? a : b)) : null;
  const allocation = holdings
    .filter((h) => h.marketValue != null)
    .map((h) => ({
      ticker: h.ticker,
      name: h.name,
      marketValue: round2(h.marketValue),
      pct: totalValue ? (h.marketValue / totalValue) * 100 : 0,
    }))
    .sort((a, b) => b.marketValue - a.marketValue);

  return {
    investedValue,
    totalValue,
    totalCostBasis,
    totalGainLoss,
    totalGainLossPct,
    best,
    worst,
    allocation,
  };
}

export async function writePortfolioSnapshot({ sheets, spreadsheetId, sheetIds, holdings, cash, spyPrice, timestamp, holdingsNote, quoteSnapshot = null, sourceRequestId = null, sourceInvocationId = null }) {
  if (sourceInvocationId && !sourceRequestId) {
    throw new Error("A source invocation ID requires a verified source request ID.");
  }
  // A Mac MCP job may be redelivered after a crash between the Sheet append and
  // its Redis receipt. The request id is stored beside (but does not rewrite)
  // the signed Performance row, making that retry a no-op rather than a second
  // accounting observation.
  const existingHistory = sourceRequestId ? await readPerformanceHistory(sheets, spreadsheetId) : null;
  const performanceAlreadyRecorded = Boolean(sourceRequestId && existingHistory.some((entry) => entry.sourceRequestId === sourceRequestId));

  await cacheTaxReserveRate();

  await writeHoldingsTab(sheets, spreadsheetId, sheetIds["Holdings"], holdings, cash, timestamp, holdingsNote, quoteSnapshot);

  const snapshot = computePortfolioSnapshot({ holdings, cash });
  await setCachedPortfolioTotalValue(snapshot.totalValue);

  const history = existingHistory ?? await readPerformanceHistory(sheets, spreadsheetId);
  const ledger = await readInvestorLedger(sheets, spreadsheetId);
  const unitsOutstanding = ledger.reduce((sum, e) => sum + e.units, 0);
  const navPerUnit = unitsOutstanding > 0 ? snapshot.totalValue / unitsOutstanding : null;
  // Scheduled drains may finish after midnight ET. The signed invocation is
  // the accounting slot requested by the scheduler, so preserve its date.
  const invocationDate = String(sourceInvocationId ?? "").match(/^(\d{4}-\d{2}-\d{2})\/\d{2}:\d{2}$/)?.[1];
  const snapshotDate = invocationDate ?? etDateString(new Date(timestamp));
  const roundedTotalValue = round2(snapshot.totalValue);
  const roundedUnitsOutstanding = unitsOutstanding > 0 ? Math.round(unitsOutstanding * 10000) / 10000 : 0;
  const roundedNavPerUnit = navPerUnit != null ? Math.round(navPerUnit * 10000) / 10000 : null;

  if (!performanceAlreadyRecorded) {
    await appendPerformanceRow(sheets, spreadsheetId, sheetIds["Performance"], {
      date: snapshotDate,
      portfolioValue: roundedTotalValue,
      spyPrice,
      unitsOutstanding: roundedUnitsOutstanding || null,
      navPerUnit: roundedNavPerUnit,
      sourceRequestId,
      sourceInvocationId,
    });
  }

  let portfolioReturnPct = null;
  let spyReturnPct = null;
  const first = history[0];
  if (first?.portfolioValue) {
    portfolioReturnPct = ((snapshot.totalValue - first.portfolioValue) / first.portfolioValue) * 100;
  }
  if (first?.spyPrice && spyPrice) {
    spyReturnPct = ((spyPrice - first.spyPrice) / first.spyPrice) * 100;
  }

  await writeOverviewTab(sheets, spreadsheetId, sheetIds["Overview"], {
    timestamp,
    totalValue: round2(snapshot.totalValue),
    cash: cash ?? 0,
    investedValue: round2(snapshot.investedValue),
    totalGainLoss: round2(snapshot.totalGainLoss),
    totalGainLossPct: round2(snapshot.totalGainLossPct),
    numHoldings: holdings.length,
    best: snapshot.best,
    worst: snapshot.worst,
    portfolioReturnPct,
    spyReturnPct,
    allocation: snapshot.allocation,
    isSample: false,
  });

  // Non-authoritative Postgres projection. This runs only after every Sheets
  // write above succeeds; the shadow layer is flag-gated and swallows its own
  // failures, so it cannot block or partially replace the authoritative path.
  await shadowReplacePositions(positionsProjectionFromHoldings(holdings), { valuation: quoteSnapshot });
  await shadowWriteNavSnapshot({
    date: snapshotDate,
    totalValue: roundedTotalValue,
    cash: round2(cash ?? 0),
    unitsOutstanding: roundedUnitsOutstanding,
    navPerUnit: roundedNavPerUnit,
  });

  return { ...snapshot, unitsOutstanding, navPerUnit, idempotent: performanceAlreadyRecorded };
}
