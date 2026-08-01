import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractConsensusSnapshot,
  consensusSnapshotRow,
  consensusChangePct,
  positiveRevisionBreadth,
  revenueBeatPct,
  assembleConsensusEvidence,
  CURRENT_QUARTER,
} from "../lib/consensus-snapshot.js";

/**
 * Fixture shaped to the installed yahoo-finance2 v3 `EarningsTrendTrend` interface
 * (earningsEstimate / revenueEstimate / epsTrend / epsRevisions).
 */
function fundamentals({ trend, ...top } = {}) {
  return {
    ticker: "AAA",
    raw: {
      earningsTrend: {
        defaultMethodology: "nongaap",
        trend: trend ?? [
          {
            period: "0q",
            endDate: new Date("2026-09-30T00:00:00Z"),
            earningsEstimate: { avg: 2.5, low: 2.1, high: 2.9, yearAgoEps: 2.0, numberOfAnalysts: 30 },
            revenueEstimate: { avg: 1_000_000, low: 950_000, high: 1_100_000, yearAgoRevenue: 850_000, numberOfAnalysts: 28 },
            epsTrend: { current: 2.5, "7daysAgo": 2.48, "30daysAgo": 2.4, "60daysAgo": 2.35, "90daysAgo": 2.3 },
            epsRevisions: { upLast7days: 3, upLast30days: 8, downLast7Days: 1, downLast30days: 2 },
          },
        ],
      },
    },
    ...top,
  };
}

function snapshotAt(iso, overrides = {}) {
  return { retrievedAt: iso, epsAvg: 2.0, revenueAvg: 1_000_000, vendorEpsRevisions: {}, ...overrides };
}

test("extractConsensusSnapshot pulls the verified v3 fields for the current quarter", () => {
  const snap = extractConsensusSnapshot(fundamentals());
  assert.equal(snap.period, CURRENT_QUARTER);
  assert.equal(snap.epsAvg, 2.5);
  assert.equal(snap.epsAnalysts, 30);
  assert.equal(snap.revenueAvg, 1_000_000);
  assert.equal(snap.revenueYearAgo, 850_000);
  assert.equal(snap.periodEndDate, "2026-09-30T00:00:00.000Z");
  assert.equal(snap.vendorEpsTrend.days30, 2.4);
  assert.equal(snap.vendorEpsRevisions.up30, 8);
  assert.equal(snap.source, "yahoo_earnings_trend");
});

test("extractConsensusSnapshot returns null when the module is absent", () => {
  assert.equal(extractConsensusSnapshot({ ticker: "AAA", raw: {} }), null);
  assert.equal(extractConsensusSnapshot(null), null);
});

test("a row carrying neither estimate is not recorded as coverage", () => {
  const empty = fundamentals({
    trend: [{ period: "0q", earningsEstimate: { avg: null }, revenueEstimate: { avg: null } }],
  });
  assert.equal(extractConsensusSnapshot(empty), null);
});

test("consensusSnapshotRow stamps a full zoned ISO instant, never a date-only string", () => {
  const row = consensusSnapshotRow(fundamentals(), { now: () => new Date("2026-08-01T13:45:06.123Z") });
  assert.equal(row.ticker, "AAA");
  assert.equal(row.retrievedAt, "2026-08-01T13:45:06.123Z");
  assert.match(row.retrievedAt, /^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/);
});

test("consensusChangePct measures locally-observed drift and refuses a zero base", () => {
  assert.equal(consensusChangePct({ epsAvg: 2.0 }, { epsAvg: 2.2 }), 10);
  assert.equal(consensusChangePct({ epsAvg: -2.0 }, { epsAvg: -1.0 }), 50); // magnitude base
  assert.equal(consensusChangePct({ epsAvg: 0 }, { epsAvg: 1 }), null);
  assert.equal(consensusChangePct({ epsAvg: 2.0 }, {}), null);
});

test("positiveRevisionBreadth is a 0-1 fraction; no activity is null, not zero", () => {
  const snap = extractConsensusSnapshot(fundamentals());
  assert.equal(positiveRevisionBreadth(snap), 0.8); // 8 up / (8 up + 2 down)
  assert.equal(positiveRevisionBreadth(snap, { window: "7" }), 0.75); // 3 / (3 + 1)
  assert.equal(positiveRevisionBreadth({ vendorEpsRevisions: { up30: 0, down30: 0 } }), null);
  assert.equal(positiveRevisionBreadth({ vendorEpsRevisions: {} }), null);
});

test("revenueBeatPct compares an EDGAR actual against a pre-report consensus", () => {
  const snap = extractConsensusSnapshot(fundamentals());
  assert.equal(revenueBeatPct(1_100_000, snap), 10);
  assert.equal(revenueBeatPct(900_000, snap), -10);
  assert.equal(revenueBeatPct(null, snap), null);
  assert.equal(revenueBeatPct(1_100_000, { revenueAvg: null }), null);
});

test("estimateRevisions stays insufficient_history below the mandate activation gate", () => {
  const snap = extractConsensusSnapshot(fundamentals());
  // Two snapshots spanning 40 days: enough span, too few observations.
  const result = assembleConsensusEvidence({
    snapshot: snap,
    history: [snapshotAt("2026-06-01T00:00:00Z"), snapshotAt("2026-07-11T00:00:00Z")],
  });
  assert.equal(result.estimateRevisionStatus, "insufficient_history");
  assert.equal(result.evidence.estimateRevisions, undefined);
  assert.equal(result.reasons.estimateRevisions, "insufficient_history");
});

test("three snapshots spanning under 30 days also fail the activation gate", () => {
  const result = assembleConsensusEvidence({
    snapshot: extractConsensusSnapshot(fundamentals()),
    history: [
      snapshotAt("2026-07-01T00:00:00Z"),
      snapshotAt("2026-07-08T00:00:00Z"),
      snapshotAt("2026-07-15T00:00:00Z"),
    ],
  });
  assert.equal(result.estimateRevisionStatus, "insufficient_history");
});

test("estimateRevisions activates once >=3 snapshots span >=30 days", () => {
  const newest = snapshotAt("2026-07-31T00:00:00Z", {
    epsAvg: 2.2,
    vendorEpsRevisions: { up30: 8, down30: 2 },
  });
  const result = assembleConsensusEvidence({
    snapshot: extractConsensusSnapshot(fundamentals()),
    history: [snapshotAt("2026-06-25T00:00:00Z"), snapshotAt("2026-07-10T00:00:00Z"), newest],
    actualRevenue: 1_100_000,
  });
  assert.equal(result.estimateRevisionStatus, "active");
  assert.equal(result.evidence.estimateRevisions.consensusChangePct, 10);
  assert.equal(result.evidence.estimateRevisions.positiveRevisionBreadth, 0.8);
  assert.equal(result.evidence.estimateRevisions.observedSnapshots, 3);
  assert.equal(result.evidence.estimateRevisions.observedSpanDays, 36);
  assert.deepEqual(result.boundMetrics.sort(), ["estimateRevisions", "revBeat"]);
});

test("revBeat records an explicit reason rather than a zero when the actual is absent", () => {
  const result = assembleConsensusEvidence({ snapshot: extractConsensusSnapshot(fundamentals()) });
  assert.equal(result.evidence.revBeat, undefined);
  assert.equal(result.reasons.revBeat, "no_edgar_actual_for_period");
  assert.ok(!result.boundMetrics.includes("revBeat"));
});
