import { test } from "node:test";
import assert from "node:assert/strict";
import { openLot, consumeLotsFIFO, applyLotUpdates } from "../lib/tax-lots.js";

test("openLot creates an OPEN lot with sharesOpen === sharesOriginal", () => {
  const lot = openLot({ ticker: "AAPL", shares: 10, costPerShare: 150, date: "2026-01-01", agentId: "agent-1" });
  assert.equal(lot.status, "OPEN");
  assert.equal(lot.sharesOpen, 10);
  assert.equal(lot.sharesOriginal, 10);
  assert.equal(lot.agentId, "agent-1");
});

test("openLot preserves fractional-share precision needed by broker sells", () => {
  const lot = openLot({ ticker: "NVDA", shares: 0.075555, costPerShare: 198.53, date: "2026-06-30", agentId: "agent-1" });
  assert.equal(lot.sharesOriginal, 0.075555);
  assert.equal(lot.sharesOpen, 0.075555);
});

test("consumeLotsFIFO consumes the oldest lot first, partially", () => {
  const lots = [
    openLot({ ticker: "AAPL", shares: 10, costPerShare: 100, date: "2026-01-01", agentId: "agent-1", lotId: "lot-1" }),
    openLot({ ticker: "AAPL", shares: 10, costPerShare: 120, date: "2026-02-01", agentId: "agent-1", lotId: "lot-2" }),
  ];

  const { lotsConsumed, realizedGain, updatedLots } = consumeLotsFIFO(lots, "AAPL", 5, 150);

  assert.equal(lotsConsumed.length, 1);
  assert.equal(lotsConsumed[0].lotId, "lot-1");
  assert.equal(lotsConsumed[0].sharesConsumed, 5);
  assert.equal(realizedGain, 5 * (150 - 100));
  assert.equal(updatedLots[0].sharesOpen, 5);
  assert.equal(updatedLots[0].status, "OPEN");
});

test("consumeLotsFIFO spans multiple lots and closes the first one", () => {
  const lots = [
    openLot({ ticker: "AAPL", shares: 5, costPerShare: 100, date: "2026-01-01", agentId: "agent-1", lotId: "lot-1" }),
    openLot({ ticker: "AAPL", shares: 10, costPerShare: 120, date: "2026-02-01", agentId: "agent-1", lotId: "lot-2" }),
  ];

  const { lotsConsumed, realizedGain, updatedLots } = consumeLotsFIFO(lots, "AAPL", 8, 130);

  assert.equal(lotsConsumed.length, 2);
  assert.equal(lotsConsumed[0].sharesConsumed, 5);
  assert.equal(lotsConsumed[1].sharesConsumed, 3);
  const expectedGain = 5 * (130 - 100) + 3 * (130 - 120);
  assert.equal(realizedGain, expectedGain);

  const closedLot = updatedLots.find((l) => l.lotId === "lot-1");
  assert.equal(closedLot.status, "CLOSED");
  assert.equal(closedLot.sharesOpen, 0);
  const openLotAfter = updatedLots.find((l) => l.lotId === "lot-2");
  assert.equal(openLotAfter.sharesOpen, 7);
});

test("consumeLotsFIFO treats a legacy-dated lot as oldest regardless of other dates", () => {
  const lots = [
    openLot({ ticker: "MSFT", shares: 10, costPerShare: 200, date: "2026-01-01", agentId: "agent-1", lotId: "lot-new" }),
    openLot({ ticker: "MSFT", shares: 10, costPerShare: 50, date: "legacy", agentId: "unattributed", lotId: "lot-legacy" }),
  ];

  const { lotsConsumed } = consumeLotsFIFO(lots, "MSFT", 5, 300);
  assert.equal(lotsConsumed[0].lotId, "lot-legacy");
});

test("consumeLotsFIFO can produce a negative realized gain (a loss)", () => {
  const lots = [openLot({ ticker: "TSLA", shares: 10, costPerShare: 300, date: "2026-01-01", agentId: "agent-2", lotId: "lot-1" })];
  const { realizedGain } = consumeLotsFIFO(lots, "TSLA", 10, 250);
  assert.equal(realizedGain, -500);
});

test("consumeLotsFIFO throws if there isn't enough open quantity", () => {
  const lots = [openLot({ ticker: "AAPL", shares: 5, costPerShare: 100, date: "2026-01-01", agentId: "agent-1", lotId: "lot-1" })];
  assert.throws(() => consumeLotsFIFO(lots, "AAPL", 10, 150));
});

test("consumeLotsFIFO ignores lots for other tickers and already-closed lots", () => {
  const lots = [
    openLot({ ticker: "AAPL", shares: 5, costPerShare: 100, date: "2026-01-01", agentId: "agent-1", lotId: "lot-1" }),
    { ...openLot({ ticker: "AAPL", shares: 5, costPerShare: 90, date: "2025-01-01", agentId: "agent-1", lotId: "lot-0" }), status: "CLOSED", sharesOpen: 0 },
    openLot({ ticker: "MSFT", shares: 5, costPerShare: 200, date: "2026-01-01", agentId: "agent-1", lotId: "lot-2" }),
  ];
  const { lotsConsumed } = consumeLotsFIFO(lots, "AAPL", 5, 150);
  assert.equal(lotsConsumed.length, 1);
  assert.equal(lotsConsumed[0].lotId, "lot-1");
});

test("applyLotUpdates replaces only the matching lots, leaving the rest untouched", () => {
  const lots = [
    openLot({ ticker: "AAPL", shares: 5, costPerShare: 100, date: "2026-01-01", agentId: "agent-1", lotId: "lot-1" }),
    openLot({ ticker: "MSFT", shares: 5, costPerShare: 200, date: "2026-01-01", agentId: "agent-1", lotId: "lot-2" }),
  ];
  const updated = applyLotUpdates(lots, [{ ...lots[0], sharesOpen: 0, status: "CLOSED" }]);
  assert.equal(updated[0].status, "CLOSED");
  assert.equal(updated[1].status, "OPEN");
});
