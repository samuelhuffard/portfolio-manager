import test from "node:test";
import assert from "node:assert/strict";
import { reconcileOrders } from "../lib/reconcile.js";

test("Jetson reconciliation consumes robinhood-sync filled-order shape", () => {
  const result = reconcileOrders({
    brokerOrders: [{ orderId: "order-1", ticker: "AAPL", side: "BUY", state: "filled", shares: 1, price: 200, filledAt: "2026-07-11T20:40:00Z" }],
    ledger: [{ orderId: "order-1" }],
  });
  assert.deepEqual(result, { checked: 1, matched: 1, missingFromLedger: [], malformed: [] });
});
