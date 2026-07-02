import "dotenv/config";
import { getServiceAccountClients, resolveSharedSpreadsheetId, readTradeLedger } from "../lib/sheets.js";
import { reconcileOrders, formatReconcileReport } from "../lib/reconcile.js";
import { sendMessage } from "../lib/telegram.js";

// Broker-vs-ledger reconciliation (report-only — never writes the ledger).
// Reads a JSON object {"orders": [...]} on stdin: the day's equity orders as
// returned by the Robinhood MCP get_equity_orders (the Mac companion pipes
// this in daily after close; a human session can too — read-only tools only).
//
// Any FILLED broker order missing from the Trade Ledger is reported to stdout
// and pushed via Telegram. Fixing the books stays a deliberate human step
// (scripts/record-trade.js or an unattributed append) — this job only makes
// the gap impossible to miss.

let input = "";
for await (const chunk of process.stdin) input += chunk;

let parsed;
try {
  parsed = JSON.parse(input);
} catch (err) {
  console.error(`[Reconcile] Could not parse stdin JSON: ${err.message}`);
  process.exit(1);
}
const brokerOrders = Array.isArray(parsed?.orders) ? parsed.orders : Array.isArray(parsed) ? parsed : null;
if (!brokerOrders) {
  console.error('[Reconcile] Expected {"orders": [...]} on stdin.');
  process.exit(1);
}

const { sheets, drive } = getServiceAccountClients();
const spreadsheetId = await resolveSharedSpreadsheetId(sheets, drive);
const ledger = await readTradeLedger(sheets, spreadsheetId);

const result = reconcileOrders({ brokerOrders, ledger });
const report = formatReconcileReport(result);
console.log(report);

if (result.missingFromLedger.length || result.malformed.length) {
  try {
    await sendMessage(`🚨 Portfolio reconcile: ${report}`);
  } catch (err) {
    console.error(`[Reconcile] Telegram alert failed: ${err.message}`);
  }
  process.exit(2); // non-zero so the companion also logs/alerts on its side
}
