import { test } from "node:test";
import assert from "node:assert/strict";
import { computeTreasuryYieldChangeBps } from "../lib/fred.js";

function observation(value, date) {
  return { value: String(value), date };
}

test("computes signed bps change between the latest and the Nth-back valid observation", () => {
  // Most-recent-first, as FRED's sort_order=desc returns them. 31 entries so
  // index 30 (30 valid readings back) exists.
  const observations = Array.from({ length: 31 }, (_, i) => observation((4.5 - i * 0.01).toFixed(2), `2026-06-${30 - i}`));
  const changeBps = computeTreasuryYieldChangeBps(observations, 30);
  // current (index 0) = 4.50, 30-back (index 30) = 4.50 - 30*0.01 = 4.20 -> +30bps
  assert.equal(changeBps, 30);
});

test("a large drop is a large negative bps change", () => {
  const observations = [observation("3.50", "2026-07-20"), ...Array.from({ length: 30 }, () => observation("4.50", "2026-06-01"))];
  const changeBps = computeTreasuryYieldChangeBps(observations, 30);
  assert.equal(changeBps, -100);
});

test("skips FRED's '.' missing-value marker without miscounting the lookback", () => {
  const observations = [
    observation("4.50", "2026-07-20"),
    observation(".", "2026-07-19"), // missing reading — must not count as a valid step back
    ...Array.from({ length: 30 }, () => observation("4.20", "2026-06-01")),
  ];
  const changeBps = computeTreasuryYieldChangeBps(observations, 30);
  assert.equal(changeBps, 30);
});

test("returns null rather than guessing when there aren't enough valid observations", () => {
  const tooFew = Array.from({ length: 10 }, () => observation("4.50", "2026-07-01"));
  assert.equal(computeTreasuryYieldChangeBps(tooFew, 30), null);
  assert.equal(computeTreasuryYieldChangeBps(null, 30), null);
  assert.equal(computeTreasuryYieldChangeBps([], 30), null);
});
