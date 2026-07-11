import { test } from "node:test";
import assert from "node:assert/strict";
import { promptBreakdown, promptNumber } from "../lib/ai-overlay.js";

test("promptNumber never emits NaN or Infinity into prompts", () => {
  assert.equal(promptNumber(72.345), 72.34);
  assert.equal(promptNumber(NaN), "unknown");
  assert.equal(promptNumber(Infinity), "unknown");
  assert.equal(promptNumber(null), "unknown");
});

test("promptBreakdown serializes non-finite metric values as null", () => {
  const breakdown = promptBreakdown({
    revenueGrowth: 82.34,
    profitMargins: NaN,
    freeCashflow: Infinity,
    rsi: null,
  });
  assert.deepEqual(breakdown, {
    revenueGrowth: 82.3,
    profitMargins: null,
    freeCashflow: null,
    rsi: null,
  });
  assert.doesNotMatch(JSON.stringify(breakdown), /NaN|Infinity/);
});
