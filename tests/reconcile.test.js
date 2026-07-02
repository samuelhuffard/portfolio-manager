import { test } from "node:test";
import assert from "node:assert/strict";
import { reconcileOrders, formatReconcileReport } from "../lib/reconcile.js";

const ledger = [
  { orderId: "aaa-1", ticker: "NVDA", side: "BUY" },
  { orderId: "bbb-2", ticker: "CRWD", side: "SELL" },
];

test("filled broker orders present in the ledger reconcile clean", () => {
  const result = reconcileOrders({
    brokerOrders: [
      { orderId: "aaa-1", symbol: "NVDA", side: "buy", state: "filled", shares: 0.5, price: 190 },
      { orderId: "zzz-9", symbol: "AMD", side: "buy", state: "cancelled" }, // never hits the ledger
    ],
    ledger,
  });
  assert.equal(result.checked, 1);
  assert.equal(result.matched, 1);
  assert.equal(result.missingFromLedger.length, 0);
});

test("a filled broker order missing from the ledger is flagged", () => {
  const result = reconcileOrders({
    brokerOrders: [{ id: "ccc-3", symbol: "amd", side: "buy", state: "FILLED", shares: 1, price: 150, filledAt: "2026-07-02T15:00:00Z" }],
    ledger,
  });
  assert.equal(result.missingFromLedger.length, 1);
  assert.equal(result.missingFromLedger[0].ticker, "AMD");
  assert.equal(result.missingFromLedger[0].orderId, "ccc-3");
  assert.match(formatReconcileReport(result), /MISSING from ledger: BUY 1 AMD/);
});

test("partially filled orders are checked; working orders are not", () => {
  const result = reconcileOrders({
    brokerOrders: [
      { orderId: "ddd-4", symbol: "NET", side: "sell", state: "partially_filled" },
      { orderId: "eee-5", symbol: "NET", side: "sell", state: "queued" },
    ],
    ledger,
  });
  assert.equal(result.checked, 1);
  assert.equal(result.missingFromLedger.length, 1);
});

test("filled orders without an orderId are surfaced as malformed, not silently dropped", () => {
  const result = reconcileOrders({ brokerOrders: [{ symbol: "NVDA", side: "buy", state: "filled" }], ledger });
  assert.equal(result.malformed.length, 1);
  assert.match(formatReconcileReport(result), /no parseable orderId/);
});

test("empty day reports cleanly", () => {
  assert.match(formatReconcileReport(reconcileOrders({ brokerOrders: [], ledger })), /nothing to check/);
});
