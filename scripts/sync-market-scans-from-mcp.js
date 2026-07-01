/**
 * Write Robinhood Agentic MCP market scan results to the shared portfolio sheet.
 *
 * This script is intentionally read-only with respect to Robinhood. The Mac
 * companion calls Robinhood MCP scanner/market-data tools, asks Claude to return
 * JSON, and pipes that JSON here for storage.
 *
 * Usage: node scripts/sync-market-scans-from-mcp.js < scans.json
 *
 * Accepted input shapes:
 * {
 *   "syncedAt": "2026-06-30T15:00:00.000Z",
 *   "scans": [
 *     {
 *       "scanName": "Momentum + Volume",
 *       "results": [
 *         {
 *           "ticker": "NVDA",
 *           "name": "NVIDIA",
 *           "price": 196.4,
 *           "changePct": 2.1,
 *           "volume": 12345678,
 *           "avgVolume": 9876543,
 *           "marketCap": 4800000000000,
 *           "signal": "High relative volume with positive trend",
 *           "score": 92,
 *           "agentHint": "agent-1",
 *           "notes": "Optional context"
 *         }
 *       ]
 *     }
 *   ]
 * }
 *
 * Also accepts { "results": [...] } for already-flattened rows.
 */
import "dotenv/config";
import { getServiceAccountClients, getSheetIds, resolveSharedSpreadsheetId, writeMarketScansTab } from "../lib/sheets.js";
import { setCachedMarketScans, setMarketScanStatus } from "../lib/redis.js";
import { normalizeMarketScanRows } from "../lib/market-scans.js";

function parseJsonFromStdin() {
  return new Promise((resolve, reject) => {
    let buf = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { buf += chunk; });
    process.stdin.on("end", () => {
      try { resolve(JSON.parse(buf)); }
      catch (err) { reject(new Error(`stdin is not valid JSON: ${err.message}`)); }
    });
    process.stdin.on("error", reject);
  });
}

try {
  const input = await parseJsonFromStdin();
  const rows = normalizeMarketScanRows(input);

  const { sheets, drive } = getServiceAccountClients();
  const spreadsheetId = await resolveSharedSpreadsheetId(sheets, drive);
  const sheetIds = await getSheetIds(sheets, spreadsheetId);
  if (!sheetIds["Market Scans"]) throw new Error("Market Scans tab is missing after ensureTabs.");

  const syncedAt = input.syncedAt ?? new Date().toISOString();
  await writeMarketScansTab(sheets, spreadsheetId, sheetIds["Market Scans"], rows, syncedAt);
  await setCachedMarketScans({ syncedAt, count: rows.length, rows });
  await setMarketScanStatus({ state: "synced", count: rows.length, error: null });

  console.log(`Market scans synced: ${rows.length} row(s).`);
} catch (err) {
  await setMarketScanStatus({ state: "error", count: 0, error: err.message });
  console.error(`Market scan sync failed: ${err.message}`);
  process.exit(1);
}
