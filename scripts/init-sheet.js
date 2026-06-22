import "dotenv/config";
import { getServiceAccountClients, resolveSharedSpreadsheetId } from "../lib/sheets.js";

// One-off setup script: `node scripts/init-sheet.js`.
// Provisions/verifies the single shared portfolio spreadsheet (SPREADSHEET_ID env
// var) and ensures all tabs (including each agent's own tab) exist on it.
const { sheets, drive } = getServiceAccountClients();
const spreadsheetId = await resolveSharedSpreadsheetId(sheets, drive);
console.log(`Shared spreadsheet: https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`);
