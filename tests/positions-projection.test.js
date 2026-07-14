import test from "node:test";
import assert from "node:assert/strict";
import { positionsProjectionFromHoldings } from "../lib/pg/positions-projection.js";

test("positions projection preserves only replaceable authoritative Holdings fields", () => {
  assert.deepEqual(positionsProjectionFromHoldings([{
    ticker: "NVDA", name: "NVIDIA", shares: 0.075555, avgCost: 198.53,
    costBasis: 15, marketValue: 15.49, cash: 100, approval: "must-not-copy",
  }]), [{ ticker: "NVDA", name: "NVIDIA", shares: 0.075555, avgCost: 198.53, costBasis: 15, marketValue: 15.49 }]);
});

test("positions projection rejects a non-array source instead of guessing", () => {
  assert.throws(() => positionsProjectionFromHoldings(null), /holdings must be an array/);
});
