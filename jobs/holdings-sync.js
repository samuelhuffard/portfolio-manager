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
  bumpRobinhoodSyncFailureStreak,
  clearRobinhoodSyncFailureStreak,
  recordReconciliationNeeded,
} from "../lib/redis.js";
import { withWorkflowLock } from "../lib/workflow-lock.js";
import { planFillProcessing } from "../lib/fill-processing.js";
import { isValidApprovalSignature } from "../lib/proposal-signature.js";
import { shadowWriteLot } from "../lib/pg/dual-write.js";
import { ownershipEnforcementEnabled } from "../lib/ownership-flag.js";
import { sendMessage as sendTelegram } from "../lib/telegram.js";
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
  readTradeLedger,
  readAllLots,
  appendLots,
  applyLotUpdatesToSheet,
} from "../lib/sheets.js";
const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PYTHON_BIN = process.env.ROBINHOOD_PYTHON?.trim() || path.join(__dirname, "..", "venv", "bin", "python3");
const SCRIPT_PATH = path.join(__dirname, "..", "lib", "robinhood-sync.py");
// robin_stocks' device-approval prompt polls for up to 120s waiting on a human tap in the
// Robinhood app (see _validate_sherrif_id in its authentication.py) — 60s was killing the
// child process mid-approval, which meant the session pickle never got written and every
// run re-triggered a fresh device challenge instead of reusing the cached session.
const ROBINHOOD_SYNC_TIMEOUT_MS = 150_000;

// Telegram once per breakage, when the streak first crosses the threshold —
// 3 consecutive failures is over half a trading day of the 5 scheduled syncs,
// which means holdings/NAV are meaningfully stale and re-auth is likely needed.
const SYNC_FAILURE_ALERT_THRESHOLD = 3;

async function reportSyncFailure(reason) {
  const streak = await bumpRobinhoodSyncFailureStreak();
  if (streak !== SYNC_FAILURE_ALERT_THRESHOLD) return;
  const msg = `🚨 Robinhood sync has failed ${streak} times in a row — holdings/NAV are going stale. Manual re-auth is likely needed. Last error: ${reason}`;
  try {
    await sendTelegram(msg);
  } catch (err) {
    console.error("[Holdings] Telegram alert failed:", err.message, "—", msg);
  }
}

/**
 * Processes detected Robinhood fills since the last sync: matches each to the
 * approved proposal it most likely fulfills (or "unattributed" if none), then
 * runs it through the FIFO lot ledger (buys open new lots, sells consume the
 * oldest open lots and realize a gain/loss). Writes Trade Ledger + Lots tabs.
 * The decisions live in lib/fill-processing.js (pure, tested); this wrapper
 * gathers inputs and persists the plan.
 */
