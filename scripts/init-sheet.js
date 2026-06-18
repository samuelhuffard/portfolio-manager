import "dotenv/config";
import { getCachedSpreadsheetId, setCachedSpreadsheetId } from "../lib/redis.js";
import { getServiceAccountClients, getOrCreateSpreadsheet } from "../lib/sheets.js";
import { AGENTS } from "../config/agents.js";

// One-off setup script: `node scripts/init-sheet.js [agentId]` (defaults to agent-1).
// Provisions/verifies the spreadsheet for a single agent — run once per agent
// after creating + sharing its blank Sheet with the service account, with its
// SPREADSHEET_ID_* env var already set.
const agentId = process.argv[2] || "agent-1";
const agent = AGENTS.find((a) => a.id === agentId);
if (!agent) {
  console.error(`Unknown agent "${agentId}". Known agents: ${AGENTS.map((a) => a.id).join(", ")}`);
  process.exit(1);
}

const configuredSpreadsheetId = process.env[agent.spreadsheetEnvVar]?.trim();
if (!configuredSpreadsheetId) {
  console.error(`${agent.spreadsheetEnvVar} is not set — create a blank Sheet, share it with the service account as Editor, then set that env var.`);
  process.exit(1);
}

const { sheets, drive } = getServiceAccountClients();

let spreadsheetId = await getCachedSpreadsheetId(agentId);
if (!spreadsheetId) {
  spreadsheetId = await getOrCreateSpreadsheet(sheets, drive, configuredSpreadsheetId);
  await setCachedSpreadsheetId(agentId, spreadsheetId);
  console.log(`[${agentId}] Initialized spreadsheet:`, spreadsheetId);
} else {
  console.log(`[${agentId}] Spreadsheet already cached:`, spreadsheetId);
}

console.log(`https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`);
