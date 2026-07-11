import { test } from "node:test";
import assert from "node:assert/strict";
import { planFillProcessing } from "../lib/fill-processing.js";
import { applyFillToLots } from "../lib/mcp-accounting.js";
import { openLot } from "../lib/tax-lots.js";

// Wave 1: the enforceOwnership flag on the two lot-consuming SELL paths. OFF by
// default (no behavior change until a reviewed flip); ON enforces invariant #3.

function mixedNvda() {
  return [
    openLot({ ticker: "NVDA", shares: 10, costPerShare: 100, date: "2026-06-01", agentId: "agent-1", lotId: "a1" }),
    openLot({ ticker: "NVDA", shares: 8, costPerShare: 120, date: "2026-06-05", agentId: "agent-2", lotId: "a2" }),
  ];
}

// --- default (flag off) must match the historical account-wide behavior --------

// Matching a fill to its proposal needs the broker refId + a signed proposal.
function sellFill(refId) {
  return { orderId: "s1", refId, ticker: "NVDA", side: "SELL", shares: 10, price: 130, amount: 1300, date: "2026-07-11" };
}
function sellProposal(id, agentId) {
  return { id, agentId, ticker: "NVDA", side: "SELL", status: "ApprovedForBrokerReview", amountDollars: 1300, maxPrice: null, decisionHmac: "sig" };
}

test("planFillProcessing default: attributed SELL still consumes account-wide (no regression)", () => {
  const lots = mixedNvda();
  // agent-2 SELLs 10 NVDA; agent-2 only owns 8, but the default account-wide path
  // consumes across strategies (oldest first) and realizes a gain — unchanged.
  const plan = planFillProcessing({ fills: [sellFill("p2")], openProposals: [sellProposal("p2", "agent-2")], lots });
  assert.equal(plan.warnings.length, 0);
  assert.equal(typeof plan.tradeRows[0].realizedGain, "number");
});

test("applyFillToLots default: SELL consumes account-wide (no regression)", () => {
  const lots = mixedNvda();
  const trade = { ticker: "NVDA", side: "SELL", shares: 10, price: 130, date: "2026-07-11", agentId: "agent-2" };
  const { trade: out } = applyFillToLots(trade, lots);
  assert.equal(typeof out.realizedGain, "number");
});

// --- flag on enforces ownership ------------------------------------------------

test("planFillProcessing enforceOwnership: attributed SELL beyond own lots warns, does not cross strategies", () => {
  const lots = mixedNvda();
  const plan = planFillProcessing({ fills: [sellFill("p2")], openProposals: [sellProposal("p2", "agent-2")], lots, enforceOwnership: true });
  // agent-2 owns only 8 → ownership violation → warning, no realized gain, agent-1's lot untouched.
  assert.equal(plan.tradeRows[0].agentId, "agent-2"); // attribution succeeded
  assert.ok(plan.warnings.some((w) => w.includes("NVDA")));
  assert.equal(plan.tradeRows[0].realizedGain, null);
  assert.ok(!plan.lotUpdates.some((l) => l.lotId === "a1"));
});

test("planFillProcessing enforceOwnership: attributed SELL within own lots consumes only its own", () => {
  const lots = mixedNvda();
  const sell = { orderId: "s1", refId: "p1", ticker: "NVDA", side: "SELL", shares: 6, price: 130, amount: 780, date: "2026-07-11" };
  const proposal = { id: "p1", agentId: "agent-1", ticker: "NVDA", side: "SELL", status: "ApprovedForBrokerReview", amountDollars: 780, maxPrice: null, decisionHmac: "sig" };
  const plan = planFillProcessing({ fills: [sell], openProposals: [proposal], lots, enforceOwnership: true });
  assert.equal(plan.tradeRows[0].realizedGain, 6 * (130 - 100));
  assert.ok(plan.lotUpdates.some((l) => l.lotId === "a1"));
  assert.ok(!plan.lotUpdates.some((l) => l.lotId === "a2")); // agent-2 untouched
});

test("applyFillToLots enforceOwnership: agent-2 cannot over-sell into agent-1's lots", () => {
  const lots = mixedNvda();
  const trade = { ticker: "NVDA", side: "SELL", shares: 10, price: 130, date: "2026-07-11", agentId: "agent-2" };
  assert.throws(() => applyFillToLots(trade, lots, { enforceOwnership: true }), /ownership violation/);
});

test("enforceOwnership falls back to account-wide for an unattributed SELL", () => {
  const lots = [openLot({ ticker: "NVDA", shares: 5, costPerShare: 100, date: "2026-06-01", agentId: "unattributed", lotId: "u1" })];
  const trade = { ticker: "NVDA", side: "SELL", shares: 5, price: 130, date: "2026-07-11", agentId: "unattributed" };
  const { trade: out } = applyFillToLots(trade, lots, { enforceOwnership: true });
  assert.equal(out.realizedGain, 5 * (130 - 100)); // fallback consumed the unattributed lot
});
