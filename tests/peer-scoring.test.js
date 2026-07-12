import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BANDS,
  bandFraction,
  percentileRank,
  scoreMetricPeerRelative,
  scoreCategoriesPeerRelative,
} from "../lib/peer-scoring.js";
import { buildIndustryDistributions } from "../lib/peer-source.js";
import { AGENT_SCORING, METRIC_IDS, toInternalAgentId } from "../config/scoring/mandate-v2.js";

test("bandFraction maps the mandate bands", () => {
  assert.equal(bandFraction(0.95), 1.0); // top decile
  assert.equal(bandFraction(0.9), 1.0); // decile boundary inclusive
  assert.equal(bandFraction(0.8), 0.75); // top quartile
  assert.equal(bandFraction(0.7), 0.5); // top third
  assert.equal(bandFraction(0.55), 0.25); // middle → minimal
  assert.equal(bandFraction(0.49), 0.0); // bottom half
  assert.equal(bandFraction(0.0), 0.0);
  assert.equal(bandFraction(null), null);
});

test("BANDS are ordered high→low and cover the range", () => {
  for (let i = 1; i < BANDS.length; i++) {
    assert.ok(BANDS[i - 1].minPercentile > BANDS[i].minPercentile);
  }
  assert.equal(BANDS[BANDS.length - 1].minPercentile, 0);
});

test("percentileRank ranks higher-is-better and excludes self", () => {
  const peers = [10, 20, 30, 40, 50]; // candidate 50 is in the set
  // better than 10,20,30,40 (4 of 4 true peers) → 1.0
  assert.equal(percentileRank(50, peers, true), 1.0);
  // 30 is better than 10,20 (2 of 4 true peers) → 0.5
  assert.equal(percentileRank(30, peers, true), 0.5);
});

test("percentileRank flips for lower-is-better (valuation)", () => {
  const peers = [10, 20, 30, 40, 50];
  // lower is better: 10 beats everything → 1.0
  assert.equal(percentileRank(10, peers, false), 1.0);
  assert.equal(percentileRank(50, peers, false), 0.0);
});

test("percentileRank returns null on missing value or no true peers", () => {
  assert.equal(percentileRank(null, [1, 2, 3]), null);
  assert.equal(percentileRank(5, []), null);
  assert.equal(percentileRank(5, [5]), null); // only self
});

test("scoreMetricPeerRelative awards banded points for a real peer set", () => {
  const peers = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const spec = { points: 10, higherIsBetter: true };
  const r = scoreMetricPeerRelative(10, peers, spec, 7);
  assert.equal(r.thinPeerSet, false);
  assert.equal(r.missing, false);
  assert.equal(r.points, 10); // top decile → full points
});

test("scoreMetricPeerRelative flags thin peer sets instead of guessing", () => {
  const spec = { points: 10, higherIsBetter: true };
  const r = scoreMetricPeerRelative(5, [1, 2, 3], spec, 7); // only 3 comps
  assert.equal(r.thinPeerSet, true);
  assert.equal(r.points, null); // engine does not invent an absolute score
});

test("scoreMetricPeerRelative marks missing values (vendor-lag input)", () => {
  const spec = { points: 10, higherIsBetter: true };
  const r = scoreMetricPeerRelative(null, [1, 2, 3, 4, 5, 6, 7, 8], spec, 7);
  assert.equal(r.missing, true);
  assert.equal(r.points, 0);
});

// --- category-level scoring -------------------------------------------------

function fullDistributions() {
  // 8 peers per metric (≥ thinPeerMin) so nothing falls back.
  const dist = {};
  for (const m of METRIC_IDS) dist[m] = [1, 2, 3, 4, 5, 6, 7, 8];
  return dist;
}

