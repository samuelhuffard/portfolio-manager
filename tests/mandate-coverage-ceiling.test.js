import test from "node:test";
import assert from "node:assert/strict";
import { scoreMandateCandidate } from "../lib/mandate-score.js";
import { AGENT_SCORING } from "../config/scoring/mandate-v2.js";

/**
 * The point of the 13F + Agent-3 work: `maxAvailable` is what gates actionability
 * (>= 80 of 100), and before this every agent was capped below its own ceiling —
 * Agents 1 and 2 at 85 with ownership unbound, Agent 3 at 10.
 *
 * These tests assert the CEILING, not a score. They feed each metric evidence good
 * enough to land in some band and check how many points the scorer is willing to put on
 * the table. A metric that reports `missing` contributes nothing to maxAvailable, which
 * is exactly the mechanism that held the old ceilings down.
 */

const fullEvidence = {
  "agent-1": {
    revGrowth: { currentGrowthPct: 30, accelerationPoints: 8 },
    epsTrajectory: { epsGrowthPct: 30, accelerationPoints: 8 },
    marginTrend: { marginChangeBps: 250, documentedInvestmentExplanation: false },
    balanceSheet: { isProfitable: true, isPreProfit: false, netCash: true, netDebtEbitda: 0.4, interestCoverage: 20, cashRunwayQuarters: 999 },
    revBeat: { beatPct: 7 },
    estimateRevisions: { consensusChangePct: 8, consensusChangePct90d: 8, positiveBreadthPct: 80, positiveNegativeRatio: 4, net30dReversal: false },
    instOwnershipDir: { ownershipChangePoints: 6, clearMultiQuarterAccumulation: true },
    thirteenF: { usableQuarters: 2, latestQuarterChangePct: 8, priorQuarterChangePct: 5, cumulativeTwoQuarterChangePct: 13 },
  },
  "agent-3": {
    revGrowth: { revenueCagr3yPct: 22, positiveGrowthYears: 3, minimumAnnualGrowthPct: 18, maxAnnualGrowthSpreadPoints: 6, volatileYears: 0, negativeGrowthYears: 0, materiallyErraticGrowth: false },
    epsTrajectory: { normalizedEpsCagr3yPct: 20, positiveEpsYears: 3, worstAnnualDeclinePct: 0, positiveCumulativeTrajectory: true, persistentTwoYearDecline: false, persistentDeterioration: false },
    marginTrend: { marginChangeBps3y: 300, twoYearContractionSequence: false, documentedStructuralInvestmentExplanation: false },
    balanceSheet: { latestNetDebtEbitda: 0.4, medianNetDebtEbitda3y: 0.5, latestInterestCoverage: 20, medianInterestCoverage3y: 18, anyYearBelowNextBand: false, materialMultiYearDeterioration: false },
    revBeat: { latestBeatPct: 5, yoyGrowthNonDecelerating: true, positiveYoyGrowth: true, materialDeterioration: false },
    estimateRevisions: { consensusChangePct90d: 8, positiveBreadthPct: 80, net30dReversal: false },
    instOwnershipDir: { ownershipChangePoints: 6, clearMultiQuarterAccumulation: true },
    thirteenF: { usableQuarters: 2, latestQuarterChangePct: 8, priorQuarterChangePct: 5, cumulativeTwoQuarterChangePct: 13 },
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
  instOwnershipDir: fullEvidence["agent-1"].instOwnershipDir,
  thirteenF: fullEvidence["agent-1"].thirteenF,
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

test("agents 1 and 2 reach the full 100-point ceiling once ownership is bound", () => {
  for (const agentId of ["agent-1", "agent-2"]) {
    const result = score(agentId, fullEvidence[agentId]);
    assert.equal(result.maxAvailable, 100, `${agentId} maxAvailable`);
    assert.deepEqual(result.missingMetrics, [], `${agentId} missing`);
    assert.equal(result.actionable, true, agentId);
  }
});

test("agent 3 reaches the full 100-point ceiling — up from 10", () => {
  const result = score("agent-3", fullEvidence["agent-3"]);
  assert.equal(result.maxAvailable, 100);
  assert.deepEqual(result.missingMetrics, []);
  assert.equal(result.actionable, true);
});

test("dropping 13F leaves 85 available — degraded, still actionable, never zeroed", () => {
  // Q-004 as revised: required for FULL coverage, but absence must degrade rather than
  // block. A ~45-day-delayed dataset must never hold a veto over a candidate.
  const { instOwnershipDir, thirteenF, ...withoutOwnership } = fullEvidence["agent-1"];
  const result = score("agent-1", withoutOwnership);
  assert.equal(result.maxAvailable, 85);
  assert.equal(result.actionable, true, "still clears the 80-point bar");
  assert.deepEqual(result.missingMetrics.sort(), ["instOwnershipDir", "thirteenF"]);
  // Rescaled out, not scored zero: a perfect candidate still scores 100 on what IS known.
  assert.equal(result.uncappedTotal, 100);
  // `total` is lower because these fixtures carry no peer distributions, so every metric
  // routes absolute-only — a thin peer set, which caps conviction independently of
  // coverage. That cap is a separate mechanism from the rescale being asserted here.
  assert.equal(result.thinPeerSet, true);
  assert.ok(result.total < result.uncappedTotal);
});

test("Agent 2 remains fail-closed when a persisted bundle lacks its required histories", () => {
  // A legacy/partial bundle with no EDGAR quarter series still cannot be treated as
  // evidence. The Agent 2 adapter now derives only sourced revenue YoY continuity;
  // consensus-dependent three-quarter beats and adjusted-EPS persistence remain
  // deliberately unbound until their separate policy/source requirements are met.
  const asProduced = {
    ...fullEvidence["agent-2"],
    revBeat: { latestBeatPct: 6 },
    revGrowth: { currentGrowthPct: 30, positiveQuartersInLatestFour: null, positiveMultiQuarterPersistence: null, nonDecelerating: true, consecutiveMaterialDecelerations: null },
    epsTrajectory: { epsGrowthPct: 30, consecutiveQualifyingQuarters: null, nonDecelerating: true, consecutiveDeterioratingQuarters: null },
  };
  const result = score("agent-2", asProduced);
  assert.deepEqual(result.missingMetrics.sort(), ["epsTrajectory", "revBeat", "revGrowth"]);
  assert.equal(result.maxAvailable, 59);
  assert.equal(result.actionable, false, "below the 80-point bar until persistence is derived");
});

test("dropping consensus drops agent 3 below the actionability bar rather than guessing", () => {
  const { revBeat, estimateRevisions, ...withoutConsensus } = fullEvidence["agent-3"];
  const result = score("agent-3", withoutConsensus);
  assert.equal(result.maxAvailable, 77);
  assert.equal(result.actionable, false);
  assert.equal(result.noTradeReason, "insufficient_available_points");
});
