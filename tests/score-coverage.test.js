import { test } from "node:test";
import assert from "node:assert/strict";
import {
  summarizeMetricCoverage,
  freshnessHistogram,
  unsupportedReasonCounts,
  coverageGate,
} from "../lib/score-coverage.js";

const metricIds = ["growth", "valuation"];
const row = (overrides = {}) => ({
  perMetric: {
    growth: { points: 10, freshnessState: "fresh" },
    valuation: { points: 10, freshnessState: "fresh" },
  },
  complete: true,
  ...overrides,
});

test("coverage keeps complete and fresh accounting distinct from explicit unsupported", () => {
  const summary = summarizeMetricCoverage([
    row(),
    row({ complete: false, missingMetrics: ["valuation"], perMetric: {
      growth: { points: 8, freshnessState: "fresh" },
      valuation: { points: null, missing: true, freshnessState: "unavailable" },
    } }),
    row({ complete: false, perMetric: {
      growth: { points: 8, freshnessState: "fresh" },
      valuation: { points: null, missing: true, freshnessState: "unsupported", unsupportedReason: "special_sector_adapter_pending" },
    } }),
  ], metricIds);

  assert.equal(summary.total, 3);
  assert.equal(summary.completeCount, 1);
  assert.equal(summary.completeRate, 1 / 3);
  assert.equal(summary.metrics.growth.fresh, 3);
  assert.equal(summary.metrics.valuation.explicitUnsupported, 1);
  assert.equal(summary.freshOrExplicitUnsupportedRate, 2 / 3);
  assert.deepEqual(unsupportedReasonCounts([
    { unsupportedReason: "special_sector_adapter_pending" },
    { perMetric: {
      growth: { freshnessState: "unsupported", unsupportedReason: "special_sector_adapter_pending" },
      valuation: { freshnessState: "unsupported", unsupportedReason: "special_sector_adapter_pending" },
    } },
  ]), { special_sector_adapter_pending: 2 });
});

test("freshness histogram retains unknown and stale states instead of calling them fresh", () => {
  assert.deepEqual(freshnessHistogram([
    { freshnessState: "fresh" },
    { freshnessState: "stale" },
    { asOf: "2026-01-01" },
  ], new Date("2026-07-13T00:00:00Z")), {
    fresh: 1,
    stale: 1,
    unavailable: 0,
    unsupported: 0,
    unknown: 1,
  });
});

test("coverage gate distinguishes a partial cohort from a complete cohort", () => {
  const partial = summarizeMetricCoverage([row(), row({ complete: false, missingMetrics: ["valuation"], perMetric: {
    growth: { points: 10, freshnessState: "fresh" },
    valuation: { points: null, missing: true, freshnessState: "unavailable" },
  } })], metricIds);
  const complete = summarizeMetricCoverage([row(), row()], metricIds);
  assert.equal(coverageGate(partial).pass, false);
  assert.deepEqual(coverageGate(partial).reasons, ["incomplete_scores", "insufficient_fresh_or_explicit_unsupported"]);
  assert.equal(coverageGate(complete, { minCompleteRate: 1, minFreshOrExplicitUnsupportedRate: 0.9 }).pass, true);
  assert.equal(coverageGate(summarizeMetricCoverage([], metricIds)).pass, false);
});

test("unsupported cohort rows count in the denominator for every requested metric", () => {
  const summary = summarizeMetricCoverage([
    row(),
    {
      supported: false,
      unsupported: true,
      unsupportedReason: "special_sector_adapter_pending",
      freshnessState: "unsupported",
    },
  ], metricIds);
  assert.equal(summary.total, 2);
  assert.equal(summary.completeCount, 1);
  assert.equal(summary.metrics.growth.explicitUnsupported, 1);
  assert.equal(summary.metrics.valuation.explicitUnsupported, 1);
  assert.equal(summary.freshCount, 1);
  assert.equal(summary.freshOrExplicitUnsupportedCount, 2);
  assert.deepEqual(freshnessHistogram([{ supported: false, unsupported: true, unsupportedReason: "special_sector_adapter_pending" }]), {
    fresh: 0,
    stale: 0,
    unavailable: 0,
    unsupported: 1,
    unknown: 0,
  });
});
