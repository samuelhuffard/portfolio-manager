import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  getServiceAccountClients,
  resolveSharedSpreadsheetId,
  getSheetIds,
  readPerformanceHistory,
  readInvestorLedger,
  readCashBalance,
  readHoldingsDetail,
  readAllLots,
  readTradeLedger,
  readWithdrawalOperations,
  appendTradeLedgerEntries,
  appendWithdrawalOperation,
  applyLotUpdatesToSheet,
  appendInvestorLedgerEntry,
} from "../lib/sheets.js";
import { consumeLotsFIFO, applyLotUpdates } from "../lib/tax-lots.js";
import { defaultInvestorId, entryMatchesInvestor, getInvestorLedgerSecret, getTodayInNewYork } from "../lib/investor-ledger.js";
import { withWorkflowLock } from "../lib/workflow-lock.js";
import { selectSignedWithdrawalNav } from "../lib/withdrawal-pricing.js";
import { runWithdrawalCommit } from "../lib/withdrawal-commit-runner.js";

// Calculates — and, with --commit, records — what an investor withdrawal should
// actually pay out vs. hold back for the capital-gains tax Sam personally owes on
// this Robinhood account (it's his account, not theirs). This is informational
// only: nothing here moves money or sells anything for real. Default is a dry-run
// preview; run --commit only AFTER Sam has manually executed the real sells (if
// any were needed) in Robinhood and decided what to actually pay the investor.
//
//   node scripts/process-withdrawal.js <email> <amount|--full> [--sell-from TICKER:shares ...] [--commit --idempotency-key=<immutable-key>] [--investor-id=user_xxx]
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
  let investorId;
  let idempotencyKey;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--sell-from") {
      const [ticker, sharesStr] = rest[++i].split(":");
      sellFrom.push({ ticker: ticker.toUpperCase(), shares: Number(sharesStr) });
    } else if (rest[i] === "--commit") {
      commit = true;
    } else if (rest[i].startsWith("--investor-id=")) {
      investorId = rest[i].slice("--investor-id=".length);
    } else if (rest[i].startsWith("--idempotency-key=")) {
      idempotencyKey = rest[i].slice("--idempotency-key=".length);
    }
  }
  return { email, amountArg, sellFrom, commit, investorId, idempotencyKey };
}

const { email, amountArg, sellFrom, commit, investorId, idempotencyKey } = parseArgs(process.argv.slice(2));

if (!email || !amountArg) {
  console.error(
    "Usage: node scripts/process-withdrawal.js <email> <amount|--full> [--sell-from TICKER:shares ...] [--commit --idempotency-key=<immutable-key>] [--investor-id=user_xxx]"
  );
  process.exit(1);
}
if (commit && !/^[A-Za-z0-9_-]{16,128}$/.test(idempotencyKey ?? "")) {
  console.error("--commit requires --idempotency-key=<immutable-key> (16-128 letters, digits, _ or -).");
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

let latest;
try {
  latest = selectSignedWithdrawalNav(history);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

const resolvedInvestorId = investorId || defaultInvestorId(email);
const investorUnits = ledger
  .filter((e) => entryMatchesInvestor(e, { investorId: resolvedInvestorId, email }))
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
let workingLots = lots;

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
let alreadyRecorded = false;
let commitError = null;
let overdrawWarning = null;
await withWorkflowLock("capital-ledger", async () => {
  try {
    const result = await runWithdrawalCommit({
      io: {
        readInvestorLedger: () => readInvestorLedger(sheets, spreadsheetId),
        readPerformanceHistory: () => readPerformanceHistory(sheets, spreadsheetId),
        readAllLots: () => readAllLots(sheets, spreadsheetId),
        readWithdrawalOperations: () => readWithdrawalOperations(sheets, spreadsheetId),
        // Dedupe probe only — read unverified. A legacy unsigned Trade Ledger
        // row must not become a new reason a withdrawal cannot be recorded;
        // keyed rows are separately signature-checked inside the runner.
        readTradeLedger: () => readTradeLedger(sheets, spreadsheetId, { verify: false }),
        appendWithdrawalOperation: (operation) =>
          appendWithdrawalOperation(sheets, spreadsheetId, sheetIds["Withdrawal Operations"], operation),
        appendTradeLedgerEntries: (trades) =>
          appendTradeLedgerEntries(sheets, spreadsheetId, sheetIds["Trade Ledger"], trades),
        applyLotUpdatesToSheet: (lotUpdates) => applyLotUpdatesToSheet(sheets, spreadsheetId, lotUpdates),
        appendInvestorLedgerEntry: (entry) =>
          appendInvestorLedgerEntry(sheets, spreadsheetId, sheetIds["Investors"], entry),
        shadowWriteCapitalEntry: async (entry) =>
          (await import("../lib/pg/dual-write.js")).shadowWriteCapitalEntry(entry),
      },
      idempotencyKey,
      email,
      investorId: resolvedInvestorId,
      requestedAmount,
      sales: sellFrom.map(({ ticker, shares }) => ({
        ticker,
        shares,
        price: holdingsDetail.find((holding) => holding.ticker === ticker)?.currentPrice,
      })),
      previewRealizedGain: totalRealizedGain,
      navSnapshot: latest,
      secret,
      tradeDate: getTodayInNewYork(),
    });
    entryResult = result.entryResult;
    alreadyRecorded = result.alreadyRecorded;
    overdrawWarning = result.overdrawWarning;
  } catch (err) {
    commitError = err;
  }
});

if (commitError) {
  console.error(commitError instanceof Error ? commitError.message : commitError);
  process.exit(1);
}

if (overdrawWarning) {
  const detail = `Replayed withdrawal plan ${idempotencyKey} for ${overdrawWarning.email} leaves ${overdrawWarning.projectedUnits.toFixed(4)} units `
    + `(held ${overdrawWarning.heldUnits.toFixed(4)}, plan burns ${Math.abs(overdrawWarning.units).toFixed(4)}). `
    + `Another capital entry landed between the failed attempt and this retry. The operation was completed because its tax lots and Trade Ledger rows were already committed — reconcile the Investors tab manually.`;
  console.error(`\n*** WITHDRAWAL OVERDRAW ***\n${detail}\n`);
  try {
    const { sendMessage } = await import("../lib/telegram.js");
    await sendMessage(`⚠️ Portfolio Manager: ${detail}`);
  } catch (err) {
    console.error(`[Withdrawal] Telegram overdraw alert failed: ${err instanceof Error ? err.message : err}`);
  }
}

console.log(alreadyRecorded
  ? "Idempotent withdrawal already recorded; no write performed."
  : `\nCommitted: withdrew $${requestedAmount.toFixed(2)} for ${email}, ${entryResult.entry.units.toFixed(4)} units burned.`);
