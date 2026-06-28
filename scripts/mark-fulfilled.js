/**
 * Mark an approved proposal as fulfilled after a Robinhood MCP trade executes.
 *
 * Usage: node scripts/mark-fulfilled.js <proposalId> <tradeId>
 *
 * Called by a Claude agent session immediately after the MCP confirms a trade.
 * The tradeId should be whatever the Robinhood MCP returns as the order/trade
 * identifier (e.g. an order_id, execution_id, etc.).
 */
import "dotenv/config";
import { markProposalFulfilled, listOpenApprovedProposals } from "../lib/redis.js";

const [proposalId, tradeId] = process.argv.slice(2);

if (!proposalId || !tradeId) {
  console.error("Usage: node scripts/mark-fulfilled.js <proposalId> <tradeId>");
  process.exit(1);
}

const open = await listOpenApprovedProposals();
const proposal = open.find((p) => p.id === proposalId);

if (!proposal) {
  console.error(`No open approved proposal found with id: ${proposalId}`);
  console.error("Either it doesn't exist, was already fulfilled, or wasn't approved.");
  process.exit(1);
}

await markProposalFulfilled(proposalId, tradeId);

console.log(`Marked fulfilled:`);
console.log(`  Proposal: ${proposalId}`);
console.log(`  Trade ID: ${tradeId}`);
console.log(`  ${proposal.side} ${proposal.ticker} — $${proposal.amountDollars} (${proposal.agentId})`);
