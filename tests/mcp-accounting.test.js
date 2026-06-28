import { test } from "node:test";
import assert from "node:assert/strict";
import { applyFillToLots, validateMcpFillInput } from "../lib/mcp-accounting.js";
import { openLot } from "../lib/tax-lots.js";

function proposal(overrides = {}) {
  return {
    id: "proposal-1",
    agentId: "agent-1",
    ticker: "CRWD",
    side: "BUY",
    amountDollars: 1000,
    maxPrice: 250,
    status: "ApprovedForBrokerReview",
    fulfilledAt: null,
    ...overrides,
  };
}

test("validates an approved MCP fill against its proposal", () => {
  const trade = validateMcpFillInput({
    proposal: proposal(),
    existingTrades: [],
    orderId: "order-1",
    ticker: "crwd",
    side: "buy",
    shares: "4",
    price: "250",
    agentId: "agent-1",
  });

  assert.equal(trade.ticker, "CRWD");
  assert.equal(trade.side, "BUY");
  assert.equal(trade.amount, 1000);
  assert.equal(trade.agentId, "agent-1");
});

test("rejects unapproved, fulfilled, duplicate, or mismatched MCP fills", () => {
  const base = {
    existingTrades: [],
    orderId: "order-1",
    ticker: "CRWD",
    side: "BUY",
    shares: 4,
    price: 250,
    agentId: "agent-1",
  };

  assert.throws(() => validateMcpFillInput({ ...base, proposal: proposal({ status: "Pending" }) }), /not approved/);
  assert.throws(() => validateMcpFillInput({ ...base, proposal: proposal({ fulfilledAt: "2026-06-28T00:00:00Z" }) }), /already fulfilled/);
  assert.throws(() => validateMcpFillInput({ ...base, proposal: proposal(), existingTrades: [{ orderId: "order-1" }] }), /already recorded/);
  assert.throws(() => validateMcpFillInput({ ...base, proposal: proposal(), ticker: "NET" }), /Ticker mismatch/);
  assert.throws(() => validateMcpFillInput({ ...base, proposal: proposal(), side: "SELL" }), /Side mismatch/);
  assert.throws(() => validateMcpFillInput({ ...base, proposal: proposal(), agentId: "agent-2" }), /Agent mismatch/);
});

test("rejects BUY fills above max price or outside amount tolerance", () => {
  const base = {
    proposal: proposal(),
    existingTrades: [],
    orderId: "order-1",
    ticker: "CRWD",
    side: "BUY",
    agentId: "agent-1",
  };

  assert.throws(() => validateMcpFillInput({ ...base, shares: 4, price: 251 }), /exceeds proposal maxPrice/);
  assert.throws(() => validateMcpFillInput({ ...base, shares: 2, price: 250 }), /differs from proposal/);
});

test("BUY MCP fills open a new attributed lot", () => {
  const trade = validateMcpFillInput({
    proposal: proposal(),
    existingTrades: [],
    orderId: "order-1",
    ticker: "CRWD",
    side: "BUY",
    shares: 4,
    price: 250,
    agentId: "agent-1",
  });
  const result = applyFillToLots(trade, []);

  assert.equal(result.newLots.length, 1);
  assert.equal(result.updatedLots.length, 0);
  assert.equal(result.newLots[0].ticker, "CRWD");
  assert.equal(result.newLots[0].sharesOpen, 4);
  assert.equal(result.newLots[0].agentId, "agent-1");
});

test("SELL MCP fills consume FIFO lots and compute realized gain", () => {
  const sellProposal = proposal({ side: "SELL", amountDollars: 750, maxPrice: null });
  const trade = validateMcpFillInput({
    proposal: sellProposal,
    existingTrades: [],
    orderId: "order-sell",
    ticker: "CRWD",
    side: "SELL",
    shares: 3,
    price: 250,
    agentId: "agent-1",
  });
  const lots = [
    openLot({ ticker: "CRWD", shares: 2, costPerShare: 200, date: "2026-01-01", agentId: "agent-1", lotId: "lot-1" }),
    openLot({ ticker: "CRWD", shares: 3, costPerShare: 225, date: "2026-02-01", agentId: "agent-1", lotId: "lot-2" }),
  ];

  const result = applyFillToLots(trade, lots);

  assert.equal(result.newLots.length, 0);
  assert.equal(result.updatedLots.length, 2);
  assert.equal(result.trade.realizedGain, 125);
  assert.equal(result.updatedLots.find((lot) => lot.lotId === "lot-1").status, "CLOSED");
  assert.equal(result.updatedLots.find((lot) => lot.lotId === "lot-2").sharesOpen, 2);
});
