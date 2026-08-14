import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeConsensusSnapshot,
  writeConsensusSnapshots,
  readConsensusHistories,
} from "../lib/pg/consensus-snapshots.js";

const row = (overrides = {}) => ({
  ticker: "AAPL",
  period: "0q",
  retrievedAt: "2026-08-01T12:00:00.000Z",
  periodEndDate: "2026-09-30T00:00:00.000Z",
  epsAvg: 1.42,
  revenueAvg: 94_000_000_000,
  source: "yahoo_earnings_trend",
  ...overrides,
});

function fakePool(rows = []) {
  const calls = [];
  return {
    calls,
    async query(text, params) {
      calls.push({ text, params });
      if (/^\s*INSERT/.test(text)) return { rowCount: 1, rows: [{ id: params[0] }] };
      return { rows };
    },
  };
}

test("identity is ticker + period + instant, so re-observing the same instant cannot deepen history", () => {
  const a = normalizeConsensusSnapshot(row());
  // Same instant, drifted estimate: still the same row. Hashing the values would
  // let this through and inflate the snapshot count that gates estimateRevisions.
  const b = normalizeConsensusSnapshot(row({ epsAvg: 1.43 }));
  assert.equal(a.id, b.id);
  assert.equal(a.contentHash, b.contentHash);
});

test("a later observation of the same period is a distinct row", () => {
  const a = normalizeConsensusSnapshot(row());
  const b = normalizeConsensusSnapshot(row({ retrievedAt: "2026-08-08T12:00:00.000Z" }));
  assert.notEqual(a.id, b.id);
});

test("rejects a snapshot with neither estimate — it would look like coverage while carrying nothing", () => {
  assert.throws(() => normalizeConsensusSnapshot(row({ epsAvg: null, revenueAvg: null })), /at least one/);
});

test("rejects a date-only retrieval stamp, which cannot establish point-in-time provenance", () => {
  assert.throws(() => normalizeConsensusSnapshot(row({ retrievedAt: "2026-08-01" })), /ISO timestamp/);
});

test("rejects a non-canonical ticker", () => {
  assert.throws(() => normalizeConsensusSnapshot(row({ ticker: "not a ticker" })), /canonical ticker/);
});

test("the whole batch is validated before any row is written", async () => {
  const pool = fakePool();
  await assert.rejects(
    writeConsensusSnapshots([row(), row({ ticker: "!!" })], { pool }),
    /canonical ticker/,
  );
  assert.equal(pool.calls.length, 0, "no INSERT may run when a later row is malformed");
});

test("history reads are bounded and never reach past the observation instant", async () => {
  const pool = fakePool([
    { ticker: "AAPL", period: "0q", retrieved_at: new Date("2026-07-01T00:00:00.000Z"), payload: { epsAvg: 1.4 } },
    { ticker: "AAPL", period: "0q", retrieved_at: new Date("2026-08-01T00:00:00.000Z"), payload: { epsAvg: 1.45 } },
  ]);
  const histories = await readConsensusHistories(
    { tickers: ["aapl"], asOf: "2026-08-14T00:00:00.000Z" },
    { pool },
  );
  const [{ params }] = pool.calls;
  assert.deepEqual(params[0], ["AAPL"]);
  assert.equal(params[1], "2026-08-14T00:00:00.000Z", "upper bound is the decision instant");
  assert.ok(Date.parse(params[2]) < Date.parse(params[1]), "reads are bounded below");

  const history = histories.get("AAPL");
  assert.equal(history.length, 2);
  // retrievedAt comes from the indexed column, not the payload copy.
  assert.equal(history[0].retrievedAt, "2026-07-01T00:00:00.000Z");
  assert.equal(history[1].epsAvg, 1.45);
});

test("an empty ticker list issues no query at all", async () => {
  const pool = fakePool();
  const histories = await readConsensusHistories({ tickers: [], asOf: "2026-08-14T00:00:00.000Z" }, { pool });
  assert.equal(histories.size, 0);
  assert.equal(pool.calls.length, 0);
});
