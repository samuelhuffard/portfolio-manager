import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchQuotes } from "../lib/yahoo.js";
import {
  getServiceAccountClients,
  resolveSharedSpreadsheetId,
  getSheetIds,
  readPerformanceHistory,
  readInvestorLedger,
  readCashBalance,
  readHoldingsDetail,
  readAllLots,
  appendTradeLedgerEntries,
  applyLotUpdatesToSheet,
  appendInvestorLedgerEntry,
} from "../lib/sheets.js";
import { consumeLotsFIFO, applyLotUpdates } from "../lib/tax-lots.js";
import { normalizeEmail, defaultInvestorId, calculateInvestorLedgerEntry, getInvestorLedgerSecret, getTodayInNewYork } from "../lib/investor-ledger.js";
import { withWorkflowLock } from "../lib/workflow-lock.js";

// Calculates — and, with --commit, records — what an investor withdrawal should
// actually pay out vs. hold back for the capital-gains tax Sam personally owes on
// this Robinhood account (it's his account, not theirs). This is informational
// only: nothing here moves money or sells anything for real. Default is a dry-run
// preview; run --commit only AFTER Sam has manually executed the real sells (if
// any were needed) in Robinhood and decided what to actually pay the investor.
//
//   node scripts/process-withdrawal.js <email> <amount|--full> [--sell-from TICKER:shares ...] [--commit] [--investor-id=user_xxx] [--allow-stale-nav]
//
// Funding order: idle cash first. If that's not enough, Sam must specify exactly
// which positions to sell down via repeated --sell-from TICKER:shares flags — there
// is no automatic pro-rata sweep across the whole portfolio.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TAX_CONFIG = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "config", "tax.json"), "utf8"));

function parseArgs(argv) {
  const [email, amountArg, ...rest] = argv;
  const sellFrom = [];
  let commit = false;
  let allowStaleNav = false;
  let investorId;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--sell-from") {
      const [ticker, sharesStr] = rest[++i].split(":");
      sellFrom.push({ ticker: ticker.toUpperCase(), shares: Number(sharesStr) });
    } else if (rest[i] === "--commit") {
      commit = true;
    } else if (rest[i] === "--allow-stale-nav") {
      allowStaleNav = true;
    } else if (rest[i].startsWith("--investor-id=")) {
      investorId = rest[i].slice("--investor-id=".length);
    }
  }
  return { email, amountArg, sellFrom, commit, allowStaleNav, investorId };
}

const { email, amountArg, sellFrom, commit, allowStaleNav, investorId } = parseArgs(process.argv.slice(2));

if (!email || !amountArg) {
  console.error(
    "Usage: node scripts/process-withdrawal.js <email> <amount|--full> [--sell-from TICKER:shares ...] [--commit] [--investor-id=user_xxx] [--allow-stale-nav]"
  );
  process.exit(1);
}

const { sheets, drive } = getServiceAccountClients();
const spreadsheetId = await resolveSharedSpreadsheetId(sheets, drive);
const sheetIds = await getSheetIds(sheets, spreadsheetId);

const [ledger, history, cashAvailable, holdingsDetail, lots] = await Promise.all([
  readInvestorLedger(sheets, spreadsheetId),
  readPerformanceHistory(sheets, spreadsheetId),
  readCashBalance(sheets, spreadsheetId),
  readHoldingsDetail(sheets, spreadsheetId),
  readAllLots(sheets, spreadsheetId),
]);

const latest = history[history.length - 1];
if (!latest?.navPerUnit) {
  console.error("No NAV per unit on the latest Performance row yet — run holdings:sync first.");
  process.exit(1);
}

const resolvedInvestorId = investorId || defaultInvestorId(email);
const investorUnits = ledger
  .filter((e) => e.investorId === resolvedInvestorId || normalizeEmail(e.email) === normalizeEmail(email))
  .reduce((sum, e) => sum + e.units, 0);
const investorValue = investorUnits * latest.navPerUnit;

if (investorUnits <= 1e-6) {
  console.error(`No units found for ${email} (investorId ${resolvedInvestorId}).`);
  process.exit(1);
}

const requestedAmount = amountArg === "--full" ? investorValue : Number(amountArg);
if (!Number.isFinite(requestedAmount) || requestedAmount <= 0) {
  console.error(`Invalid amount "${amountArg}".`);
  process.exit(1);
}
if (requestedAmount > investorValue + 0.01) {
  console.error(`${email} only holds ${investorUnits.toFixed(4)} units (~$${investorValue.toFixed(2)}) — cannot withdraw $${requestedAmount.toFixed(2)}.`);
  process.exit(1);
}

