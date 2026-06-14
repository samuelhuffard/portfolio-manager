import "dotenv/config";
import { getRedis, getCachedSpreadsheetId, setCachedSpreadsheetId } from "../lib/redis.js";
import { getServiceAccountClients, getOrCreateSpreadsheet } from "../lib/sheets.js";

const redis = getRedis();
const { sheets, drive } = getServiceAccountClients();

let spreadsheetId = await getCachedSpreadsheetId();
if (!spreadsheetId) {
  spreadsheetId = await getOrCreateSpreadsheet(sheets, drive, redis);
  await setCachedSpreadsheetId(spreadsheetId);
  console.log("Created new spreadsheet:", spreadsheetId);
} else {
  console.log("Spreadsheet already exists:", spreadsheetId);
}

console.log(`https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`);