test("scoreCategoriesPeerRelative sums a full vector to a 0–100 score", () => {
  const dist = fullDistributions();
  // Candidate is best-in-class on every higher-is-better metric (value 9 > all peers);
  // peerValuation is lower-is-better so 9 is worst there.
  const vector = {};
  for (const m of METRIC_IDS) vector[m] = 9;
  const config = AGENT_SCORING["agent-1"];
  const res = scoreCategoriesPeerRelative(vector, dist, config);
  assert.equal(res.basis, "full");
  assert.equal(res.thinPeerSet, false);
  assert.ok(res.total > 0 && res.total <= 100);
  // peerValuation is lower-is-better; value 9 is worst → bottom half → 0 points.
  assert.equal(res.perMetric.peerValuation.points, 0);
});

test("vendor-lag rescale excludes missing fields from numerator and denominator", () => {
  const dist = fullDistributions();
  const config = AGENT_SCORING["agent-1"];
  const vector = {};
  for (const m of METRIC_IDS) vector[m] = 9;
  vector.peerValuation = 0; // best on the lower-is-better metric so it earns full points too
  // Drop two fields → they must not zero the score, they must rescale it out.
  vector.estimateRevisions = null;
  vector.thirteenF = null;

  const res = scoreCategoriesPeerRelative(vector, dist, config);
  assert.equal(res.basis, "rescaled_available_fields");
  assert.deepEqual(res.missingMetrics.sort(), ["estimateRevisions", "thirteenF"]);
  // All scorable metrics are best-in-class → earned == maxAvailable → 100.
  assert.equal(res.total, 100);
  assert.ok(res.maxAvailable < 100); // two metrics excluded
});

test("thin peer metrics are reported, not scored to zero", () => {
  const config = AGENT_SCORING["agent-1"];
  const dist = fullDistributions();
  dist.revBeat = [1, 2]; // thin for this one metric only
  const vector = {};
  for (const m of METRIC_IDS) vector[m] = 9;
  vector.peerValuation = 0;
  const res = scoreCategoriesPeerRelative(vector, dist, config);
  assert.ok(res.thinMetrics.includes("revBeat"));
  assert.equal(res.thinPeerSet, true);
  assert.equal(res.perMetric.revBeat.points, null);
});

test("sector substitution reroutes a metric to its substitute's data", () => {
  const config = AGENT_SCORING["agent-1"];
  const dist = fullDistributions();
  dist.marginTrend = []; // native metric has no peer data
  dist.revGrowth = [1, 2, 3, 4, 5, 6, 7, 8]; // substitute source
  const vector = {};
  for (const m of METRIC_IDS) vector[m] = 9;
  vector.peerValuation = 0;
  const res = scoreCategoriesPeerRelative(vector, dist, config, {
    substitutions: { marginTrend: "revGrowth" },
  });
  assert.deepEqual(res.substitutionsUsed, [{ metric: "marginTrend", substitute: "revGrowth" }]);
  assert.equal(res.perMetric.marginTrend.points, config.categories.C.metrics.marginTrend.points); // scored via substitute
});

// --- peer-source + config sanity -------------------------------------------

test("buildIndustryDistributions groups sorted values by industry, skips unclassified", () => {
  const names = [
    { ticker: "AAA", industry: "Software", metrics: { revGrowth: 30, ps: 5 } },
    { ticker: "BBB", industry: "Software", metrics: { revGrowth: 10, ps: 8 } },
    { ticker: "CCC", industry: "Software", metrics: { revGrowth: 20, ps: null } },
    { ticker: "DDD", industry: null, metrics: { revGrowth: 99 } }, // unclassified → dropped
  ];
  const dist = buildIndustryDistributions(names, ["revGrowth", "ps"]);
  assert.deepEqual(dist.Software.revGrowth, [10, 20, 30]); // sorted, nulls dropped
  assert.deepEqual(dist.Software.ps, [5, 8]);
  assert.equal(dist.null, undefined);
});

test("agent id mapping and config shape are consistent", () => {
  assert.equal(toInternalAgentId("agent_one"), "agent-1");
  assert.equal(toInternalAgentId("agent_four"), "agent-4");
  for (const id of ["agent-1", "agent-2", "agent-3"]) {
    const total = Object.values(AGENT_SCORING[id].categories).reduce((s, c) => s + c.maxPoints, 0);
    assert.equal(total, 100, `${id} category points must total 100`);
  }
});
