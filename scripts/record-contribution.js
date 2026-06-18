import "dotenv/config";
import { getCachedSpreadsheetId, setCachedSpreadsheetId } from "../lib/redis.js";
import { getServiceAccountClients, getOrCreateSpreadsheet, ensureTabs, getSheetIds, readPerformanceHistory, readInvestorLedger, appendInvestorLedgerEntry } from "../lib/sheets.js";
import { AGENTS } from "../config/agents.js";

// Records a real contribution or withdrawal into one agent's capital ledger —
// run by Sam after he's confirmed money was actually received/sent (this never
// moves money itself, only records what already happened, same as every other
// manual-execution boundary in this system).
//
//   node scripts/record-contribution.js <agentId> <email> "<name>" <amount> [--withdraw|--seed-owner]
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

const [, , agentId, email, name, amountStr, flag] = process.argv;

if (!agentId || !email || !name || !amountStr) {
  console.error('Usage: node scripts/record-contribution.js <agentId> <email> "<name>" <amount> [--withdraw|--seed-owner]');
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

const isWithdrawal = flag === "--withdraw";
const isSeedOwner = flag === "--seed-owner";

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
const unitsOutstandingBefore = ledger.reduce((sum, e) => sum + e.units, 0);

let navPerUnit;
if (unitsOutstandingBefore <= 0) {
  if (!isSeedOwner) {
    const history = await readPerformanceHistory(sheets, spreadsheetId);
    const existingValue = history[history.length - 1]?.portfolioValue ?? 0;
    if (existingValue > 1) {
      console.error(
        `[${agentId}] This agent already holds $${existingValue.toFixed(2)} of value with no investor ledger yet. ` +
        `Seeding NAV at $1.00/unit now would give ${name} a free claim on that pre-existing capital. ` +
        `Record who actually owns it first:\n  node scripts/record-contribution.js ${agentId} <owner-email> "<owner-name>" ${existingValue.toFixed(2)} --seed-owner`
      );
      process.exit(1);
    }
  }
  navPerUnit = 1.0;
  console.log(`[${agentId}] First-ever ledger entry — seeding NAV at $1.0000/unit.`);
} else {
  const history = await readPerformanceHistory(sheets, spreadsheetId);
  const latest = history[history.length - 1];
  if (latest?.navPerUnit != null) {
    navPerUnit = latest.navPerUnit;
  } else if (latest?.portfolioValue != null) {
    navPerUnit = latest.portfolioValue / unitsOutstandingBefore;
  } else {
    console.error(`[${agentId}] No Performance history with a portfolio value yet — can't price units. Run holdings-sync first.`);
    process.exit(1);
  }
}

const units = (isWithdrawal ? -1 : 1) * (amount / navPerUnit);
if (isWithdrawal) {
  const existingUnits = ledger.filter((e) => e.email.toLowerCase() === email.toLowerCase()).reduce((sum, e) => sum + e.units, 0);
  if (Math.abs(units) > existingUnits + 1e-6) {
    console.error(`[${agentId}] ${email} only holds ${existingUnits.toFixed(4)} units (~$${(existingUnits * navPerUnit).toFixed(2)}) — can't withdraw $${amount}.`);
    process.exit(1);
  }
}

await appendInvestorLedgerEntry(sheets, spreadsheetId, sheetIds["Investors"], {
  date: new Date().toISOString().slice(0, 10),
  email,
  name,
  type: isWithdrawal ? "Withdrawal" : "Contribution",
  amount,
  navPerUnit: Math.round(navPerUnit * 10000) / 10000,
  units: Math.round(units * 10000) / 10000,
});

const unitsOutstandingAfter = unitsOutstandingBefore + units;
const investorUnitsAfter = ledger.filter((e) => e.email.toLowerCase() === email.toLowerCase()).reduce((sum, e) => sum + e.units, 0) + units;
const ownershipPct = unitsOutstandingAfter > 0 ? (investorUnitsAfter / unitsOutstandingAfter) * 100 : 0;

console.log(
  `[${agentId}] ${isWithdrawal ? "Withdrew" : "Recorded"} $${amount.toFixed(2)} for ${name} (${email}) at $${navPerUnit.toFixed(4)}/unit → ${units.toFixed(4)} units. ${name} now holds ${investorUnitsAfter.toFixed(4)} units (${ownershipPct.toFixed(2)}% of the fund).`
);
