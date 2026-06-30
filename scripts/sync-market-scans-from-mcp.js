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

function asNumber(value) {
  if (value == null || value === "") return null;
  const n = Number(String(value).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function asTicker(value) {
  return String(value ?? "").trim().toUpperCase();
}

function normalizeResult(row, scanName, syncedAt) {
  const ticker = asTicker(row.ticker ?? row.symbol);
  if (!ticker) return null;
  return {
    syncedAt,
    scanName: String(row.scanName ?? row.scan ?? scanName ?? "Robinhood MCP").trim(),
    ticker,
    name: String(row.name ?? row.company ?? row.simpleName ?? "").trim(),
    price: asNumber(row.price ?? row.currentPrice ?? row.lastPrice ?? row.last_trade_price),
    changePct: asNumber(row.changePct ?? row.percentChange ?? row.changePercent ?? row.priceChangePct),
    volume: asNumber(row.volume),
    avgVolume: asNumber(row.avgVolume ?? row.averageVolume),
    marketCap: asNumber(row.marketCap),
    signal: String(row.signal ?? row.reason ?? row.scanReason ?? "").trim(),
    score: asNumber(row.score ?? row.rank),
    agentHint: String(row.agentHint ?? row.agentId ?? "").trim(),
    notes: String(row.notes ?? row.note ?? "").trim(),
  };
}

function flattenInput(input) {
  const syncedAt = input.syncedAt ?? new Date().toISOString();
  const rows = [];

  if (Array.isArray(input.results)) {
    for (const row of input.results) rows.push(normalizeResult(row, row.scanName, syncedAt));
  }

  if (Array.isArray(input.scans)) {
    for (const scan of input.scans) {
      const scanName = scan.scanName ?? scan.name ?? scan.title ?? "Robinhood MCP";
      const results = scan.results ?? scan.candidates ?? scan.rows ?? [];
      if (Array.isArray(results)) {
        for (const row of results) rows.push(normalizeResult(row, scanName, syncedAt));
      }
    }
  }

  const seen = new Set();
  return rows
    .filter(Boolean)
    .filter((row) => {
      const key = `${row.scanName}:${row.ticker}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => {
      const scoreA = a.score ?? -Infinity;
      const scoreB = b.score ?? -Infinity;
      if (scoreA !== scoreB) return scoreB - scoreA;
      return a.ticker.localeCompare(b.ticker);
    })
    .slice(0, 250);
}

try {
  const input = await parseJsonFromStdin();
  const rows = flattenInput(input);

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
