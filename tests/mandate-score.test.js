import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreMandateCandidate } from "../lib/mandate-score.js";

const AGENT_ONE_FULL = {
  revBeat: { beatPct: 5 },
  revGrowth: { currentGrowthPct: 20, accelerationPoints: 5 },
  epsTrajectory: { epsGrowthPct: 20, accelerationPoints: 5 },
  estimateRevisions: { consensusChangePct: 5, positiveNegativeRatio: 2, positiveBreadthPct: 70 },
  marginTrend: { marginChangeBps: 200, documentedInvestmentExplanation: false },
  balanceSheet: { isProfitable: true, isPreProfit: false, netCash: true, netDebtEbitda: 0, interestCoverage: 9 },
  instOwnershipDir: { ownershipChangePoints: 5, clearMultiQuarterAccumulation: false },
  thirteenF: { usableQuarters: 2, latestQuarterChangePct: 3, priorQuarterChangePct: 2, cumulativeTwoQuarterChangePct: 5 },
};

const metricVector = Object.fromEntries(["revBeat", "revGrowth", "epsTrajectory", "estimateRevisions", "marginTrend", "balanceSheet", "instOwnershipDir", "thirteenF"].map((key) => [key, 100]));
metricVector.peerValuation = 10;

const distributions = (n) => Object.fromEntries(Object.keys(metricVector).map((key) => [key, Array.from({ length: n }, (_, i) => key === "peerValuation" ? 20 + i : i)]));

test("absolute-only candidate aggregates to 100 then receives the thin-peer 84 cap", () => {
  const result = scoreMandateCandidate({
    agentId: "agent-1",
    metricVector,
    peerDistributions: distributions(0),
    absoluteEvidence: AGENT_ONE_FULL,
    valuationEvidence: { value: 15 },
    peerSetUsed: { level: "industry", key: "Software" },
  });
  assert.equal(result.uncappedTotal, 100);
  assert.equal(result.total, 84);
  assert.equal(result.fallbackMethod, "absolute");
  assert.equal(result.thinPeerSet, true);
  assert.equal(result.complete, true);
  assert.deepEqual(result.peerSetUsed, { level: "industry", key: "Software" });
});

test("six-peer candidate uses blended scoring and remains capped", () => {
  const result = scoreMandateCandidate({
    agentId: "agent-1",
    metricVector,
    peerDistributions: distributions(6),
    absoluteEvidence: AGENT_ONE_FULL,
    valuationEvidence: { value: 15 },
  });
  assert.equal(result.uncappedTotal, 100);
  assert.equal(result.total, 84);
  assert.equal(result.fallbackMethod, "blended_50_50");
  assert.equal(result.perMetric.revGrowth.fallbackMethod, "blended_50_50");
});

test("eight-peer candidate stays peer-relative and is not capped", () => {
  const result = scoreMandateCandidate({
    agentId: "agent-1",
    metricVector,
    peerDistributions: distributions(8),
    absoluteEvidence: {},
  });
  assert.equal(result.total, 100);
  assert.equal(result.fallbackMethod, "peer_relative");
  assert.equal(result.thinPeerSet, false);
  assert.equal(result.complete, true);
});

test("missing absolute evidence is explicit and rescaled, never scored zero", () => {
  const evidence = { ...AGENT_ONE_FULL };
  delete evidence.estimateRevisions;
  const result = scoreMandateCandidate({
    agentId: "agent-1",
    metricVector,
    peerDistributions: distributions(0),
    absoluteEvidence: evidence,
    valuationEvidence: { value: 15 },
  });
  assert.equal(result.complete, false);
  assert.equal(result.scoringBasis, "rescaled_available_fields");
  assert.ok(result.missingMetrics.includes("estimateRevisions"));
  assert.equal(result.perMetric.estimateRevisions.points, null);
});

test("special-sector provenance lists every substituted bank metric", () => {
  const bankEvidence = {
    ...AGENT_ONE_FULL,
    revGrowth: { bankRevenueGrowthPct: 10 },
    epsTrajectory: { adjustedEpsOrTbvpsGrowthPct: 12 },
    marginTrend: { netInterestMarginChangeBps: 20 },
    balanceSheet: { cet1Pct: 12, creditQualityStableOrImproving: true, materialCreditDeterioration: false },
  };
  const result = scoreMandateCandidate({
    agentId: "agent-1",
    metricVector,
    peerDistributions: distributions(0),
    absoluteEvidence: bankEvidence,
    valuationEvidence: { value: 1.2, absoluteSource: "banks_absolute", absoluteSpec: { higherIsBetter: false, bands: [{ threshold: 1.2, fraction: 1 }] } },
    sector: "banks",
  });
  assert.deepEqual(result.sectorSubstitutionsUsed.sort(), ["balanceSheet", "epsTrajectory", "marginTrend", "peerValuation", "revGrowth"]);
  assert.equal(result.perMetric.revGrowth.absolute.source, "banks_absolute");
  assert.equal(result.actionable, true);
});

test("missing critical special-sector evidence is explicitly NO_TRADE", () => {
  const result = scoreMandateCandidate({
    agentId: "agent-3",
    metricVector,
    peerDistributions: distributions(0),
    absoluteEvidence: AGENT_ONE_FULL,
    valuationEvidence: { value: 1.2 },
    sector: "banks",
  });
  assert.equal(result.actionable, false);
  assert.equal(result.noTradeReason, "missing_critical_special_sector_data");
  assert.ok(result.criticalMissingMetrics.includes("revGrowth"));
});

test("unknown agents fail closed", () => {
  assert.throws(() => scoreMandateCandidate({ agentId: "agent-9" }), /Unknown mandate agent/);
});
