import { test } from "node:test";
import assert from "node:assert/strict";
import { compareParity, comparePositionValuation, renderParityReport } from "../lib/pg/parity.js";

test("compareParity reports MATCH when counts and money sums agree", () => {
  const sheets = { proposals: { count: 5 }, capital_entries: { count: 3, sum: 1500.0 } };
  const postgres = { proposals: { count: 5 }, capital_entries: { count: 3, sum: 1500.004 } }; // within a cent
  const r = compareParity(sheets, postgres);
  assert.equal(r.ok, true);
  assert.deepEqual(r.matched.sort(), ["capital_entries", "proposals"]);
});

test("compareParity flags a count mismatch", () => {
  const r = compareParity({ proposals: { count: 5 } }, { proposals: { count: 4 } });
  assert.equal(r.ok, false);
  assert.match(r.divergences[0].reason, /count 5 vs 4/);
});

test("compareParity flags a money-sum mismatch beyond a cent", () => {
  const r = compareParity({ capital_entries: { count: 2, sum: 1000 } }, { capital_entries: { count: 2, sum: 1000.5 } });
  assert.equal(r.ok, false);
  assert.match(r.divergences[0].reason, /sum 1000 vs 1000.5/);
});

test("compareParity flags a key present on only one side (e.g. shadow not yet populated)", () => {
  const r = compareParity({ lots: { count: 10 } }, {});
  assert.equal(r.ok, false);
  assert.match(r.divergences[0].reason, /missing on postgres side/);
});

test("renderParityReport is a readable per-key summary", () => {
  const r = compareParity({ proposals: { count: 1 } }, { proposals: { count: 2 } });
  const text = renderParityReport(r);
  assert.match(text, /DIVERGENCE/);
  assert.match(text, /✗ proposals/);
});

test("compareParity detects equal-count lifecycle inventory drift", () => {
  const r = compareParity(
    { proposals: { count: 2, digest: "authoritative" } },
    { proposals: { count: 2, digest: "stale-shadow" } }
  );
  assert.equal(r.ok, false);
  assert.match(r.divergences[0].reason, /digest authoritative vs stale-shadow/);
});

test("valuation is non-comparable without versioned quote provenance", () => {
  const valuation = comparePositionValuation(
    { inventory: { count: 1, digest: "sheet-15.37" }, quoteSnapshotVersion: null, quoteSource: null, quoteTimestamp: null },
    { inventory: { count: 1, digest: "pg-15.39" }, quoteSnapshotVersion: null, quoteSource: null, quoteTimestamp: null },
  );
  assert.equal(valuation.status, "NON_COMPARABLE");
  assert.equal(valuation.comparable, false);
  assert.match(valuation.reason, /quote provenance unavailable/);
});

test("valuation classifies source/version and timestamp mismatches without comparing values", () => {
  const base = {
    inventory: { count: 1, digest: "value-a" },
    quoteSnapshotVersion: "quote-v1",
    quoteSource: "provider-a",
    quoteTimestamp: "2026-07-14T20:00:00.000Z",
  };
  assert.equal(comparePositionValuation(base, {
    ...base, inventory: { count: 1, digest: "value-b" }, quoteSource: "provider-b",
  }).status, "PROVENANCE_MISMATCH");
  assert.equal(comparePositionValuation(base, {
    ...base, inventory: { count: 1, digest: "value-b" }, quoteTimestamp: "2026-07-14T20:01:00.000Z",
  }).status, "FRESHNESS_MISMATCH");
});

test("valuation compares exactly only for the same identified quote snapshot", () => {
  const base = {
    inventory: { count: 1, digest: "same-value" },
    quoteSnapshotVersion: "quote-v1",
    quoteSource: "provider-a",
    quoteTimestamp: "2026-07-14T20:00:00.000Z",
  };
  assert.equal(comparePositionValuation(base, { ...base }).status, "EXACT_MATCH");
  assert.equal(comparePositionValuation(base, {
    ...base, inventory: { count: 1, digest: "different-value" },
  }).status, "VALUE_MISMATCH");
});

test("valuation never claims an exact match from missing inventories or invalid timestamps", () => {
  const provenance = {
    quoteSnapshotVersion: "quote-v1",
    quoteSource: "provider-a",
    quoteTimestamp: "not-a-timestamp",
  };
  assert.equal(comparePositionValuation(provenance, provenance).status, "UNREADABLE");
  const withInventory = { ...provenance, inventory: { count: 1, digest: "value" } };
  assert.equal(comparePositionValuation(withInventory, withInventory).status, "NON_COMPARABLE");
});

test("renderParityReport labels non-comparable valuation separately", () => {
  const result = compareParity({ positions: { count: 1, digest: "same" } }, { positions: { count: 1, digest: "same" } });
  result.valuation = comparePositionValuation(
    { inventory: { count: 1, digest: "a" } },
    { inventory: { count: 1, digest: "b" } },
  );
  const text = renderParityReport(result);
  assert.match(text, /MATCH/);
  assert.match(text, /positions valuation: NON_COMPARABLE/);
});
