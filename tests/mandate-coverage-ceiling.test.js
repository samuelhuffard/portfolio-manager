import test from "node:test";
import assert from "node:assert/strict";
import { scoreMandateCandidate } from "../lib/mandate-score.js";
import { AGENT_SCORING } from "../config/scoring/mandate-v2.js";

/**
 * `maxAvailable` is what gates actionability (>= 80 of 100).
 *
 * These tests assert the CEILING, not a score. They feed each metric evidence good
 * enough to land in some band and check how many points the scorer is willing to put on
 * the table. A metric that reports `missing` contributes nothing to maxAvailable, which
 * is exactly the mechanism that holds a thinly-evidenced name down.
 *
 * Category D (institutional ownership + 13F, 15 pts) was retired 2026-08-22 and its
 * points redistributed proportionally across A/B/C, so the ceiling is now reached from
 * seven metrics rather than nine. The retired pair must never contribute again while
 * unbound — `lib/thirteen-f.js` still derives that evidence and a caller could still
 * hand it over, so that is pinned explicitly below rather than left to inspection.
 */

const fullEvidence = {
  "agent-1": {
    revGrowth: { currentGrowthPct: 30, accelerationPoints: 8 },
    epsTrajectory: { epsGrowthPct: 30, accelerationPoints: 8 },
    marginTrend: { marginChangeBps: 250, documentedInvestmentExplanation: false },
    balanceSheet: { isProfitable: true, isPreProfit: false, netCash: true, netDebtEbitda: 0.4, interestCoverage: 20, cashRunwayQuarters: 999 },
    revBeat: { beatPct: 7 },
    estimateRevisions: { consensusChangePct: 8, consensusChangePct90d: 8, positiveBreadthPct: 80, positiveNegativeRatio: 4, net30dReversal: false },
  },
  "agent-3": {
    revGrowth: { revenueCagr3yPct: 22, positiveGrowthYears: 3, minimumAnnualGrowthPct: 18, maxAnnualGrowthSpreadPoints: 6, volatileYears: 0, negativeGrowthYears: 0, materiallyErraticGrowth: false },
    epsTrajectory: { normalizedEpsCagr3yPct: 20, positiveEpsYears: 3, worstAnnualDeclinePct: 0, positiveCumulativeTrajectory: true, persistentTwoYearDecline: false, persistentDeterioration: false },
    marginTrend: { marginChangeBps3y: 300, twoYearContractionSequence: false, documentedStructuralInvestmentExplanation: false },
    balanceSheet: { latestNetDebtEbitda: 0.4, medianNetDebtEbitda3y: 0.5, latestInterestCoverage: 20, medianInterestCoverage3y: 18, anyYearBelowNextBand: false, materialMultiYearDeterioration: false },
    revBeat: { latestBeatPct: 5, yoyGrowthNonDecelerating: true, positiveYoyGrowth: true, materialDeterioration: false },
    estimateRevisions: { consensusChangePct90d: 8, positiveBreadthPct: 80, net30dReversal: false },
  },
};
// Agent 2's rule tables read a different vocabulary from Agent 1's: multi-quarter beat
// history, growth/EPS persistence counts, and a 60-day revision horizon.
fullEvidence["agent-2"] = {
  revBeat: { beatsInLatestThree: 3, minimumBeatPct: 4, latestBeatPct: 6, missesInLatestThree: 0 },
  revGrowth: { currentGrowthPct: 30, positiveQuartersInLatestFour: 4, positiveMultiQuarterPersistence: true, nonDecelerating: true, consecutiveMaterialDecelerations: 0 },
  epsTrajectory: { epsGrowthPct: 30, consecutiveQualifyingQuarters: 4, nonDecelerating: true, consecutiveDeterioratingQuarters: 0 },
  estimateRevisions: { consensusChangePct60d: 8, positiveBreadthPct: 80, net30dReversal: false },
  marginTrend: fullEvidence["agent-1"].marginTrend,
  balanceSheet: fullEvidence["agent-1"].balanceSheet,
};

const score = (agentId, absoluteEvidence) => scoreMandateCandidate({
  agentId,
  absoluteEvidence,
  valuationEvidence: { value: 12 },
  metricVector: {},
  peerDistributions: {},
});

test("every agent's point table still sums to 100", () => {
  for (const [agentId, config] of Object.entries(AGENT_SCORING)) {
    const total = Object.values(config.categories)
      .flatMap((c) => Object.values(c.metrics))
      .reduce((sum, spec) => sum + spec.points, 0);
    assert.equal(total, 100, agentId);
  }
});

test("agents 1 and 2 reach the full 100-point ceiling from the seven surviving metrics", () => {
  for (const agentId of ["agent-1", "agent-2"]) {
    const result = score(agentId, fullEvidence[agentId]);
    assert.equal(result.maxAvailable, 100, `${agentId} maxAvailable`);
    assert.deepEqual(result.missingMetrics, [], `${agentId} missing`);
    assert.equal(result.actionable, true, agentId);
  }
});

