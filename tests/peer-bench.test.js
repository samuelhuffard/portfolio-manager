import test from "node:test";
import assert from "node:assert/strict";
import { buildPeerBench, peerBenchCapacity, runPeerBench } from "../jobs/peer-bench.js";

const catalog = Object.fromEntries(["A", "B", "C", "D", "E", "F", "G"].map((ticker, index) => [ticker, { t: ticker, i: "Payments", s: "Financial Services", mc: 100 - index, advd: 10_000_000, p: 10, c52: index }]));
const configs = Object.fromEntries(["agent-1", "agent-2", "agent-3"].map((id) => [id, { riskLimits: {} }]));
const row = (ticker) => ({ ticker, industry: "Payments", sector: "Financial Services", metrics: { revGrowth: 0.1, peerValuation: 20 }, quant: { revenueGrowth: 0.1, earningsGrowth: 0.1, profitMargins: 0.1, returnOnEquity: 0.1, trailingPE: 20, debtToEquity: 1, pegRatio: 1 } });

test("peer bench supplies a bounded deterministic candidate pool for every agent", () => {
  const bench = buildPeerBench({ catalog, agentConfigs: configs, perAgent: 4 });
  assert.ok(Object.values(bench).every((rows) => rows.length <= 4));
  assert.equal(bench["agent-1"].length, 4);
  assert.equal(bench["agent-3"].length, 4);
});

test("peer bench reports a per-agent ready-capacity buffer", () => {
  const bench = buildPeerBench({ catalog, agentConfigs: configs, perAgent: 7 });
  const metrics = Object.fromEntries(Object.keys(catalog).map((ticker) => [ticker, row(ticker)]));
  const capacity = peerBenchCapacity(bench, metrics);
  assert.equal(capacity.agents["agent-1"].ready, 7);
  assert.equal(capacity.sufficient, false);
});

test("capacity check can read the bench without re-queueing coverage work", async () => {
  let requested = 0;
  const result = await runPeerBench({
    perAgent: 2,
    getCatalog: async () => catalog,
    getMetrics: async () => ({}),
    requestCoverage: async () => { requested++; },
    agentConfigs: configs,
    refreshRequests: false,
  });
  assert.equal(requested, 0);
  assert.equal(result.requested, 0);
});