const shortfall = Math.max(0, requestedAmount - cashAvailable);

console.log(`\nWithdrawal preview for ${email}`);
console.log(`  Requested: $${requestedAmount.toFixed(2)}  (holds $${investorValue.toFixed(2)} / ${investorUnits.toFixed(4)} units)`);
console.log(`  Idle cash available: $${cashAvailable.toFixed(2)}`);

if (shortfall > 0.01 && sellFrom.length === 0) {
  console.log(`  Shortfall: $${shortfall.toFixed(2)} — cash alone doesn't cover this. Current holdings:`);
  for (const h of holdingsDetail) {
    console.log(`    ${h.ticker}: ${h.shares} sh @ $${h.currentPrice ?? "?"} = $${h.marketValue?.toFixed(2) ?? "?"}`);
  }
  console.log(`  Re-run with --sell-from TICKER:shares (repeatable) once you've decided what to sell down.`);
  process.exit(0);
}

let totalRealizedGain = 0;
const tradeRows = [];
let workingLots = lots;
const lotUpdatesById = new Map();

for (const { ticker, shares } of sellFrom) {
  const holding = holdingsDetail.find((h) => h.ticker === ticker);
  const price = holding?.currentPrice;
  if (price == null) {
    console.error(`No current price found for ${ticker} in Holdings — aborting.`);
    process.exit(1);
  }
  const { realizedGain, updatedLots } = consumeLotsFIFO(workingLots, ticker, shares, price);
  totalRealizedGain += realizedGain;
  workingLots = applyLotUpdates(workingLots, updatedLots);
  for (const lot of updatedLots) lotUpdatesById.set(lot.lotId, lot);
  tradeRows.push({
    date: getTodayInNewYork(),
    ticker,
    side: "SELL",
    shares,
    price,
    amount: Math.round(shares * price * 100) / 100,
    orderId: null,
    agentId: "withdrawal",
    proposalId: null,
    realizedGain: Math.round(realizedGain * 100) / 100,
  });
  console.log(`  Sold ${shares} ${ticker} @ $${price} -> realized gain $${realizedGain.toFixed(2)}`);
}

const taxReserve = Math.max(0, totalRealizedGain) * TAX_CONFIG.reserveRatePct;
const netPayout = requestedAmount - taxReserve;

console.log(`\n  Total realized gain triggered: $${totalRealizedGain.toFixed(2)}`);
console.log(`  Tax reserve (${(TAX_CONFIG.reserveRatePct * 100).toFixed(1)}% flat rate): $${taxReserve.toFixed(2)}`);
console.log(`  Suggested net payout to investor: $${netPayout.toFixed(2)}`);
console.log(`  (Informational only — nothing has been moved or held back automatically. You decide the real payout/reserve split.)`);

if (!commit) {
  console.log(`\nDry run only — re-run with --commit after you've executed any real sells and paid the investor.`);
  process.exit(0);
}

let secret;
try {
  secret = getInvestorLedgerSecret();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}

let entryResult;
try {
  entryResult = calculateInvestorLedgerEntry({
    agentId: "portfolio",
    ledger,
    performanceHistory: history,
    email,
    name: email,
    amount: requestedAmount,
    isWithdrawal: true,
    investorId: resolvedInvestorId,
    allowStaleNav,
    secret,
  });
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}

await withWorkflowLock("capital-ledger", async () => {
  const freshLedger = await readInvestorLedger(sheets, spreadsheetId);
  if (freshLedger.some((entry) => entry.entryId === entryResult.entry.entryId)) return;
  if (tradeRows.length) await appendTradeLedgerEntries(sheets, spreadsheetId, sheetIds["Trade Ledger"], tradeRows);
  const lotUpdates = [...lotUpdatesById.values()].filter((l) => l.rowIndex != null);
  if (lotUpdates.length) await applyLotUpdatesToSheet(sheets, spreadsheetId, lotUpdates);
  await appendInvestorLedgerEntry(sheets, spreadsheetId, sheetIds["Investors"], entryResult.entry);
  await (await import("../lib/pg/dual-write.js")).shadowWriteCapitalEntry(entryResult.entry);
});

console.log(`\nCommitted: withdrew $${requestedAmount.toFixed(2)} for ${email}, ${entryResult.entry.units.toFixed(4)} units burned.`);
