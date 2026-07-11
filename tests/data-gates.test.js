import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateDataGates } from "../lib/data-gates.js";

const NOW = new Date("2026-06-26T20:00:00Z");
const LIMITS = { microCapMinAvgDollarVolume: 3_000_000 };

const complete = {
  price: 42,
  trailingEps: 1.2,
  forwardEps: 1.6,
  grossMargins: 0.62,
  profitMargins: 0.18,
  rsi: 55,
  lastBarDate: new Date("2026-06-26T00:00:00Z"),
  marketCap: 5_000_000_000,
  avgDollarVolume: 50_000_000,
};

test("passes a complete, fresh mid-cap candidate", () => {
  const r = evaluateDataGates(complete, LIMITS, { now: NOW });
  assert.equal(r.ok, true);
  assert.equal(r.stale, false);
  assert.deepEqual(r.missing, []);
  assert.equal(r.availableDataScore, 100);
});

test("flags stale price data", () => {
  const r = evaluateDataGates(
    { ...complete, lastBarDate: new Date("2026-06-15T00:00:00Z") },
    LIMITS,
    { now: NOW }
  );
  assert.equal(r.ok, false);
  assert.equal(r.stale, true);
});

test("missing required fields => not ok and stale", () => {
  const r = evaluateDataGates({ ...complete, forwardEps: null, rsi: null }, LIMITS, { now: NOW });
  assert.equal(r.ok, false);
  assert.equal(r.stale, true);
  assert.ok(r.missing.includes("forwardEps"));
  assert.ok(r.missing.includes("rsi"));
  assert.equal(r.availableDataScore, 71);
});

test("micro-cap below the ADDV floor fails", () => {
  const r = evaluateDataGates(
    { ...complete, marketCap: 150_000_000, avgDollarVolume: 1_000_000 },
    LIMITS,
    { now: NOW }
  );
  assert.equal(r.ok, false);
  assert.ok(r.reasons.some((x) => x.includes("ADDV")));
});

test("micro-cap with missing ADDV is a NO_TRADE", () => {
  const r = evaluateDataGates(
    { ...complete, marketCap: 150_000_000, avgDollarVolume: null },
    LIMITS,
    { now: NOW }
  );
  assert.equal(r.ok, false);
  assert.ok(r.missing.includes("avgDollarVolume"));
  assert.equal(r.availableDataScore, 88);
});

test("micro-cap above the floor passes", () => {
  const r = evaluateDataGates(
    { ...complete, marketCap: 250_000_000, avgDollarVolume: 5_000_000 },
    LIMITS,
    { now: NOW }
  );
  assert.equal(r.ok, true);
});
