import { test } from "node:test";
import assert from "node:assert/strict";
import { planFillProcessing } from "../lib/fill-processing.js";
import { openLot } from "../lib/tax-lots.js";

function fill(overrides = {}) {
  return {
    ticker: "GOOD",
    side: "BUY",
    shares: 2,
    price: 50,
    amount: 100,
    date: "2026-07-07",
    orderId: "order-1",
    ...overrides,
  };
}

function proposal(overrides = {}) {
  return {
    id: "prop-1",
    agentId: "agent-1",
    ticker: "GOOD",
    side: "BUY",
    amountDollars: 100,
    maxPrice: 55,
    status: "ApprovedForBrokerReview",
    fulfilledAt: null,
    ...overrides,
  };
}

test("skips fills whose orderId is already in the Trade Ledger", () => {
  const plan = planFillProcessing({
    fills: [fill({ orderId: "seen" }), fill({ orderId: "new-1" })],
    existingOrderIds: ["seen"],
  });
  assert.equal(plan.freshFills.length, 1);
  assert.equal(plan.skipped.length, 1);
  assert.equal(plan.skipped[0].orderId, "seen");
  assert.equal(plan.tradeRows.length, 1);
  assert.equal(plan.tradeRows[0].orderId, "new-1");
});

test("dedupes repeated orderIds within the same batch", () => {
  const plan = planFillProcessing({
    fills: [fill({ orderId: "dup" }), fill({ orderId: "dup" })],
  });
  assert.equal(plan.freshFills.length, 1);
  assert.equal(plan.skipped.length, 1);
});

test("fills without an orderId are never deduped away", () => {
  const plan = planFillProcessing({
    fills: [fill({ orderId: null }), fill({ orderId: null })],
  });
  assert.equal(plan.freshFills.length, 2);
});

test("BUY opens a lot attributed to the matched proposal's agent", () => {
  const plan = planFillProcessing({
    fills: [fill()],
    openProposals: [proposal()],
  });
  assert.equal(plan.newLots.length, 1);
  assert.equal(plan.newLots[0].agentId, "agent-1");
  assert.equal(plan.newLots[0].sharesOpen, 2);
  assert.equal(plan.tradeRows[0].proposalId, "prop-1");
  assert.equal(plan.tradeRows[0].agentId, "agent-1");
  assert.equal(plan.tradeRows[0].realizedGain, null);
});

test("a proposal fulfills at most one fill — the second same-ticker/side fill goes unattributed", () => {
  const plan = planFillProcessing({
    fills: [fill({ orderId: "o1" }), fill({ orderId: "o2" })],
    openProposals: [proposal()],
  });
  assert.equal(plan.tradeRows[0].proposalId, "prop-1");
  assert.equal(plan.tradeRows[1].proposalId, null);
  assert.equal(plan.tradeRows[1].agentId, "unattributed");
});

test("SELL consumes lots FIFO and realizes the gain", () => {
  const oldLot = openLot({ ticker: "GOOD", shares: 2, costPerShare: 40, date: "2026-06-01", agentId: "agent-1", lotId: "lot-old" });
  const newLot = openLot({ ticker: "GOOD", shares: 2, costPerShare: 60, date: "2026-07-01", agentId: "agent-1", lotId: "lot-new" });
  const plan = planFillProcessing({
    fills: [fill({ side: "SELL", shares: 2, price: 50, amount: 100, orderId: "sell-1" })],
    lots: [newLot, oldLot],
  });
  // FIFO: the June lot (cost 40) is consumed, not the July one → gain 2 × (50 − 40)
  assert.equal(plan.tradeRows[0].realizedGain, 20);
  assert.equal(plan.lotUpdates.length, 1);
  assert.equal(plan.lotUpdates[0].lotId, "lot-old");
  assert.equal(plan.lotUpdates[0].status, "CLOSED");
});

test("SELL exceeding open shares records the trade row with a warning, not a throw", () => {
  const plan = planFillProcessing({
    fills: [fill({ side: "SELL", shares: 5, price: 50, amount: 250, orderId: "sell-over" })],
    lots: [openLot({ ticker: "GOOD", shares: 1, costPerShare: 40, date: "2026-06-01", lotId: "lot-1" })],
  });
  assert.equal(plan.tradeRows.length, 1);
  assert.equal(plan.tradeRows[0].realizedGain, null);
  assert.equal(plan.warnings.length, 1);
  assert.match(plan.warnings[0], /FIFO consumption for SELL GOOD/);
  assert.equal(plan.lotUpdates.length, 0);
});

test("a SELL later in the batch can consume a lot opened by an earlier BUY in the same batch", () => {
  const plan = planFillProcessing({
    fills: [
      fill({ orderId: "buy-1", shares: 2, price: 50, amount: 100 }),
      fill({ side: "SELL", orderId: "sell-1", shares: 2, price: 55, amount: 110 }),
    ],
  });
  assert.equal(plan.warnings.length, 0);
  assert.equal(plan.tradeRows[1].realizedGain, 10); // 2 × (55 − 50)
});

test("two SELLs hitting the same lot produce one final lot update (last state wins)", () => {
  const lot = openLot({ ticker: "GOOD", shares: 4, costPerShare: 40, date: "2026-06-01", lotId: "lot-1" });
  const plan = planFillProcessing({
    fills: [
      fill({ side: "SELL", orderId: "s1", shares: 1, price: 50, amount: 50 }),
      fill({ side: "SELL", orderId: "s2", shares: 1, price: 50, amount: 50 }),
    ],
    lots: [lot],
  });
  assert.equal(plan.lotUpdates.length, 1);
  assert.equal(plan.lotUpdates[0].sharesOpen, 2); // 4 − 1 − 1
  assert.equal(plan.lotUpdates[0].status, "OPEN");
});

test("empty input produces an empty plan", () => {
  const plan = planFillProcessing({ fills: [] });
  assert.deepEqual(plan.tradeRows, []);
  assert.deepEqual(plan.newLots, []);
  assert.deepEqual(plan.lotUpdates, []);
  assert.deepEqual(plan.warnings, []);
});
