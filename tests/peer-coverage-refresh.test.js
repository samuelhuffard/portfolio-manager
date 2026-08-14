import test from "node:test";
import assert from "node:assert/strict";
import { runPeerCoverageRefresh } from "../jobs/peer-coverage-refresh.js";

const env = { PEER_METRICS_ENABLED: "1", PEER_METRICS_EDGAR: "1" };
const catalog = {
  V: { t: "V", i: "Credit Services", s: "Financial Services", mc: 100 },
  MA: { t: "MA", i: "Credit Services", s: "Financial Services", mc: 90 },
  AXP: { t: "AXP", i: "Credit Services", s: "Financial Services", mc: 80 },
};

// A coverage request only stays actionable for PEER_COVERAGE_ACTIVE_REQUEST_MS
// (7 days), so a hardcoded request date silently turns this test from "a fresh
// cohort is refreshed" into "an expired request is ignored" once it ages out.
// Relative to now, it keeps testing what it was written to test.
const recentlyRequestedAt = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

test("requested cohort refresh checkpoints fetched metrics without a model or broad refresh", async () => {
  const saves = [];
  const result = await runPeerCoverageRefresh({
    env,
    limit: 3,
    getCatalog: async () => catalog,
    getRequests: async () => ({ V: { ticker: "V", industry: "Credit Services", lastRequestedAt: recentlyRequestedAt } }),
    getMetrics: async () => ({}),
    saveMetrics: async (rows) => saves.push(structuredClone(rows)),
    getFundamentals: async (ticker) => ({ industry: "Credit Services", sector: "Financial Services", raw: { financialData: {}, summaryDetail: {} }, ticker }),
    getCompanyFacts: async () => null,
    consensusStore: () => false,
    sleep: async () => {},
  });
  assert.equal(result.state, "completed");
  assert.equal(result.cached, 3);
  assert.equal(result.failed, 0);
  assert.deepEqual(result.targets, ["V", "MA", "AXP"]);
  assert.equal(saves.length, 1);
  assert.deepEqual(Object.keys(saves[0]).sort(), ["AXP", "MA", "V"]);
});

test("cohort refresh remains disabled until both free-data collectors are explicitly enabled", async () => {
  const result = await runPeerCoverageRefresh({ env: { PEER_METRICS_ENABLED: "1" } });
  assert.deepEqual(result, { state: "disabled", reason: "peer_metrics_not_enabled", attempted: 0, cached: 0, failed: 0 });
});
