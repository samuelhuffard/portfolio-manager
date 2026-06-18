import "dotenv/config";
import { getCachedSpreadsheetId, setCachedSpreadsheetId } from "../lib/redis.js";
import { getServiceAccountClients, getOrCreateSpreadsheet, ensureTabs, getSheetIds, readPerformanceHistory, readInvestorLedger, appendInvestorLedgerEntry } from "../lib/sheets.js";
import { calculateInvestorLedgerEntry, getInvestorLedgerSecret, getTodayInNewYork } from "../lib/investor-ledger.js";
import { AGENTS } from "../config/agents.js";

// Records a real contribution or withdrawal into one agent's capital ledger —
// run by Sam after he's confirmed money was actually received/sent (this never
// moves money itself, only records what already happened, same as every other
// manual-execution boundary in this system).
//
//   node scripts/record-contribution.js <agentId> <email> "<name>" <amount> [--withdraw] [--seed-owner] [--investor-id=user_xxx] [--nav-date=YYYY-MM-DD] [--allow-stale-nav]
//
// Units are issued/burned at the agent's current NAV per unit (computed from the
// latest Performance row's portfolioValue/unitsOutstanding). The very first-ever
// ledger entry for an agent seeds NAV at $1.00/unit (standard fund par-value
// convention) since there's no existing NAV to measure against — pass --seed-owner
// for that one bootstrapping entry. If the agent already holds value with no
// ledger yet (e.g. agent-1's pre-existing real holdings from before this system
// existed) and --seed-owner wasn't passed, this refuses: seeding for a new outside
// investor would otherwise silently hand them a free claim on capital that isn't
// theirs. Record the true owner of that pre-existing value first.

const [, , agentId, email, name, amountStr, ...flags] = process.argv;

if (!agentId || !email || !name || !amountStr) {
  console.error('Usage: node scripts/record-contribution.js <agentId> <email> "<name>" <amount> [--withdraw] [--seed-owner] [--investor-id=user_xxx] [--nav-date=YYYY-MM-DD] [--allow-stale-nav]');
  process.exit(1);
}

const agent = AGENTS.find((a) => a.id === agentId);
if (!agent) {
  console.error(`Unknown agent "${agentId}". Known agents: ${AGENTS.map((a) => a.id).join(", ")}`);
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
if (navDate && !/^\d{4}-\d{2}-\d{2}$/.test(navDate)) {
  console.error("--nav-date must be YYYY-MM-DD.");
  process.exit(1);
}

const configuredSpreadsheetId = process.env[agent.spreadsheetEnvVar]?.trim();
if (!configuredSpreadsheetId) {
  console.error(`${agent.spreadsheetEnvVar} is not set — provision ${agentId}'s spreadsheet first (see scripts/init-sheet.js).`);
  process.exit(1);
}

const { sheets, drive } = getServiceAccountClients();
let spreadsheetId = await getCachedSpreadsheetId(agentId);
if (!spreadsheetId) {
  spreadsheetId = await getOrCreateSpreadsheet(sheets, drive, configuredSpreadsheetId);
  await setCachedSpreadsheetId(agentId, spreadsheetId);
} else {
  await ensureTabs(sheets, spreadsheetId);
}
const sheetIds = await getSheetIds(sheets, spreadsheetId);

const ledger = await readInvestorLedger(sheets, spreadsheetId);
const history = await readPerformanceHistory(sheets, spreadsheetId);
let secret;
try {
  secret = getInvestorLedgerSecret();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}

let result;
try {
  result = calculateInvestorLedgerEntry({
    agentId,
    ledger,
    performanceHistory: history,
    email,
    name,
    amount,
    isWithdrawal,
    isSeedOwner,
    investorId,
    navDate,
    allowStaleNav,
    secret,
  });
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  if (err instanceof Error && err.message.includes("true owner")) {
    const existingValue = history[history.length - 1]?.portfolioValue ?? amount;
    console.error(`Record who actually owns it first:\n  node scripts/record-contribution.js ${agentId} <owner-email> "<owner-name>" ${existingValue.toFixed(2)} --seed-owner --investor-id=<clerk-user-id>`);
  }
  process.exit(1);
}

if (result.seeded) {
  console.log(`[${agentId}] First-ever ledger entry - seeding NAV at $1.0000/unit.`);
}

await appendInvestorLedgerEntry(sheets, spreadsheetId, sheetIds["Investors"], result.entry);

console.log(
  `[${agentId}] ${isWithdrawal ? "Withdrew" : "Recorded"} investor ledger entry for ${name}. ` +
    `NAV date ${navDate || getTodayInNewYork()}, amount $${amount.toFixed(2)}, ` +
    `${result.entry.units.toFixed(4)} units, ownership ${result.ownershipPct.toFixed(2)}%.`
);
