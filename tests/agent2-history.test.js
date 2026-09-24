import test from "node:test";
import assert from "node:assert/strict";
import { deriveAgent2RevenueHistory } from "../lib/agent2-history.js";

const series = (values) => {
  const ends = [
    "2024-03-31", "2024-06-30", "2024-09-30", "2024-12-31",
    "2025-03-31", "2025-06-30", "2025-09-30", "2025-12-31",
  ];
  return values.map((val, index) => ({ end: ends[index], val, filed: ends[index] }));
};

test("Agent 2 counts four contiguous positive EDGAR YoY revenue quarters", () => {
  const out = deriveAgent2RevenueHistory(series([100, 100, 100, 100, 110, 120, 130, 140]));
  assert.equal(out.quarterlyYoYGrowth.length, 4);
  assert.equal(out.positiveQuartersInLatestFour, 4);
  assert.equal(out.nonDecelerating, true);
});

test("Agent 2 reports deceleration from two sourced YoY observations without inventing materiality", () => {
  const out = deriveAgent2RevenueHistory(series([100, 100, 100, 100, 130, 125, 120, 115]));
  assert.equal(out.positiveQuartersInLatestFour, 4);
  assert.equal(out.nonDecelerating, false);
});

test("Agent 2 refuses a gapped, duplicate, malformed, or thin EDGAR series", () => {
  const gapped = series([100, 100, 100, 100, 110, 120, 130, 140]);
  gapped.splice(5, 1);
  assert.deepEqual(deriveAgent2RevenueHistory(gapped), {
    quarterlyYoYGrowth: [],
    positiveQuartersInLatestFour: null,
    nonDecelerating: null,
  });
  const duplicate = series([100, 100, 100, 100, 110, 120, 130, 140]);
  duplicate[7].end = duplicate[6].end;
  assert.equal(deriveAgent2RevenueHistory(duplicate).positiveQuartersInLatestFour, null);
  assert.equal(deriveAgent2RevenueHistory(series([100, 100, 100, 100, 110])).positiveQuartersInLatestFour, null);
});
