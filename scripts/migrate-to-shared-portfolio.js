import "dotenv/config";
import { getServiceAccountClients, resolveSharedSpreadsheetId, getSheetIds, agentTabName, readAllLots, appendLots } from "../lib/sheets.js";
import { openLot } from "../lib/tax-lots.js";
import { isSecurityHoldingRow } from "../lib/holdings-rows.js";

// One-off migration for the "3 independent agent pools -> 1 shared portfolio"
// rearchitecture:
//   1. Copies agent-2/agent-3's old standalone-spreadsheet Recommendations rows
//      + Strategy notes into their new single tab on the shared spreadsheet
//      (agent-1's existing spreadsheet, now reused as the one shared portfolio).
//   2. Seeds one "legacy" FIFO lot per currently-held ticker (agentId:
//      "unattributed", since these buys predate the agents) so the new tax-lot
//      ledger has a correct starting cost basis. Safe to re-run — skips legacy
//      seeding if the Lots tab already has rows.
//
// Run once, by hand: node scripts/migrate-to-shared-portfolio.js

const { sheets, drive } = getServiceAccountClients();
const sharedSpreadsheetId = await resolveSharedSpreadsheetId(sheets, drive);
console.log(`Shared spreadsheet: https://docs.google.com/spreadsheets/d/${sharedSpreadsheetId}`);

async function migrateAgentTab(agentId, envVar) {
  const oldSpreadsheetId = process.env[envVar]?.trim();
  if (!oldSpreadsheetId) {
    console.log(`[${agentId}] ${envVar} not set — nothing to migrate.`);
    return;
  }
  if (oldSpreadsheetId === sharedSpreadsheetId) {
    console.log(`[${agentId}] ${envVar} already points at the shared spreadsheet — nothing to migrate.`);
    return;
  }

  const tab = agentTabName(agentId);

  const [recRes, strategyRes] = await Promise.all([
    sheets.spreadsheets.values.get({ spreadsheetId: oldSpreadsheetId, range: "Recommendations!A2:U" }),
    sheets.spreadsheets.values.get({ spreadsheetId: oldSpreadsheetId, range: "Strategy!A2" }),
  ]);

  const recRows = (recRes.data.values || []).filter((row) => row[0]);
  const strategyNotes = strategyRes.data.values?.[0]?.[0] ?? "";

  if (strategyNotes) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: sharedSpreadsheetId,
      range: `${tab}!A3`,
      valueInputOption: "RAW",
      requestBody: { values: [[strategyNotes]] },
    });
  }

  if (recRows.length) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: sharedSpreadsheetId,
      range: `${tab}!A12:U`,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: recRows },
    });
  }

  console.log(`[${agentId}] Migrated ${recRows.length} recommendation row(s) + strategy notes into "${tab}".`);
}

await migrateAgentTab("agent-2", "SPREADSHEET_ID_AGENT_2");
await migrateAgentTab("agent-3", "SPREADSHEET_ID_AGENT_3");

const existingLots = await readAllLots(sheets, sharedSpreadsheetId);
if (existingLots.length) {
  console.log(`Lots tab already has ${existingLots.length} row(s) — skipping legacy lot seeding.`);
} else {
  const holdingsRes = await sheets.spreadsheets.values.get({ spreadsheetId: sharedSpreadsheetId, range: "Holdings!A2:D" });
  const holdingRows = (holdingsRes.data.values || []).filter((row) => isSecurityHoldingRow(row));

  const legacyLots = holdingRows
    .map((row) => ({ ticker: row[0], shares: Number(row[2]), costPerShare: Number(row[3]) }))
    .filter((h) => h.shares > 0 && Number.isFinite(h.costPerShare))
    .map((h) => openLot({ ticker: h.ticker, shares: h.shares, costPerShare: h.costPerShare, date: "legacy", agentId: "unattributed" }));

  if (legacyLots.length) {
    const sheetIds = await getSheetIds(sheets, sharedSpreadsheetId);
    await appendLots(sheets, sharedSpreadsheetId, sheetIds["Lots"], legacyLots);
    console.log(`Seeded ${legacyLots.length} legacy lot(s) from current Holdings (agentId: unattributed).`);
  } else {
    console.log("No current holdings to seed legacy lots from.");
  }
}

console.log("\nMigration done. Next: stop setting SPREADSHEET_ID_AGENT_2/3 on the Jetson (no longer read by any job).");
