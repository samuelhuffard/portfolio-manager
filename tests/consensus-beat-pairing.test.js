import test from "node:test";
import assert from "node:assert/strict";
import { selectRevenueBeatPair, PERIOD_MATCH_TOLERANCE_DAYS } from "../lib/consensus-snapshot.js";

const snapshot = (retrievedAt, periodEndDate, revenueAvg) => ({ retrievedAt, periodEndDate, revenueAvg });
const quarter = (end, val, filed) => ({ end, val, filed });

// Q1 ends 2026-03-31 and is filed 2026-04-25.
const q1 = quarter("2026-03-31", 1_100_000_000, "2026-04-25");

test("pairs the actual with the LATEST consensus observed before the filing", () => {
  const out = selectRevenueBeatPair({
    history: [
      snapshot("2026-02-01T00:00:00.000Z", "2026-03-31T00:00:00.000Z", 900_000_000),
      snapshot("2026-04-20T00:00:00.000Z", "2026-03-31T00:00:00.000Z", 1_000_000_000),
    ],
    revenueQuarters: [q1],
  });
  assert.equal(out.actualRevenue, 1_100_000_000);
  assert.equal(out.snapshot.revenueAvg, 1_000_000_000);
  assert.equal(out.periodEnd, "2026-03-31");
});

test("never pairs against a snapshot observed after the filing — that is leakage", () => {
  const out = selectRevenueBeatPair({
    // The only snapshot for this period was taken after the print, so it already
    // reflects the reported number and would manufacture a ~0% beat.
    history: [snapshot("2026-05-01T00:00:00.000Z", "2026-03-31T00:00:00.000Z", 1_099_000_000)],
    revenueQuarters: [q1],
  });
  assert.equal(out.snapshot, null);
  assert.equal(out.actualRevenue, null);
});

test("matches a vendor period end that differs from EDGAR's by fiscal-calendar skew", () => {
  const within = new Date(Date.parse("2026-03-31") + (PERIOD_MATCH_TOLERANCE_DAYS - 2) * 86_400_000).toISOString();
  const out = selectRevenueBeatPair({
    history: [snapshot("2026-04-20T00:00:00.000Z", within, 1_000_000_000)],
    revenueQuarters: [q1],
  });
  assert.equal(out.actualRevenue, 1_100_000_000);
});

test("does not reach into the adjacent quarter", () => {
  // A snapshot targeting the NEXT quarter must never be scored against this one.
  const out = selectRevenueBeatPair({
    history: [snapshot("2026-04-20T00:00:00.000Z", "2026-06-30T00:00:00.000Z", 1_000_000_000)],
    revenueQuarters: [q1],
  });
  assert.equal(out.snapshot, null);
});

test("falls back to an older quarter when the most recent one has no pre-report snapshot", () => {
  const q4 = quarter("2025-12-31", 950_000_000, "2026-01-28");
  const out = selectRevenueBeatPair({
    history: [snapshot("2026-01-10T00:00:00.000Z", "2025-12-31T00:00:00.000Z", 900_000_000)],
    revenueQuarters: [q4, q1],
  });
  assert.equal(out.periodEnd, "2025-12-31");
  assert.equal(out.actualRevenue, 950_000_000);
});

test("ignores quarters filed after the observation instant", () => {
  const out = selectRevenueBeatPair({
    history: [snapshot("2026-04-20T00:00:00.000Z", "2026-03-31T00:00:00.000Z", 1_000_000_000)],
    revenueQuarters: [q1],
    // Scoring on 2026-04-22 cannot know a result filed on 2026-04-25.
    asOf: "2026-04-22T00:00:00.000Z",
  });
  assert.equal(out.actualRevenue, null);
});

test("returns nulls rather than guessing when there is no history at all", () => {
  const out = selectRevenueBeatPair({ history: [], revenueQuarters: [q1] });
  assert.deepEqual(out, { snapshot: null, actualRevenue: null, periodEnd: null, filedAt: null });
});

test("skips a snapshot carrying no revenue consensus", () => {
  const out = selectRevenueBeatPair({
    history: [snapshot("2026-04-20T00:00:00.000Z", "2026-03-31T00:00:00.000Z", null)],
    revenueQuarters: [q1],
  });
  assert.equal(out.snapshot, null);
});
