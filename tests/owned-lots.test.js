import { test } from "node:test";
import assert from "node:assert/strict";
import { openLot, consumeLotsFIFO } from "../lib/tax-lots.js";
import { ownedOpenShares, assertAgentOwnsShares, consumeOwnedLotsFIFO } from "../lib/owned-lots.js";
import { StrategyLotSchema, LotConsumptionSchema, LOT_UNATTRIBUTED } from "../contracts/lot.js";

// agent-1 owns 10 NVDA @ $100 (older) + 5 NVDA @ $110 (newer); agent-2 owns 8 NVDA @ $120.
function mixedNvdaBook() {
  return [
    openLot({ ticker: "NVDA", shares: 10, costPerShare: 100, date: "2026-06-01", agentId: "agent-1", lotId: "a1-old" }),
    openLot({ ticker: "NVDA", shares: 5, costPerShare: 110, date: "2026-06-10", agentId: "agent-1", lotId: "a1-new" }),
    openLot({ ticker: "NVDA", shares: 8, costPerShare: 120, date: "2026-06-05", agentId: "agent-2", lotId: "a2" }),
  ];
}

test("StrategyLotSchema parses a real openLot output and rejects a bad status", () => {
  const lot = openLot({ ticker: "AMD", shares: 3, costPerShare: 90, date: "2026-07-01", agentId: "agent-3" });
  assert.doesNotThrow(() => StrategyLotSchema.parse(lot));
  assert.throws(() => StrategyLotSchema.parse({ ...lot, status: "PARTIAL" }));
});

test("ownedOpenShares counts only the named agent's open shares", () => {
  const book = mixedNvdaBook();
  assert.equal(ownedOpenShares(book, "NVDA", "agent-1"), 15);
  assert.equal(ownedOpenShares(book, "NVDA", "agent-2"), 8);
  assert.equal(ownedOpenShares(book, "NVDA", "agent-3"), 0);
});

test("assertAgentOwnsShares passes within the agent's own holding and fails past it", () => {
  const book = mixedNvdaBook();
  assert.doesNotThrow(() => assertAgentOwnsShares(book, "NVDA", "agent-1", 15));
  assert.throws(() => assertAgentOwnsShares(book, "NVDA", "agent-1", 16), /ownership violation/);
});

test("assertAgentOwnsShares refuses an unattributed or missing owner (fail closed)", () => {
  const book = mixedNvdaBook();
  assert.throws(() => assertAgentOwnsShares(book, "NVDA", LOT_UNATTRIBUTED, 1), /must name its owning agent/);
  assert.throws(() => assertAgentOwnsShares(book, "NVDA", "", 1), /must name its owning agent/);
});

// The invariant #3 teeth: agent-2 owns only 8 NVDA. Selling 10 as agent-2 must be
// refused — even though the account holds 23 NVDA in total — because the extra 2
// would have to come from agent-1's lots.
test("consumeOwnedLotsFIFO refuses to reach into another strategy's lots", () => {
  const book = mixedNvdaBook();
  assert.throws(
    () => consumeOwnedLotsFIFO(book, { ticker: "NVDA", agentId: "agent-2", sharesToSell: 10, sellPricePerShare: 130 }),
    /ownership violation/
  );

  // Contrast: the account-wide primitive would have silently let it through,
  // consuming agent-1's oldest lots and corrupting attribution. This asserts the
  // gap the ownership wrapper closes.
  assert.doesNotThrow(() => consumeLotsFIFO(book, "NVDA", 10, 130));
});

test("consumeOwnedLotsFIFO consumes FIFO within the agent and leaves others untouched", () => {
  const book = mixedNvdaBook();
  const { lotsConsumed, realizedGain, updatedLots } = consumeOwnedLotsFIFO(book, {
    ticker: "NVDA",
    agentId: "agent-1",
    sharesToSell: 12,
    sellPricePerShare: 130,
  });

  // FIFO within agent-1: all 10 of the older $100 lot, then 2 of the $110 lot.
  assert.deepEqual(
    lotsConsumed.map((l) => [l.lotId, l.sharesConsumed]),
    [["a1-old", 10], ["a1-new", 2]]
  );
  // Realized gain: 10*(130-100) + 2*(130-110) = 300 + 40 = 340.
  assert.equal(realizedGain, 340);
  // Every consumption row is attributed to agent-1 and passes the contract.
  for (const c of lotsConsumed) {
    assert.equal(c.agentId, "agent-1");
    assert.doesNotThrow(() => LotConsumptionSchema.parse(c));
  }
  // agent-2's lot is never in the returned updates (it was filtered out entirely).
  assert.ok(!updatedLots.some((l) => l.lotId === "a2"));
});

// -----------------------------------------------------------------------------
// Fake-data pipeline harness: synthetic inputs driven through the contract shape
// end to end (validate author input -> stored proposal -> ownership-scoped SELL).
// This is the "test harness" use of fake data: it exercises the CODE's shape and
// fail-closed behavior deterministically. It is NOT a substitute for the live
// observation window, which exists to catch operational failures (spend caps,
// broker session drops) that no synthetic run can produce.
// -----------------------------------------------------------------------------
test("harness: a synthetic SELL flows validate -> schema -> ownership and stays fail-closed", async () => {
  const { validateProposalInput, ProposalSchema } = await import("../contracts/proposal.js");

  const validated = validateProposalInput({
    agentId: "agent-1",
    ticker: "NVDA",
    side: "SELL",
    amountDollars: 1300,
    rationale: "Trimming NVDA into strength per the exit ladder.",
  });
  assert.equal(validated.ok, true);

  // Assemble the stored proposal the system would persist, and prove it satisfies
  // the canonical schema (nothing malformed reaches the money path).
  const stored = {
    id: "harness-1",
    ...validated.value,
    status: "Pending",
    createdAt: "2026-07-11T00:00:00.000Z",
    updatedAt: "2026-07-11T00:00:00.000Z",
    expiresAt: "2026-07-13T00:00:00.000Z",
    createdByUserId: "harness",
    createdByEmail: null,
    decidedAt: null,
    decidedByUserId: null,
    decisionNote: null,
    fulfilledAt: null,
    fulfilledOrderId: null,
    fulfilledShares: null,
    decisionHmac: null,
  };
  assert.doesNotThrow(() => ProposalSchema.parse(stored));

  // agent-1 owns 15 NVDA — a 10-share SELL is allowed; a 20-share SELL is refused.
  const book = mixedNvdaBook();
  assert.doesNotThrow(() =>
    consumeOwnedLotsFIFO(book, { ticker: stored.ticker, agentId: stored.agentId, sharesToSell: 10, sellPricePerShare: 130 })
  );
  assert.throws(() =>
    consumeOwnedLotsFIFO(book, { ticker: stored.ticker, agentId: stored.agentId, sharesToSell: 20, sellPricePerShare: 130 })
  );
});
