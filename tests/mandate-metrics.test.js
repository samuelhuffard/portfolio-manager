import { test } from "node:test";
import assert from "node:assert/strict";
import { extractMetricVector, peerMetricsRow, POPULATED_METRICS, DEFERRED_METRICS } from "../lib/mandate-metrics.js";
import { METRIC_IDS, AGENT_SCORING } from "../config/scoring/mandate-v2.js";
import { buildIndustryDistributions } from "../lib/peer-source.js";
import { scoreCategoriesPeerRelative } from "../lib/peer-scoring.js";

/** Minimal Yahoo fetchFundamentals-shaped fixture. */
function fundamentals(overrides = {}) {
  const { financialData = {}, summaryDetail = {}, defaultKeyStatistics = {}, ...top } = overrides;
  return {
    ticker: "AAA",
    industry: "Software—Application",
    raw: {
      price: { regularMarketPrice: 100 },
      financialData: { revenueGrowth: 0.3, ...financialData },
      summaryDetail: { trailingPE: 40, forwardPE: 25, ...summaryDetail },
      defaultKeyStatistics: { ...defaultKeyStatistics },
    },
    ...top,
  };
}

test("extractMetricVector populates the interim yfinance subset (v2.1)", () => {
  const v = extractMetricVector(fundamentals());
  assert.equal(v.revGrowth, 0.3);
  assert.equal(v.peerValuation, 25); // forward P/E preferred (lower is better)
});

test("peerValuation falls back to trailing P/E when forward is absent", () => {
  const v = extractMetricVector(fundamentals({ summaryDetail: { forwardPE: undefined, trailingPE: 33 } }));
  assert.equal(v.peerValuation, 33);
});

test("extractMetricVector returns null for EDGAR/local-sourced metrics (never fabricates)", () => {
  const v = extractMetricVector(fundamentals());
  for (const m of DEFERRED_METRICS) assert.equal(v[m], null, `${m} must be null until its EDGAR/local source is wired`);
});

test("extractMetricVector degrades to nulls on empty/garbage input, never throws", () => {
  assert.doesNotThrow(() => extractMetricVector(undefined));
  const v = extractMetricVector({ raw: {} });
  for (const m of METRIC_IDS) assert.ok(v[m] === null || typeof v[m] === "number");
  assert.equal(v.peerValuation, null); // no PE ⇒ null
});

test("the vector covers exactly METRIC_IDS (v2.1) and populated+deferred partition it", () => {
  const v = extractMetricVector(fundamentals());
  assert.deepEqual(Object.keys(v).sort(), [...METRIC_IDS].sort());
  assert.deepEqual([...POPULATED_METRICS, ...DEFERRED_METRICS].sort(), [...METRIC_IDS].sort());
});

test("peerMetricsRow carries industry, vector and a zoned retrieval instant", () => {
  const row = peerMetricsRow(fundamentals(), null, { now: () => new Date("2026-07-13T20:00:00.000Z") });
  assert.equal(row.industry, "Software—Application");
  assert.equal(row.metrics.revGrowth, 0.3);
  assert.equal(row.ts, "2026-07-13T20:00:00.000Z");
  assert.equal(row.retrievedAt, "2026-07-13T20:00:00.000Z");
  assert.equal(row.src, "yfinance");
});

test("EDGAR companyfacts populate & override the EDGAR-sourced metrics", () => {
  // Minimal companyfacts: 8 revenue quarters (2023 flat, 2024 rising) → latest YoY 40%.
  const ends = ["2023-03-31", "2023-06-30", "2023-09-30", "2023-12-31", "2024-03-31", "2024-06-30", "2024-09-30", "2024-12-31"];
  const vals = [100, 100, 100, 100, 110, 120, 130, 140];
  const startFor = (e) => new Date(Date.parse(e) - 91 * 86400000).toISOString().slice(0, 10);
  const rev = ends.map((e, i) => ({ start: startFor(e), end: e, val: vals[i], fy: +e.slice(0, 4), fp: "Q1", form: "10-Q", filed: e }));
  const cf = { cik: 1, entityName: "T", facts: { "us-gaap": { Revenues: { units: { USD: rev } } } } };

  const yOnly = extractMetricVector(fundamentals());
  assert.equal(yOnly.revGrowth, 0.3); // yfinance interim

  const withEdgar = extractMetricVector(fundamentals(), cf);
  assert.equal(Math.round(withEdgar.revGrowth * 100), 40); // EDGAR overrides the interim
  assert.equal(peerMetricsRow(fundamentals(), cf).src, "edgar+yfinance");
});

test("end-to-end: extract → build distributions → score peer-relative (rescaled while EDGAR pending)", () => {
  // 8 software names with spread-out revenue growth + valuation.
  const cohort = [];
  for (let i = 0; i < 8; i++) {
    cohort.push(peerMetricsRow(fundamentals({ financialData: { revenueGrowth: 0.05 * i }, summaryDetail: { forwardPE: 30 - i } })));
  }
  const names = cohort.map((r, i) => ({ ticker: `N${i}`, industry: r.industry, metrics: r.metrics }));
  const dist = buildIndustryDistributions(names, METRIC_IDS);
  assert.equal(dist["Software—Application"].revGrowth.length, 8);

  const candidate = extractMetricVector(fundamentals({ financialData: { revenueGrowth: 0.4 }, summaryDetail: { forwardPE: 10 } }));
  const res = scoreCategoriesPeerRelative(candidate, dist["Software—Application"], AGENT_SCORING["agent-2"]);
  // Most v2.1 metrics are EDGAR-pending ⇒ null ⇒ rescale basis, not a zeroed score.
  assert.equal(res.basis, "rescaled_available_fields");
  assert.ok(res.total > 0 && res.total <= 100);
  assert.equal(res.perMetric.revGrowth.points, AGENT_SCORING["agent-2"].categories.A.metrics.revGrowth.points); // top ⇒ full
  assert.equal(res.perMetric.peerValuation.points, AGENT_SCORING["agent-2"].categories.C.metrics.peerValuation.points); // cheapest ⇒ full
});
