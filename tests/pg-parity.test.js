import { test } from "node:test";
import assert from "node:assert/strict";
import { compareParity, renderParityReport } from "../lib/pg/parity.js";

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