async function processFillsUnlocked(sheets, spreadsheetId, sheetIds, fills) {
  if (!fills.length) return;

  const [openProposals, allLots, existingLedger] = await Promise.all([
    listOpenApprovedProposals(),
    readAllLots(sheets, spreadsheetId),
    readTradeLedger(sheets, spreadsheetId),
  ]);

  const plan = planFillProcessing({
    fills,
    existingOrderIds: existingLedger.map((t) => t.orderId).filter(Boolean),
    openProposals,
    lots: allLots,
    // Codex #3: attribute/fulfill only against a VALID signature, not merely a
    // present one — a forged decisionHmac must not be able to claim a fill.
    verifySignature: (p) => isValidApprovalSignature(p),
    // Strategy-lot ownership enforcement (invariant #3) — ON by default now that
    // the MCP path, fail-closed queue, and verify-on-read are in place. Kill
    // switch: ENFORCE_OWNERSHIP=false.
    enforceOwnership: ownershipEnforcementEnabled(),
  });
  for (const f of plan.skipped) console.log(`[Holdings] Skipping already-recorded fill ${f.side} ${f.ticker} (order ${f.orderId}).`);
  for (const warning of plan.warnings) console.warn(`[Holdings] ${warning}`);
  if (!plan.freshFills.length) return;

  await appendTradeLedgerEntries(sheets, spreadsheetId, sheetIds["Trade Ledger"], plan.tradeRows);
  if (plan.newLots.length) {
    await appendLots(sheets, spreadsheetId, sheetIds["Lots"], plan.newLots);
    // Dual-write shadow (ADR 0001): OFF unless PG_DUAL_WRITE=true; never throws.
    for (const lot of plan.newLots) await shadowWriteLot(lot);
  }
  const lotUpdates = plan.lotUpdates.filter((l) => l.rowIndex != null);
  if (lotUpdates.length) {
    await applyLotUpdatesToSheet(sheets, spreadsheetId, lotUpdates);
    // Mirror lifecycle mutations only after the signed Sheet ledger succeeds.
    for (const lot of lotUpdates) await shadowWriteLot(lot);
  }

  // Mark fulfillment only after the ledger write succeeded — the reverse order
  // could leave a proposal "fulfilled" with no ledger row. A fulfillment failure
  // (e.g. companion already marked it) must not abort accounting for other fills.
  for (const row of plan.tradeRows) {
    if (!row.proposalId) continue;
    // A SELL whose lot ledger could not be reconciled (Codex #1 / Decision A):
    // the trade is recorded but the proposal must NOT be marked fulfilled until
    // the lot accounting is repaired, or we'd hide a real broker/ledger mismatch.
    if (row.needsReconciliation) {
      const alert = `[Holdings] SELL ${row.ticker} (proposal ${row.proposalId}, order ${row.orderId ?? "?"}) recorded but LOT LEDGER NOT UPDATED — needs reconciliation. Proposal left unfulfilled. Repair lots before it can close.`;
      console.error(alert);
      // Durable, signed record FIRST — it must survive a missed alert and the
      // order-id dedupe on later syncs (Codex re-review). sysloop surfaces it
      // until a repair clears it; the Telegram is a courtesy on top.
      try {
        await recordReconciliationNeeded({
          orderId: row.orderId, proposalId: row.proposalId, ticker: row.ticker,
          side: row.side, shares: row.shares, reason: "ownership-scoped SELL could not consume strategy-owned lots",
        });
      } catch (err) {
        // Write failed closed — the record could NOT be persisted. Escalate hard:
        // the proposal is already left unfulfilled, but this mismatch is now
        // untracked and needs manual attention.
        const critical = `[Holdings] CRITICAL: could not persist reconciliation record for order ${row.orderId} (${row.side} ${row.ticker}) — mismatch is UNTRACKED. ${err.message}`;
        console.error(critical);
        try { await sendTelegram(critical); } catch { /* already logged */ }
      }
      try { await sendTelegram(alert); } catch (err) { console.error(`[Holdings] reconciliation alert failed: ${err.message}`); }
      continue;
    }
    try {
      await markProposalFulfilled(row.proposalId, row.orderId ?? null);
    } catch (err) {
      console.warn(`[Holdings] Could not mark proposal ${row.proposalId} fulfilled (continuing): ${err.message}`);
    }
  }

  console.log(`[Holdings] Processed ${plan.freshFills.length} fill(s): ${plan.newLots.length} new lot(s), ${lotUpdates.length} lot(s) updated by sells.`);
}

async function processFills(sheets, spreadsheetId, sheetIds, fills) {
  if (!fills.length) return;
  return withWorkflowLock(
    "accounting",
    () => processFillsUnlocked(sheets, spreadsheetId, sheetIds, fills),
    { ttlSeconds: 5 * 60 }
  );
}

async function syncHoldingsUnlocked() {
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
    const { stdout } = await execFileAsync(PYTHON_BIN, [SCRIPT_PATH, sinceIso], { timeout: ROBINHOOD_SYNC_TIMEOUT_MS });
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
    await reportSyncFailure(err.message);
    throw new Error(`Robinhood sync failed: ${err.message}`);
  }

  if (data.error) {
    console.error("[Holdings] robinhood-sync.py error — manual re-auth may be needed:", data.error);
    await reportSyncFailure(data.error);
    throw new Error(`Robinhood sync failed: ${data.error}`);
  }

  await clearRobinhoodSyncFailureStreak();

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

export async function syncHoldings() {
  return withWorkflowLock("holdings-sync", syncHoldingsUnlocked, { ttlSeconds: 10 * 60 });
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  syncHoldings().catch((e) => {
    console.error("[Holdings] Sync error:", e.message);
    process.exit(1);
  });
}
