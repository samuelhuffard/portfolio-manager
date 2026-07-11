import { test } from "node:test";
import assert from "node:assert/strict";
import { planFillProcessing } from "../lib/fill-processing.js";
import { openLot } from "../lib/tax-lots.js";
import { consumeOwnedLotsFIFO } from "../lib/owned-lots.js";
import { assertApprovalStillValid } from "../lib/approval-validity.js";

// Crash-injection harness (pulls the Phase 2 exit-gate "crash injection at every
// execution/accounting boundary" forward as tests). Each scenario composes the
// real pure money-path functions and injects a crash/delay at a specific
// boundary, asserting the composed safety property: no double-book, no ghost
// fill, fail-closed. This exercises CODE behavior deterministically — it is not
// a substitute for the live observation window.

// A tiny model of the persistence boundary: the Trade Ledger is the dedup key.
// A "crash" = the process dies before we advance the ledger, so the next run
// sees the same fills with the same (un-advanced) ledger.
function ledgerOrderIds(tradeRows) {
  return tradeRows.filter((r) => r.orderId).map((r) => r.orderId);
}

test("crash between fill and ledger-write: N retries before persist never accumulate rows", () => {
  const fill = { orderId: "o1", ticker: "NVDA", side: "BUY", shares: 2, price: 100, amount: 200, date: "2026-07-11" };

  // Simulate the process crashing twice before the ledger write lands. Each
  // recovery run sees the same fill and an un-advanced ledger, so it re-plans the
  // SAME single row — it does not accumulate, because dedup is keyed on the
  // ledger, not on how many times we retried.
  let persistedOrderIds = [];
  let lastPlan;
  for (let attempt = 0; attempt < 3; attempt++) {
    lastPlan = planFillProcessing({ fills: [fill], existingOrderIds: persistedOrderIds, lots: [] });
    assert.equal(lastPlan.tradeRows.length, 1, `attempt ${attempt} must plan exactly one row`);
    // crash: persist did NOT happen on the first two attempts.
  }
  // The write finally lands: advance the ledger.
  persistedOrderIds = ledgerOrderIds(lastPlan.tradeRows);

  // Any further recovery run is now a clean no-op — the fill is in the ledger.
  const afterPersist = planFillProcessing({ fills: [fill], existingOrderIds: persistedOrderIds, lots: [] });
  assert.equal(afterPersist.tradeRows.length, 0, "replay after persist must be a no-op (no double-book)");
  assert.equal(afterPersist.skipped.length, 1);
});

test("duplicate fills within one batch (broker returned the order twice) book once", () => {
  const fill = { orderId: "o9", ticker: "AMD", side: "BUY", shares: 1, price: 50, amount: 50, date: "2026-07-11" };
  const plan = planFillProcessing({ fills: [fill, { ...fill }], existingOrderIds: [], lots: [] });
  assert.equal(plan.tradeRows.length, 1, "same orderId twice in a batch → one row");
});

test("partial fill then remainder (distinct order ids) both record without double-count", () => {
  const first = { orderId: "p1", ticker: "MSFT", side: "BUY", shares: 3, price: 400, amount: 1200, date: "2026-07-11" };
  const remainder = { orderId: "p2", ticker: "MSFT", side: "BUY", shares: 2, price: 401, amount: 802, date: "2026-07-11" };
  const plan1 = planFillProcessing({ fills: [first], existingOrderIds: [], lots: [] });
  const ledger = ledgerOrderIds(plan1.tradeRows);
  const plan2 = planFillProcessing({ fills: [first, remainder], existingOrderIds: ledger, lots: [] });
  // The already-booked first leg is skipped; only the remainder books.
  assert.equal(plan2.tradeRows.length, 1);
  assert.equal(plan2.tradeRows[0].orderId, "p2");
});

test("execution refused when the approval went stale during the crash window (fail closed)", () => {
  // A BUY approved against $500 cash; while the executor was down, another fill
  // spent it. On resume, the state-version gate must refuse before placing.
  const proposal = { side: "BUY", amountDollars: 500, maxPrice: null, ticker: "NVDA" };
  assert.throws(() => assertApprovalStillValid(proposal, { cashAvailable: 120 }), /no longer valid/);
  // Fresh state still passes.
  assert.doesNotThrow(() => assertApprovalStillValid(proposal, { cashAvailable: 500 }));
});

test("SELL ownership survives crash-replay: reduced lot state prevents over-selling", () => {
  // agent-1 owns 10 NVDA. A SELL of 6 fills; the process crashes after the lot
  // was reduced to 4 open. On replay against the reduced book, a second 6-share
  // SELL by the same agent must fail closed (only 4 owned now).
  const bookBefore = [openLot({ ticker: "NVDA", shares: 10, costPerShare: 100, date: "2026-06-01", agentId: "agent-1", lotId: "L1" })];
  const { updatedLots } = consumeOwnedLotsFIFO(bookBefore, { ticker: "NVDA", agentId: "agent-1", sharesToSell: 6, sellPricePerShare: 130 });
  const bookAfter = updatedLots; // persisted reduced state (4 open)
  assert.equal(bookAfter[0].sharesOpen, 4);
  assert.throws(
    () => consumeOwnedLotsFIFO(bookAfter, { ticker: "NVDA", agentId: "agent-1", sharesToSell: 6, sellPricePerShare: 130 }),
    /ownership violation/
  );
});

test("a SELL with no matching lots warns instead of throwing (batch survives the boundary)", () => {
  // planFillProcessing must not abort a whole batch on one un-consumable SELL —
  // it records the trade row with a warning so the rest of the batch still books.
  const orphanSell = { orderId: "s1", ticker: "TSLA", side: "SELL", shares: 5, price: 200, amount: 1000, date: "2026-07-11" };
  const goodBuy = { orderId: "b1", ticker: "AAPL", side: "BUY", shares: 1, price: 150, amount: 150, date: "2026-07-11" };
  const plan = planFillProcessing({ fills: [orphanSell, goodBuy], existingOrderIds: [], lots: [] });
  assert.equal(plan.tradeRows.length, 2, "both fills book; the SELL does not abort the batch");
  assert.ok(plan.warnings.some((w) => w.includes("TSLA")));
});
