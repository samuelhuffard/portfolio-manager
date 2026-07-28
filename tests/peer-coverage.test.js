import test from "node:test";
import assert from "node:assert/strict";
import { assessPeerCoverage, coveragePriorityTickers, mergeCoverageRequests, scorePeerFundamentals, selectPeerCoverageRefreshTargets, selectPeerReadyCandidates } from "../lib/peer-coverage.js";
import { queuePeerCoverageForCandidates } from "../jobs/research-scan.js";
import { selectEnrichmentBatch } from "../lib/universe.js";

const row = (ticker, industry = "Payments", sector = "Financial Services") => ({
  ticker, industry, sector, metrics: { revGrowth: 0.1, peerValuation: 20 },
});

test("coverage requires target metrics and six usable peers", () => {
  const peers = Object.fromEntries(["A", "B", "C", "D", "E", "F"].map((ticker) => [ticker, row(ticker)]));
  const missingTarget = assessPeerCoverage({ ticker: "V", industry: "Payments", sector: "Financial Services", peerMetrics: peers });
  assert.equal(missingTarget.ready, false);
  assert.equal(missingTarget.reason, "target_peer_metrics_unavailable");
  const covered = assessPeerCoverage({ ticker: "V", peerMetrics: { ...peers, V: row("V") } });
  assert.equal(covered.ready, true);
  assert.equal(covered.peerCount, 6);
  assert.equal(covered.fallbackMethod, "blended_50_50");
});

test("coverage requests merge rather than duplicating a ticker", () => {
  const first = mergeCoverageRequests({}, [{ ticker: "V", industry: "Payments", source: "lab" }], "2026-07-27T12:00:00.000Z");
  const second = mergeCoverageRequests(first, [{ ticker: "v", sector: "Financial Services", source: "lab" }], "2026-07-27T13:00:00.000Z");
  assert.equal(Object.keys(second).length, 1);
  assert.equal(second.V.requestCount, 2);
  assert.equal(second.V.industry, "Payments");
  assert.equal(second.V.sector, "Financial Services");
});

test("requested target and cohort preempt ordinary enrichment", () => {
  const catalog = {
    V: { t: "V", i: "Payments", s: "Financial Services", mc: 500 },
    MA: { t: "MA", i: "Payments", s: "Financial Services", mc: 450 },
    PYPL: { t: "PYPL", i: "Payments", s: "Financial Services", mc: 100 },
    OLD: { t: "OLD", mc: 999 },
  };
  const requests = { V: { ticker: "V", industry: "Payments", lastRequestedAt: "2026-07-27T12:00:00.000Z" } };
  const priority = coveragePriorityTickers(catalog, requests);
  assert.deepEqual(priority.slice(0, 3), ["V", "MA", "PYPL"]);
  assert.deepEqual(selectEnrichmentBatch(catalog, { perRun: 3, priorityTickers: priority }), ["V", "MA", "PYPL"]);
});

test("thin industries widen collection to the sector so eight peers can be built", () => {
  const catalog = {
    AAA: { t: "AAA", i: "Niche Payments", s: "Financial Services", mc: 500 },
    BBB: { t: "BBB", i: "Niche Payments", s: "Financial Services", mc: 400 },
    CCC: { t: "CCC", i: "Niche Payments", s: "Financial Services", mc: 300 },
    DDD: { t: "DDD", i: "Banks", s: "Financial Services", mc: 250 },
    EEE: { t: "EEE", i: "Banks", s: "Financial Services", mc: 240 },
    FFF: { t: "FFF", i: "Banks", s: "Financial Services", mc: 230 },
    GGG: { t: "GGG", i: "Insurance", s: "Financial Services", mc: 220 },
    HHH: { t: "HHH", i: "Insurance", s: "Financial Services", mc: 210 },
    III: { t: "III", i: "Insurance", s: "Financial Services", mc: 200 },
  };
  const priority = coveragePriorityTickers(catalog, { AAA: { ticker: "AAA", industry: "Niche Payments", sector: "Financial Services", lastRequestedAt: "2026-07-27T12:00:00.000Z" } });
  assert.equal(priority.length, 9);
  assert.deepEqual(priority.slice(0, 3), ["AAA", "BBB", "CCC"]);
});

