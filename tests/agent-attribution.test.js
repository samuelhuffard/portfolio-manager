import { test } from "node:test";
import assert from "node:assert/strict";
import { matchTradeToApprovedProposal } from "../lib/agent-attribution.js";

function proposal(overrides = {}) {
  return {
    id: "proposal-1",
    agentId: "agent-1",
    ticker: "AAPL",
    side: "BUY",
    amountDollars: 1000,
    maxPrice: null,
    status: "ApprovedForBrokerReview",
    fulfilledAt: null,
    ...overrides,
  };
}

test("matches a fill to the open approved proposal with the closest dollar amount", () => {
  const trade = { ticker: "AAPL", side: "BUY", shares: 6.5, price: 153.5, amount: 998.0, date: "2026-06-20" };
  const proposals = [proposal({ id: "p1", amountDollars: 1000 }), proposal({ id: "p2", amountDollars: 5000 })];
  const { agentId, proposalId } = matchTradeToApprovedProposal(trade, proposals);
  assert.equal(agentId, "agent-1");
  assert.equal(proposalId, "p1");
});

test("falls back to unattributed when no proposal matches ticker/side", () => {
  const trade = { ticker: "TSLA", side: "BUY", shares: 1, price: 300, amount: 300, date: "2026-06-20" };
  const proposals = [proposal({ ticker: "AAPL" })];
  const { agentId, proposalId } = matchTradeToApprovedProposal(trade, proposals);
  assert.equal(agentId, "unattributed");
  assert.equal(proposalId, null);
});

test("rejects a proposal whose maxPrice the fill price exceeds beyond tolerance", () => {
  const trade = { ticker: "AAPL", side: "BUY", shares: 5, price: 200, amount: 1000, date: "2026-06-20" };
  const proposals = [proposal({ maxPrice: 150 })];
  const { agentId } = matchTradeToApprovedProposal(trade, proposals);
  assert.equal(agentId, "unattributed");
});

test("does not match proposals for the wrong side", () => {
  const trade = { ticker: "AAPL", side: "SELL", shares: 5, price: 150, amount: 750, date: "2026-06-20" };
  const proposals = [proposal({ side: "BUY" })];
  const { agentId } = matchTradeToApprovedProposal(trade, proposals);
  assert.equal(agentId, "unattributed");
});
