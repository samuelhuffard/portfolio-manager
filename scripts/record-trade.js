/**
 * Record one executed MCP trade atomically:
 * 1) validate it against the approved proposal in Redis,
 * 2) append Trade Ledger,
 * 3) open/consume FIFO Lots,
 * 4) mark the proposal fulfilled.
 *
 * Called by a Claude agent session immediately after MCP confirms a fill.
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
 */
import "dotenv/config";
import { getProposalById, markProposalFulfilled } from "../lib/redis.js";
import { recordMcpFill } from "../lib/mcp-accounting.js";
import { getServiceAccountClients, getSheetIds, resolveSharedSpreadsheetId } from "../lib/sheets.js";
import { withWorkflowLock } from "../lib/workflow-lock.js";

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

const missing = ["proposalId", "orderId", "ticker", "side", "shares", "price"].filter((k) => !arg(k));
if (missing.length) {
  console.error(`Missing required args: ${missing.map((k) => `--${k}`).join(", ")}`);
  process.exit(1);
}

const { trade, newLots, updatedLots, alreadyRecorded, needsReconciliation } = await withWorkflowLock("accounting", async () => {
  const { sheets, drive } = getServiceAccountClients();
  const spreadsheetId = await resolveSharedSpreadsheetId(sheets, drive);
  const sheetIds = await getSheetIds(sheets, spreadsheetId);
  const proposal = await getProposalById(proposalId);
  const recorded = await recordMcpFill({
    sheets,
    spreadsheetId,
    sheetIds,
    proposal,
    orderId,
    ticker,
    agentId,
    side,
    shares: sharesRaw,
    price: priceRaw,
  });
  // Do NOT mark fulfilled if the lot ledger could not be reconciled — the trade
  // is recorded and a durable reconciliation record was persisted; the proposal
  // stays open until the lots are repaired (Codex #1 / MCP path coverage).
  if (recorded.needsReconciliation) {
    console.error(`[record-trade] ${ticker} recorded but LOT LEDGER NOT UPDATED — proposal ${proposalId} left unfulfilled, reconciliation record persisted. Repair lots before it can close.`);
  } else {
    await markProposalFulfilled(proposalId, orderId, undefined, recorded.trade.shares);
  }
  return recorded;
}, { ttlSeconds: 5 * 60 });

const fulfillMsg = needsReconciliation
  ? "Trade recorded; proposal LEFT UNFULFILLED pending lot reconciliation"
  : alreadyRecorded ? "Trade already recorded; proposal fulfilled" : "Trade recorded and proposal fulfilled";
console.log(`${fulfillMsg}: ${trade.side} ${trade.shares} ${trade.ticker} @ $${trade.price} = $${trade.amount}`);
console.log(`  Order ID:    ${orderId}`);
console.log(`  Proposal ID: ${proposalId}`);
console.log(`  Lots opened: ${newLots.length}`);
console.log(`  Lots updated: ${updatedLots.length}`);
if (trade.realizedGain != null) console.log(`  Realized:    $${trade.realizedGain}`);
