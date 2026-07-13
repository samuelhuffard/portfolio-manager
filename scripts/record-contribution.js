import "dotenv/config";
import { getServiceAccountClients, resolveSharedSpreadsheetId, getSheetIds, readCashBalance, readHoldingsDetail, readPerformanceHistory, readInvestorLedger, appendInvestorLedgerEntry } from "../lib/sheets.js";
import { calculateInvestorLedgerEntry, computeUnattributedCapital, getInvestorLedgerSecret, getTodayInNewYork } from "../lib/investor-ledger.js";
import { withWorkflowLock } from "../lib/workflow-lock.js";

// Records a real contribution or withdrawal into the shared portfolio's capital
// ledger — run by Sam after he's confirmed money was actually received/sent (this
// never moves money itself, only records what already happened, same as every
// other manual-execution boundary in this system).
//
//   node scripts/record-contribution.js <email> "<name>" <amount> --deposit-date=YYYY-MM-DD --idempotency-key=<key>
//
// Units are issued/burned at the portfolio's current NAV per unit (computed from
// the latest Performance row's portfolioValue/unitsOutstanding). The very
// first-ever ledger entry seeds NAV at $1.00/unit (standard fund par-value
// convention) since there's no existing NAV to measure against — pass
// --seed-owner for that one bootstrapping entry. If the portfolio already holds
// value with no ledger yet (e.g. Sam's pre-existing real holdings from before
// this system existed) and --seed-owner wasn't passed, this refuses: seeding for
// a new outside investor would otherwise silently hand them a free claim on
// capital that isn't theirs. Record the true owner of that pre-existing value
// first.

const PORTFOLIO_LABEL = "portfolio";

const [, , email, name, amountStr, ...flags] = process.argv;

if (!email || !name || !amountStr) {
  console.error('Usage: node scripts/record-contribution.js <email> "<name>" <amount> [--withdraw] [--seed-owner] [--investor-id=user_xxx] [--nav-date=YYYY-MM-DD] [--allow-stale-nav]');
  process.exit(1);
}

const amount = Number(amountStr);
if (!Number.isFinite(amount) || amount <= 0) {
  console.error(`Invalid amount "${amountStr}" — must be a positive number.`);
  process.exit(1);
}

const isWithdrawal = flags.includes("--withdraw");
const isSeedOwner = flags.includes("--seed-owner");
const allowStaleNav = flags.includes("--allow-stale-nav");
const investorId = flags.find((f) => f.startsWith("--investor-id="))?.slice("--investor-id=".length);
const navDate = flags.find((f) => f.startsWith("--nav-date="))?.slice("--nav-date=".length);
const depositDate = flags.find((f) => f.startsWith("--deposit-date="))?.slice("--deposit-date=".length);
const idempotencyKey = flags.find((f) => f.startsWith("--idempotency-key="))?.slice("--idempotency-key=".length);
if (navDate && !/^\d{4}-\d{2}-\d{2}$/.test(navDate)) {
  console.error("--nav-date must be YYYY-MM-DD.");
  process.exit(1);
}

const { sheets, drive } = getServiceAccountClients();
const spreadsheetId = await resolveSharedSpreadsheetId(sheets, drive);
const sheetIds = await getSheetIds(sheets, spreadsheetId);

let secret;
try {
  secret = getInvestorLedgerSecret();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}

let result;
let alreadyRecorded = false;
try {
  await withWorkflowLock("capital-ledger", async () => {
    // Every read used to price/validate the entry happens inside the same
    // distributed lock as the append. A concurrent writer therefore cannot
    // observe the same unmatched cash or issue against a stale unit count.
    const [ledger, history, cash, holdings] = await Promise.all([
      readInvestorLedger(sheets, spreadsheetId),
      readPerformanceHistory(sheets, spreadsheetId),
      readCashBalance(sheets, spreadsheetId),
      readHoldingsDetail(sheets, spreadsheetId),
    ]);
    if (ledger.length && (!/^\d{4}-\d{2}-\d{2}$/.test(depositDate ?? "") || !/^[A-Za-z0-9_-]{16,128}$/.test(idempotencyKey ?? ""))) {
      throw new Error("Post-ledger contributions require --deposit-date=YYYY-MM-DD and --idempotency-key=<immutable-key>.");
    }
    if (idempotencyKey && ledger.some((entry) => entry.entryId === idempotencyKey)) {
      alreadyRecorded = true;
      return;
    }
    const preDepositNav = ledger.length
      ? history.filter((row) => row.date < depositDate && Number.isFinite(row.navPerUnit) && row.navPerUnit > 0).sort((a, b) => b.date.localeCompare(a.date))[0]?.navPerUnit
      : null;
    if (ledger.length && !preDepositNav) {
      throw new Error("No NAV strictly before the deposit date is available; refusing to price new cash.");
    }
    if (ledger.length && !isWithdrawal) {
      const unattributed = computeUnattributedCapital(holdings, cash, ledger);
      if (!unattributed.detected || amount > unattributed.amount + 0.01) {
        throw new Error(`Only $${Math.max(0, unattributed.amount).toFixed(2)} of unmatched broker capital is available to assign.`);
      }
    }
    result = calculateInvestorLedgerEntry({
      agentId: PORTFOLIO_LABEL,
      ledger,
      performanceHistory: history,
      email,
      name,
      amount,
      isWithdrawal,
      isSeedOwner,
      investorId,
      navDate,
      pricingNavPerUnit: isWithdrawal ? null : preDepositNav,
      entryId: idempotencyKey,
      allowStaleNav,
      secret,
    });
    await appendInvestorLedgerEntry(sheets, spreadsheetId, sheetIds["Investors"], result.entry);
    await (await import("../lib/pg/dual-write.js")).shadowWriteCapitalEntry(result.entry);
  });
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  if (err instanceof Error && err.message.includes("true owner")) {
    console.error("Record who actually owns the pre-existing value first with --seed-owner.");
  }
  process.exit(1);
}

if (alreadyRecorded) {
  console.log("Idempotent contribution already recorded; no write performed.");
  process.exit(0);
}

if (result.seeded) {
  console.log(`[${PORTFOLIO_LABEL}] First-ever ledger entry - seeding NAV at $1.0000/unit.`);
}

console.log(
  `${isWithdrawal ? "Withdrew" : "Recorded"} investor ledger entry for ${name}. ` +
    `NAV date ${navDate || getTodayInNewYork()}, amount $${amount.toFixed(2)}, ` +
    `${result.entry.units.toFixed(4)} units, ownership ${result.ownershipPct.toFixed(2)}%.`
);

if (!isWithdrawal) {
  console.log(
    "Next: sync the updated Robinhood cash/buying power, then run `node scripts/sync-holdings-from-mcp.js --scan < positions.json` " +
      "or `npm run research:scan` so all three agents can queue cash-capped proposals for approval."
  );
}