test("refresh planning skips satisfied cohorts and fetches only missing peer rows", () => {
  const catalog = Object.fromEntries(["V", "A", "B", "C", "D", "E", "F", "MISSING"].map((ticker) => [ticker, { t: ticker, i: "Payments", s: "Financial Services" }]));
  const peerMetrics = Object.fromEntries(["V", "A", "B", "C", "D", "E", "F"].map((ticker) => [ticker, row(ticker)]));
  const plan = selectPeerCoverageRefreshTargets(catalog, {
    V: { ticker: "V", industry: "Payments", sector: "Financial Services" },
    MISSING: { ticker: "MISSING", industry: "Payments", sector: "Financial Services" },
  }, peerMetrics);
  assert.equal(plan.unresolvedRequests, 1);
  assert.deepEqual(plan.targets, ["MISSING"]);
});

test("peer-ready slate candidates backfill deferred priority slots without expanding the budget", () => {
  const peerMetrics = Object.fromEntries(["READY", "P1", "P2", "P3", "P4", "P5", "P6", "BACKFILL"].map((ticker) => [ticker, row(ticker)]));
  const result = selectPeerReadyCandidates({
    primary: [
      { ticker: "MISSING", industry: "Payments", sector: "Financial Services" },
      { ticker: "READY", industry: "Payments", sector: "Financial Services" },
    ],
    fallback: [
      { ticker: "READY", industry: "Payments", sector: "Financial Services" },
      { ticker: "BACKFILL", industry: "Payments", sector: "Financial Services" },
    ],
    peerMetrics,
    limit: 2,
  });
  assert.equal(result.deferredPrimary, 1);
  assert.equal(result.backfilled, 1);
  assert.deepEqual(result.selected.map((entry) => entry.candidate.ticker), ["READY", "BACKFILL"]);
});

test("Lab scores a target against stored peer fundamentals rather than itself", () => {
  const candidate = { ticker: "V", quant: { revenueGrowth: 0.2, earningsGrowth: 0.3, profitMargins: 0.5, returnOnEquity: 0.4, trailingPE: 20, debtToEquity: 1, pegRatio: 1 } };
  const peers = Array.from({ length: 7 }, (_, index) => ({
    ticker: `P${index}`,
    quant: { revenueGrowth: 0.02 * index, earningsGrowth: 0.03 * index, profitMargins: 0.05 * index, returnOnEquity: 0.04 * index, trailingPE: 30 + index, debtToEquity: 10 + index, pegRatio: 2 + index },
  }));
  const result = scorePeerFundamentals({ candidate, peers });
  assert.ok(result.quantScore > 90);
  assert.ok(result.breakdown.revenueGrowth > 90);
  assert.ok(result.breakdown.trailingPE > 90); // lower P/E ranks higher
});

test("peer-fundamental scoring refuses legacy rows without enough scoreable fields", () => {
  const candidate = { ticker: "V", raw: { financialData: { revenueGrowth: 0.2 } } };
  const peers = Array.from({ length: 7 }, (_, index) => ({ ticker: `P${index}`, quant: { revenueGrowth: index / 10 } }));
  assert.equal(scorePeerFundamentals({ candidate, peers }), null);
});

test("scheduled research queues every selected candidate missing a complete cohort", async () => {
  const requested = [];
  const result = await queuePeerCoverageForCandidates([
    { ticker: "V", industry: "Payments", sector: "Financial Services" },
    { ticker: "MA", industry: "Payments", sector: "Financial Services" },
  ], {
    peerMetrics: {},
    requestCoverage: async (request) => requested.push(request),
  });
  assert.deepEqual(result.queued, ["V", "MA"]);
  assert.deepEqual(requested.map((request) => request.source), ["scheduled_research", "scheduled_research"]);
});
