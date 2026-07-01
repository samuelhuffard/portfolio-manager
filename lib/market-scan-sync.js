import "dotenv/config";
import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { getServiceAccountClients, getSheetIds, resolveSharedSpreadsheetId, writeMarketScansTab } from "./sheets.js";
import { setCachedMarketScans, setMarketScanStatus } from "./redis.js";
import { normalizeMarketScanRows } from "./market-scans.js";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PYTHON_BIN = process.env.ROBINHOOD_PYTHON?.trim() || path.join(__dirname, "..", "venv", "bin", "python3");
const SCRIPT_PATH = path.join(__dirname, "robinhood-scan.py");
// Mirrors robinhood-sync.py's timeout — robin_stocks' device-approval prompt can poll
// for up to 120s waiting on a human tap in the Robinhood app.
const ROBINHOOD_SCAN_TIMEOUT_MS = 150_000;

function toScans(data) {
  const syncedAt = new Date().toISOString();
  return {
    syncedAt,
    scans: [
      {
        scanName: "Top Movers Up (S&P 500)",
        results: (data.moversUp ?? []).map((m) => ({ ...m, signal: `Top mover up ${m.changePct ?? ""}%`.trim() })),
      },
      {
        scanName: "Top Movers Down (S&P 500)",
        results: (data.moversDown ?? []).map((m) => ({ ...m, signal: `Top mover down ${m.changePct ?? ""}%`.trim() })),
      },
      {
        scanName: "Top 100 Most Popular",
        results: (data.top100 ?? []).map((m) => ({ ...m, signal: "Top 100 most popular on Robinhood" })),
      },
    ],
  };
}

/**
 * Pulls fresh candidate tickers directly from Robinhood (top movers + most
 * popular) via robin_stocks and writes them to the shared "Market Scans"
 * sheet tab, the same place scripts/sync-market-scans-from-mcp.js writes to.
 *
 * Called at the top of runResearchScan() (jobs/research-scan.js) so every
 * research scan — scheduled 5:15pm run or manual POST /scan — sources
 * tickers outside each agent's static watchlist, instead of relying on the
 * unscheduled, human-run Mac-companion script.
 *
 * Failure here should never block agent research — a stale/empty Market
 * Scans tab just means agents fall back to their static watchlists, same as
 * today. Callers should catch and log, not throw.
 */
export async function syncMarketScansFromRobinhood() {
  const { stdout } = await execFileAsync(PYTHON_BIN, [SCRIPT_PATH], { timeout: ROBINHOOD_SCAN_TIMEOUT_MS });

  let data;
  const lines = stdout.trim().split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      data = JSON.parse(lines[i]);
      break;
    } catch {
      continue;
    }
  }
  if (data === undefined) throw new Error(`No JSON line found in output: ${stdout}`);
  if (data.error) throw new Error(data.error);

  const input = toScans(data);
  const rows = normalizeMarketScanRows(input);

  const { sheets, drive } = getServiceAccountClients();
  const spreadsheetId = await resolveSharedSpreadsheetId(sheets, drive);
  const sheetIds = await getSheetIds(sheets, spreadsheetId);
  if (!sheetIds["Market Scans"]) throw new Error("Market Scans tab is missing after ensureTabs.");

  await writeMarketScansTab(sheets, spreadsheetId, sheetIds["Market Scans"], rows, input.syncedAt);
  await setCachedMarketScans({ syncedAt: input.syncedAt, count: rows.length, rows });
  await setMarketScanStatus({ state: "synced", count: rows.length, error: null });

  return rows.length;
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  syncMarketScansFromRobinhood()
    .then((count) => console.log(`Market scans synced: ${count} row(s).`))
    .catch(async (e) => {
      await setMarketScanStatus({ state: "error", count: 0, error: e.message });
      console.error(`Market scan sync failed: ${e.message}`);
      process.exit(1);
    });
}
