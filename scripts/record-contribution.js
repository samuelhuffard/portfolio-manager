import "dotenv/config";
import { getServiceAccountClients, resolveSharedSpreadsheetId, getSheetIds, readCashBalance, readHoldingsDetail, readPerformanceHistory, readInvestorLedger, appendInvestorLedgerEntry } from "../lib/sheets.js";
import { calculateInvestorLedgerEntry, computeUnattributedCapital, getInvestorLedgerSecret, getTodayInNewYork } from "../lib/investor-ledger.js";
import { withWorkflowLock } from "../lib/workflow-lock.js";
import { selectPreDepositContributionNav } from "../lib/contribution-nav.js";

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
  console.error('Usage: node scripts/record-contribution.js <email> "<name>" <amount> [--seed-owner] [--investor-id=user_xxx] [--deposit-date=YYYY-MM-DD] [--idempotency-key=<immutable-key>]');
  console.error("Withdrawals: use scripts/process-withdrawal.js — it writes the signed recovery plan and reconciles tax lots.");
  process.exit(1);
}

const amount = Number(amountStr);
if (!Number.isFinite(amount) || amount <= 0) {
  console.error(`Invalid amount "${amountStr}" — must be a positive number.`);
  process.exit(1);
}

// This script records CONTRIBUTIONS only. It used to accept --withdraw, which
// appended an Investors withdrawal row directly — no signed Withdrawal
// Operations plan, no Trade Ledger rows, no tax-lot reconciliation. That made it
// a second withdrawal writer with weaker guarantees than process-withdrawal.js,
// and it silently skipped lot accounting for a securities-funded withdrawal.
// Refuse it loudly: treating it as an unknown flag would record a CONTRIBUTION
// for an operator who asked to withdraw.
if (flags.includes("--withdraw")) {
  console.error("--withdraw is no longer accepted here. Every withdrawal must go through scripts/process-withdrawal.js,");
  console.error("which writes a signed recovery plan before any money state moves and reconciles tax lots.");
  console.error(`  node scripts/process-withdrawal.js ${email} ${amountStr} --commit --idempotency-key=<immutable-key>`);
  process.exit(1);
}
const isSeedOwner = flags.includes("--seed-owner");
const investorId = flags.find((f) => f.startsWith("--investor-id="))?.slice("--investor-id=".length);
const depositDate = flags.find((f) => f.startsWith("--deposit-date="))?.slice("--deposit-date=".length);
const idempotencyKey = flags.find((f) => f.startsWith("--idempotency-key="))?.slice("--idempotency-key=".length);
if (flags.some((flag) => flag === "--allow-stale-nav" || flag.startsWith("--nav-date="))) {
  console.error("--nav-date and --allow-stale-nav are not accepted: capital entries always use a signed 16:30 ET NAV.");
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
let pricingNavDate = null;
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
    // Count, don't just test for existence. A Sheets append that succeeded with
    // a lost response can be retried by the transport, leaving two validly-signed
    // rows for one key. Reporting "already recorded" would silently accept that
    // duplicate, and nothing downstream detects it — both rows verify.
    const recordedForKey = idempotencyKey ? ledger.filter((entry) => entry.entryId === idempotencyKey) : [];
    if (recordedForKey.length > 1) {
      throw new Error(`Investors tab holds ${recordedForKey.length} rows for idempotency key ${idempotencyKey}; remove the duplicate append before re-running.`);
    }
    if (recordedForKey.length === 1) {
      alreadyRecorded = true;
      return;
    }
    const pricingNav = ledger.length ? selectPreDepositContributionNav(history, depositDate) : null;
    pricingNavDate = pricingNav?.date ?? null;
    const pricingNavPerUnit = pricingNav?.navPerUnit ?? null;
    if (ledger.length) {
      const unattributed = computeUnattributedCapital(holdings, cash, ledger);
      if (!unattributed.detected || amount > unattributed.amount + 0.01) {
        throw new Error(`Only $${Math.max(0, unattributed.amount).toFixed(2)} of unmatched broker capital is available to assign.`);
      }
    }
    result = calculateInvestorLedgerEntry({
      agentId: PORTFOLIO_LABEL, ledger, performanceHistory: history, email, name, amount,
      isSeedOwner, investorId, pricingNavPerUnit, entryId: idempotencyKey, secret,
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
  `Recorded investor ledger entry for ${name}. ` +
    `NAV date ${pricingNavDate ?? getTodayInNewYork()}, amount $${amount.toFixed(2)}, ` +
    `${result.entry.units.toFixed(4)} units, ownership ${result.ownershipPct.toFixed(2)}%.`
);

console.log(
  "Next: sync the updated Robinhood cash/buying power, then run `node scripts/sync-holdings-from-mcp.js --scan < positions.json` " +
    "or `npm run research:scan` so all three agents can queue cash-capped proposals for approval."
);