test("agent 3 reaches the full 100-point ceiling", () => {
  const result = score("agent-3", fullEvidence["agent-3"]);
  assert.equal(result.maxAvailable, 100);
  assert.deepEqual(result.missingMetrics, []);
  assert.equal(result.actionable, true);
});

test("dropping one metric degrades coverage without zeroing the score", () => {
  // The rescale-not-zero invariant, previously pinned via the 13F pair. A single absent
  // metric must lower maxAvailable by exactly its own weight and leave the rest intact.
  const { marginTrend, ...withoutMargin } = fullEvidence["agent-1"];
  const weight = AGENT_SCORING["agent-1"].categories.C.metrics.marginTrend.points;
  const result = score("agent-1", withoutMargin);
  assert.equal(result.maxAvailable, 100 - weight);
  assert.equal(result.actionable, true, "still clears the 80-point bar");
  assert.deepEqual(result.missingMetrics, ["marginTrend"]);
  // Rescaled out, not scored zero: a perfect candidate still scores 100 on what IS known.
  assert.equal(result.uncappedTotal, 100);
  // `total` is lower because these fixtures carry no peer distributions, so every metric
  // routes absolute-only — a thin peer set, which caps conviction independently of
  // coverage. That cap is a separate mechanism from the rescale being asserted here.
  assert.equal(result.thinPeerSet, true);
  assert.ok(result.total < result.uncappedTotal);
});

test("retired Category D cannot contribute points even if its evidence is supplied", () => {
  // lib/thirteen-f.js still derives this evidence and is still tested, so a caller can
  // physically hand it over. Until the category is deliberately restored it must be
  // inert: no points, no ceiling change, no entry in the per-metric breakdown.
  const withRetired = {
    ...fullEvidence["agent-1"],
    instOwnershipDir: { ownershipChangePoints: 6, clearMultiQuarterAccumulation: true },
    thirteenF: { usableQuarters: 2, latestQuarterChangePct: 8, priorQuarterChangePct: 5, cumulativeTwoQuarterChangePct: 13 },
  };
  const result = score("agent-1", withRetired);
  assert.equal(result.maxAvailable, 100, "ceiling unchanged by retired evidence");
  assert.equal(result.rawPoints, score("agent-1", fullEvidence["agent-1"]).rawPoints);
  for (const retired of ["instOwnershipDir", "thirteenF"]) {
    assert.equal(retired in result.perMetric, false, `${retired} must not be scored`);
    assert.equal(result.missingMetrics.includes(retired), false, `${retired} is not "missing", it is gone`);
  }
});

test("KNOWN GAP: agent 2's persistence inputs are still not derived anywhere", () => {
  // Agent 2 reaches 100 above only because the fixture hands it multi-quarter beat
  // history and growth/EPS persistence counts. lib/mandate-evidence.js explicitly sets
  // those to null — it will not infer four-quarter persistence from one scalar — and
  // nothing else derives them, so in production Agent 2's revBeat, revGrowth and
  // epsTrajectory go missing on any name strong enough to reach their top bands.
  // This test pins that gap so it cannot be mistaken for solved.
  //
  // Retiring Category D made this gap WIDER, not narrower: those 15 points were
  // redistributed across A/B/C, and three of the metrics that grew are exactly the ones
  // nothing derives. The expectation is computed from the live table so a future
  // reweight updates it here instead of silently drifting.
  const asProduced = {
    ...fullEvidence["agent-2"],
    revBeat: { latestBeatPct: 6 },
    revGrowth: { currentGrowthPct: 30, positiveQuartersInLatestFour: null, positiveMultiQuarterPersistence: null, nonDecelerating: true, consecutiveMaterialDecelerations: null },
    epsTrajectory: { epsGrowthPct: 30, consecutiveQualifyingQuarters: null, nonDecelerating: true, consecutiveDeterioratingQuarters: null },
  };
  const { A, B } = AGENT_SCORING["agent-2"].categories;
  const underivable = A.metrics.revBeat.points + A.metrics.revGrowth.points + B.metrics.epsTrajectory.points;
  const result = score("agent-2", asProduced);
  assert.deepEqual(result.missingMetrics.sort(), ["epsTrajectory", "revBeat", "revGrowth"]);
  assert.equal(result.maxAvailable, 100 - underivable);
  assert.equal(result.actionable, false, "below the 80-point bar until persistence is derived");
});

test("dropping consensus drops agent 3 below the actionability bar rather than guessing", () => {
  const { revBeat, estimateRevisions, ...withoutConsensus } = fullEvidence["agent-3"];
  const { A, B } = AGENT_SCORING["agent-3"].categories;
  const consensusWeight = A.metrics.revBeat.points + B.metrics.estimateRevisions.points;
  const result = score("agent-3", withoutConsensus);
  assert.equal(result.maxAvailable, 100 - consensusWeight);
  assert.equal(result.actionable, false);
  assert.equal(result.noTradeReason, "insufficient_available_points");
});
