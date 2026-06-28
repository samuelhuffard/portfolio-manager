/**
 * Append one executed trade to the Trade Ledger tab.
 *
 * Called by a Claude agent session immediately after MCP confirms a fill,
 * before or alongside mark-fulfilled.js.
 *
 * Usage:
 *   node scripts/record-trade.js \
 *     --proposalId <id> \
 *     --orderId    <robinhood-order-id> \
 *     --ticker     CRWD \
 *     --side       BUY \
 *     --shares     10.5 \
 *     --price      220.00 \
 *     --agentId    agent-1
 *
 * Optional:
 *   --realizedGain <number>   Realized gain/loss for sells (omit for buys)
 */
import "dotenv/config";
import { getServiceAccountClients, resolveSharedSpreadsheetId, appendTradeLedgerEntries, ensureTabs } from "../lib/sheets.js";

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : null;
}

const proposalId  = arg("proposalId");
const orderId     = arg("orderId");
const ticker      = arg("ticker");
const side        = arg("side");
const sharesRaw   = arg("shares");
const priceRaw    = arg("price");
const agentId     = arg("agentId") ?? "agent-1";
const gainRaw     = arg("realizedGain");

const missing = ["proposalId", "orderId", "ticker", "side", "shares", "price"].filter((k) => !arg(k));
if (missing.length) {
  console.error(`Missing required args: ${missing.map((k) => `--${k}`).join(", ")}`);
  process.exit(1);
}

if (side !== "BUY" && side !== "SELL") {
  console.error(`--side must be BUY or SELL, got: ${side}`);
  process.exit(1);
}

const shares = parseFloat(sharesRaw);
const price  = parseFloat(priceRaw);
const amount = Math.round(shares * price * 100) / 100;
const realizedGain = gainRaw != null ? parseFloat(gainRaw) : null;

const { sheets, drive } = getServiceAccountClients();
const spreadsheetId = await resolveSharedSpreadsheetId(sheets, drive);
const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties" });
const sheetMeta = meta.data.sheets.find((s) => s.properties.title === "Trade Ledger");

if (!sheetMeta) {
  await ensureTabs(sheets, drive, spreadsheetId);
  throw new Error("Trade Ledger tab was missing — ensureTabs just ran, retry now.");
}

const sheetId = sheetMeta.properties.sheetId;

await appendTradeLedgerEntries(sheets, spreadsheetId, sheetId, [{
  date: new Date().toISOString(),
  ticker: ticker.toUpperCase(),
  side,
  shares,
  price,
  amount,
  orderId,
  agentId,
  proposalId,
  realizedGain,
}]);

console.log(`Trade recorded: ${side} ${shares} ${ticker.toUpperCase()} @ $${price} = $${amount}`);
console.log(`  Order ID:    ${orderId}`);
console.log(`  Proposal ID: ${proposalId}`);
if (realizedGain != null) console.log(`  Realized:    $${realizedGain}`);
