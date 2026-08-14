import test from "node:test";
import assert from "node:assert/strict";
import { runPeerCoverageRefresh } from "../jobs/peer-coverage-refresh.js";
import { buildConsensusBundles, scoreCohortForAgent } from "../jobs/mandate-scoring.js";
import { assembleMandateInputs } from "../lib/mandate-evidence.js";

const env = { PEER_METRICS_ENABLED: "1", PEER_METRICS_EDGAR: "1" };
const catalog = { V: { t: "V", i: "Credit Services", s: "Financial Services", mc: 100 } };
const recentlyRequestedAt = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

const fundamentals = (ticker) => ({
  ticker,
  industry: "Credit Services",
  sector: "Financial Services",
  raw: { financialData: {}, summaryDetail: {} },
});

const trend = (ticker) => ({
  ticker,
  raw: {
    earningsTrend: {
      trend: [{
        period: "0q",
        endDate: new Date("2026-09-30T00:00:00.000Z"),
        earningsEstimate: { avg: 2.5, numberOfAnalysts: 20 },
        revenueEstimate: { avg: 9_000_000_000, numberOfAnalysts: 18 },
        epsRevisions: { upLast30days: 6, downLast30days: 1 },
      }],
    },
  },
});

const refreshArgs = (overrides = {}) => ({
  env,
  limit: 1,
  getCatalog: async () => catalog,
  getRequests: async () => ({ V: { ticker: "V", industry: "Credit Services", lastRequestedAt: recentlyRequestedAt } }),
  getMetrics: async () => ({}),
  saveMetrics: async () => {},
  getFundamentals: async (ticker) => fundamentals(ticker),
  getCompanyFacts: async () => null,
  getConsensusTrend: async (ticker) => trend(ticker),
  consensusStore: () => true,
  now: () => new Date("2026-08-14T12:00:00.000Z"),
  sleep: async () => {},
  ...overrides,
});

test("the coverage pass now accumulates consensus observations alongside peer metrics", async () => {
  const written = [];
  const result = await runPeerCoverageRefresh(refreshArgs({
    saveConsensusSnapshots: async (rows) => { written.push(...rows); return { attempted: rows.length, inserted: rows.length }; },
  }));
  assert.equal(result.consensusObserved, 1);
  assert.equal(result.consensusStored, 1);
  assert.equal(written[0].ticker, "V");
  assert.equal(written[0].revenueAvg, 9_000_000_000);
  assert.equal(written[0].retrievedAt, "2026-08-14T12:00:00.000Z");
});

test("a consensus failure never costs the ticker its peer-metrics row", async () => {
  const saves = [];
  const result = await runPeerCoverageRefresh(refreshArgs({
    getConsensusTrend: async () => { throw new Error("yahoo schema drift"); },
    saveMetrics: async (rows) => saves.push(structuredClone(rows)),
    saveConsensusSnapshots: async () => { throw new Error("should not be called"); },
  }));
  assert.equal(result.cached, 1, "peer metrics still collected");
  assert.equal(result.failed, 0);
  assert.equal(result.consensusFailed, 1);
  assert.ok(saves.at(-1).V, "the peer row survives a consensus outage");
});

test("a consensus write failure is loud but does not fail the coverage pass", async () => {
  const result = await runPeerCoverageRefresh(refreshArgs({
    saveConsensusSnapshots: async () => { throw new Error("pg down"); },
  }));
  assert.equal(result.state, "completed");
  assert.equal(result.cached, 1);
  assert.equal(result.consensusStored, 0);
});

test("no durable store means no collection, rather than silently discarded observations", async () => {
  const result = await runPeerCoverageRefresh(refreshArgs({
    consensusStore: () => false,
    getConsensusTrend: async () => { throw new Error("should not be called"); },
  }));
  assert.equal(result.consensusObserved, 0);
  assert.equal(result.cached, 1);
});

// --- scoring side -----------------------------------------------------------

const observedAt = "2026-08-14T00:00:00.000Z";
const candidate = {
  ticker: "V",
  industry: "Credit Services",
  metrics: {},
  derived: {
    _asOf: "2026-06-30",
    _revenueQuarterSeries: [{ end: "2026-06-30", val: 9_500_000_000, filed: "2026-07-25" }],
  },
};
const history = [
  { retrievedAt: "2026-05-01T00:00:00.000Z", periodEndDate: "2026-06-30T00:00:00.000Z", epsAvg: 2.3, revenueAvg: 8_900_000_000 },
  { retrievedAt: "2026-07-20T00:00:00.000Z", periodEndDate: "2026-06-30T00:00:00.000Z", epsAvg: 2.5, revenueAvg: 9_000_000_000,
    vendorEpsRevisions: { up30: 6, down30: 1 } },
];

test("bundles pair the reported quarter with the pre-report consensus", () => {
  const bundles = buildConsensusBundles({
    candidates: [candidate],
    histories: new Map([["V", history]]),
    asOf: observedAt,
  });
  assert.equal(bundles.V.actualRevenue, 9_500_000_000);
  assert.equal(bundles.V.snapshot.revenueAvg, 9_000_000_000, "the 2026-07-20 snapshot, not the May one");
  assert.equal(bundles.V.history.length, 2);
});

test("a ticker with no observed history gets no bundle at all", () => {
  const bundles = buildConsensusBundles({ candidates: [candidate], histories: new Map(), asOf: observedAt });
  assert.deepEqual(bundles, {});
});

test("revBeat binds through the cohort scorer once the bundle is supplied", () => {
  const bundles = buildConsensusBundles({
    candidates: [candidate],
    histories: new Map([["V", history]]),
    asOf: observedAt,
  });
  const bound = assembleMandateInputs({
    agentId: "agent-1",
    metrics: candidate.metrics,
    derived: candidate.derived,
    consensus: bundles.V,
  });
  assert.ok(bound.boundMetrics.includes("revBeat"), "revBeat is bound from observed consensus");
  // 9.5bn actual vs 9.0bn estimate ≈ +5.56%
  assert.ok(Math.abs(bound.absoluteEvidence.revBeat.beatPct - 5.555556) < 0.001);
});

test("estimateRevisions still reports insufficient history below the activation gate", () => {
  // Two snapshots spanning 80 days: the span passes, the count (≥3) does not.
  const bound = assembleMandateInputs({
    agentId: "agent-1",
    metrics: candidate.metrics,
    derived: candidate.derived,
    consensus: { snapshot: history[1], history, actualRevenue: 9_500_000_000 },
  });
  assert.ok(!bound.boundMetrics.includes("estimateRevisions"));
});

test("scoring a cohort without any bundle is byte-identical to scoring it before consensus existed", () => {
  const withoutArg = scoreCohortForAgent("agent-1", [candidate]);
  const withEmpty = scoreCohortForAgent("agent-1", [candidate], { consensusByTicker: {} });
  assert.deepEqual(
    withoutArg.scores.map((s) => s.boundMetrics),
    withEmpty.scores.map((s) => s.boundMetrics),
  );
});
