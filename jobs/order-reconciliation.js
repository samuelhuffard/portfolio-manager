import "dotenv/config";
import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { getServiceAccountClients, readTradeLedger, resolveSharedSpreadsheetId } from "../lib/sheets.js";
import { reconcileOrders, formatReconcileReport } from "../lib/reconcile.js";
import { sendMessage } from "../lib/telegram.js";
import { withWorkflowLock } from "../lib/workflow-lock.js";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PYTHON_BIN = process.env.ROBINHOOD_PYTHON?.trim() || path.join(__dirname, "..", "venv", "bin", "python3");
const SCRIPT_PATH = path.join(__dirname, "..", "lib", "robinhood-sync.py");
const TIMEOUT_MS = 150_000;
const WINDOW_HOURS = Math.max(24, Number(process.env.RECONCILIATION_WINDOW_HOURS ?? 72));

function parseJsonLine(stdout) {
  for (const line of stdout.trim().split("\n").reverse()) {
    try { return JSON.parse(line); } catch { /* robin_stocks can print status lines */ }
  }
  throw new Error("Robinhood reconciliation returned no JSON result.");
}

export async function runOrderReconciliation({ now = Date.now(), exec = execFileAsync } = {}) {
  return withWorkflowLock("order-reconciliation", async () => {
    const since = new Date(now - WINDOW_HOURS * 3600_000).toISOString();
    const { stdout } = await exec(PYTHON_BIN, [SCRIPT_PATH, since], { timeout: TIMEOUT_MS });
    const broker = parseJsonLine(stdout);
    if (broker.error) throw new Error(`Robinhood reconciliation failed: ${broker.error}`);
    if (broker.fillsError) throw new Error(`Robinhood orders unavailable: ${broker.fillsError}`);

    const { sheets, drive } = getServiceAccountClients();
    const spreadsheetId = await resolveSharedSpreadsheetId(sheets, drive);
    const ledger = await readTradeLedger(sheets, spreadsheetId);
    const result = reconcileOrders({ brokerOrders: broker.fills ?? [], ledger });
    const report = formatReconcileReport(result);
    console.log(`[Reconcile] ${report}`);
    if (result.missingFromLedger.length || result.malformed.length) {
      try { await sendMessage(`🚨 Portfolio reconcile:\n${report}`); } catch (err) { console.error("[Reconcile] Telegram alert failed:", err.message); }
      throw new Error(`Reconciliation mismatch: ${result.missingFromLedger.length} missing, ${result.malformed.length} malformed.`);
    }
    return result;
  }, { ttlSeconds: 5 * 60 });
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  runOrderReconciliation().catch((error) => { console.error("[Reconcile] error:", error.message); process.exit(1); });
}
