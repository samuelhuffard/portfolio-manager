import { test } from "node:test";
import assert from "node:assert/strict";
import { compareParity } from "../lib/pg/parity.js";
import {
  applyPositionValuationComparison,
  failClosedOnReadErrors,
  holdingsRowToParityPosition,
  positionValuationState,
} from "../lib/pg/parity-runner.js";

test("Holdings parity mapping does not coerce exact decimal text through JavaScript Number", () => {
  const mapped = holdingsRowToParityPosition([
    "prec", "Precision Co", "9999999999.12345678", "12.3456", "unused", "123.45", "123456789.12",
  ]);
  assert.deepEqual(mapped, {
    ticker: "PREC",
    name: "Precision Co",
    shares: "9999999999.12345678",
    avgCost: "12.3456",
    marketValue: "123.45",
    costBasis: "123456789.12",
  });
});

test("an unreadable inventory is not valid parity evidence even when both sides share the same error text", () => {
  const authoritative = { proposals: { error: "offline" } };
  const postgres = { proposals: { error: "offline" } };
  const raw = compareParity(authoritative, postgres);
  assert.equal(raw.ok, true, "raw metric comparison alone cannot distinguish matching errors");

  const checked = failClosedOnReadErrors(raw, authoritative, postgres);
  assert.equal(checked.ok, false);
  assert.equal(checked.matched.length, 0);
  assert.equal(checked.divergences.length, 2);
  assert.match(checked.divergences[0].reason, /read failed/);
});

test("non-comparable valuation does not turn matching transactions into an accounting divergence", () => {
  const comparison = compareParity(
    { positions: { count: 1, digest: "same" } },
    { positions: { count: 1, digest: "same" } },
  );
  applyPositionValuationComparison(comparison, {
    status: "NON_COMPARABLE",
    comparable: false,
    reason: "versioned quote provenance unavailable",
  });
  assert.equal(comparison.ok, true);
  assert.equal(comparison.divergences.length, 0);
  assert.equal(comparison.valuation.status, "NON_COMPARABLE");
});

test("same-snapshot valuation mismatch is a separately named projection divergence", () => {
  const comparison = compareParity(
    { positions: { count: 1, digest: "same" } },
    { positions: { count: 1, digest: "same" } },
  );
  applyPositionValuationComparison(comparison, {
    status: "VALUE_MISMATCH",
    comparable: true,
    reason: "same quote snapshot but valuation inventory differs",
    authoritative: { inventory: { count: 1, digest: "a" } },
    postgres: { inventory: { count: 1, digest: "b" } },
  });
  assert.equal(comparison.ok, false);
  assert.equal(comparison.divergences[0].key, "positions_valuation");
});

test("an unreadable valuation inventory fails closed", () => {
  const comparison = compareParity(
    { positions: { count: 1, digest: "same" } },
    { positions: { count: 1, digest: "same" } },
  );
  applyPositionValuationComparison(comparison, {
    status: "UNREADABLE",
    comparable: false,
    reason: "valuation inventory unavailable or invalid",
  });
  assert.equal(comparison.ok, false);
  assert.equal(comparison.divergences[0].key, "positions_valuation");
});

test("position valuation state carries one shared quote provenance and rejects mixed snapshots", () => {
  const rows = [
    { ticker: "AMD", marketValue: "160.25", quoteSnapshotVersion: "snap-1", quoteSource: "yahoo", quoteTimestamp: new Date("2026-07-14T20:00:00Z") },
    { ticker: "NVDA", marketValue: "205.50", quoteSnapshotVersion: "snap-1", quoteSource: "yahoo", quoteTimestamp: new Date("2026-07-14T20:00:00Z") },
  ];
  const state = positionValuationState(rows);
  assert.equal(state.quoteSnapshotVersion, "snap-1");
  assert.equal(state.quoteTimestamp, "2026-07-14T20:00:00.000Z");
  const mixed = positionValuationState([{ ...rows[0] }, { ...rows[1], quoteSnapshotVersion: "snap-2" }]);
  assert.match(mixed.error, /mixed quote provenance/);
});
