import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assembleMandateInputs,
  BOUND_METRICS,
  BOUND_METRICS_BY_AGENT,
  UNBOUND_METRICS,
} from "../lib/mandate-evidence.js";
import { scoreCohortForAgent } from "../jobs/mandate-scoring.js";
import { scoreMandateCandidate } from "../lib/mandate-score.js";

// A representative EDGAR `_derived` bundle (fractions, as lib/edgar-metrics.js emits).
const derived = {
  revYoY: 0.22, // 22% YoY
  revAccel: 0.06, // +6pp acceleration
  epsYoY: 0.25,
  epsAccel: 0.04,
  grossMarginTrendYoY: 0.025, // +2.5pp = 250bps
  interestCoverage: 12,
  cashRunwayQuarters: 999,
  // Q-001 balance-sheet economics (owner sign-off 2026-08-01, pending partner review).
  ttmOperatingIncome: 5_000_000_000,
  isProfitable: true,
  ebitda: 6_000_000_000,
  totalDebt: 1_000_000_000,
  netCash: true,
  netDebtEbitda: 0.5,
  _asOf: "2026-03-31",
};
const metrics = { revGrowth: 0.22, epsTrajectory: 0.25, marginTrend: 0.025, balanceSheet: 12, peerValuation: 14 };

test("assembler binds the EDGAR-derivable inputs with correct units", () => {
  const out = assembleMandateInputs({ agentId: "agent-1", metrics, derived, sector: null });
  assert.equal(out.supported, true);
  assert.equal(out.absoluteEvidence.revGrowth.currentGrowthPct, 22);
  assert.equal(out.absoluteEvidence.revGrowth.accelerationPoints, 6);
  assert.equal(out.absoluteEvidence.epsTrajectory.epsGrowthPct, 25);
  assert.equal(out.absoluteEvidence.marginTrend.marginChangeBps, 250);
  assert.equal(out.absoluteEvidence.marginTrend.documentedInvestmentExplanation, false);
  assert.equal(out.valuationEvidence.value, 14);
  assert.deepEqual(out.boundMetrics.sort(), [...BOUND_METRICS].sort());
  assert.equal(UNBOUND_METRICS.includes("balanceSheet"), false);
});

test("Q-001 accepted: balance sheet binds the approved named inputs", () => {
  const out = assembleMandateInputs({ agentId: "agent-1", metrics, derived, sector: null });
  assert.equal(out.absoluteEvidence.balanceSheet.isProfitable, true);
  assert.equal(out.absoluteEvidence.balanceSheet.isPreProfit, false);
  assert.equal(out.absoluteEvidence.balanceSheet.netCash, true);
  assert.equal(out.absoluteEvidence.balanceSheet.netDebtEbitda, 0.5);
  assert.equal(out.absoluteEvidence.balanceSheet.interestCoverage, 12);
  assert.equal(out.metricVector.balanceSheet, 12);
  assert.equal(out.boundMetrics.includes("balanceSheet"), true);
});

test("balance sheet still fails closed when profitability cannot be established", () => {
  // A bundle predating the Q-001 derivations (no isProfitable) must not score from
  // the legacy interest-coverage number alone.
  const { isProfitable, netCash, netDebtEbitda, ...legacy } = derived;
  const out = assembleMandateInputs({ agentId: "agent-1", metrics, derived: legacy, sector: null });
  assert.equal(out.absoluteEvidence.balanceSheet, undefined);
  assert.equal(out.metricVector.balanceSheet, null);
  assert.equal(out.boundMetrics.includes("balanceSheet"), false);
});

test("consensus binds revBeat and estimateRevisions when history clears the activation gate", () => {
  const snap = { revenueAvg: 1_000_000, epsAvg: 2.2, vendorEpsRevisions: { up30: 8, down30: 2 } };
  const history = [
    { retrievedAt: "2026-06-25T00:00:00Z", epsAvg: 2.0, vendorEpsRevisions: {} },
    { retrievedAt: "2026-07-10T00:00:00Z", epsAvg: 2.1, vendorEpsRevisions: {} },
    { retrievedAt: "2026-07-31T00:00:00Z", epsAvg: 2.2, vendorEpsRevisions: { up30: 8, down30: 2 } },
  ];
  const out = assembleMandateInputs({
    agentId: "agent-1",
    metrics,
    derived,
    sector: null,
    consensus: { snapshot: snap, history, actualRevenue: 1_100_000 },
  });
  assert.equal(out.absoluteEvidence.revBeat.beatPct, 10);
  assert.equal(out.absoluteEvidence.estimateRevisions.consensusChangePct, 10);
  assert.equal(out.absoluteEvidence.estimateRevisions.positiveRevisionBreadth, 0.8);
  assert.ok(out.boundMetrics.includes("revBeat"));
  assert.ok(out.boundMetrics.includes("estimateRevisions"));
});

test("no consensus supplied leaves revBeat and estimateRevisions exactly as before", () => {
  const out = assembleMandateInputs({ agentId: "agent-1", metrics, derived, sector: null });
  assert.equal(out.absoluteEvidence.revBeat, undefined);
  assert.equal(out.absoluteEvidence.estimateRevisions, undefined);
  assert.equal(out.boundMetrics.includes("revBeat"), false);
});

test("missing acceleration (too few quarters) leaves the field null, not zero", () => {
  const out = assembleMandateInputs({ agentId: "agent-1", metrics, derived: { ...derived, revAccel: null }, sector: null });
  assert.equal(out.absoluteEvidence.revGrowth.currentGrowthPct, 22);
  assert.equal(out.absoluteEvidence.revGrowth.accelerationPoints, null);
});

test("special sectors and unknown mandates fail closed while Agent 2/3 adapters stay honest and partial", () => {
  assert.equal(assembleMandateInputs({ agentId: "agent-1", metrics, derived, sector: "banks" }).supported, false);
  const medium = assembleMandateInputs({ agentId: "agent-2", metrics, derived, sector: null });
  assert.equal(medium.supported, true);
  assert.equal(medium.absoluteEvidence.revGrowth.currentGrowthPct, 22);
  assert.equal(medium.absoluteEvidence.revGrowth.positiveQuartersInLatestFour, null);
  assert.deepEqual(medium.boundMetrics.sort(), [...BOUND_METRICS_BY_AGENT["agent-2"]].sort());
  const long = assembleMandateInputs({ agentId: "agent-3", metrics, derived, sector: null });
  assert.equal(long.supported, true);
  assert.equal(long.metricVector.revGrowth, null);
  assert.equal(long.metricVector.peerValuation, 14);
  assert.deepEqual(long.boundMetrics, ["peerValuation"]);
  assert.equal(assembleMandateInputs({ agentId: "agent-9", metrics, derived, sector: null }).supported, false);
  assert.equal(assembleMandateInputs({ agentId: "agent-1", metrics, derived: null, sector: null }).supported, false);
});

test("Agent 2 binds only unambiguous contiguous EDGAR revenue history", () => {
  const quarters = [
    ["2024-03-31", 100], ["2024-06-30", 100], ["2024-09-30", 100], ["2024-12-31", 100],
    ["2025-03-31", 110], ["2025-06-30", 120], ["2025-09-30", 130], ["2025-12-31", 140],
  ].map(([end, val]) => ({ end, val, filed: end }));
  const out = assembleMandateInputs({
    agentId: "agent-2",
    metrics,
    derived: { ...derived, _revenueQuarterSeries: quarters },
    sector: null,
  });
  assert.equal(out.absoluteEvidence.revGrowth.positiveQuartersInLatestFour, 4);
  assert.equal(out.absoluteEvidence.revGrowth.nonDecelerating, true);
  assert.equal(out.absoluteEvidence.revGrowth.positiveMultiQuarterPersistence, null);
  assert.equal(out.absoluteEvidence.revGrowth.consecutiveMaterialDecelerations, null);
  assert.equal(out.absoluteEvidence.epsTrajectory.consecutiveQualifyingQuarters, null, "GAAP EPS is not substituted for adjusted EPS");
  const score = scoreMandateCandidate({
    agentId: "agent-2",
    metricVector: out.metricVector,
    absoluteEvidence: out.absoluteEvidence,
    valuationEvidence: out.valuationEvidence,
    peerDistributions: {},
  });
  const withoutHistory = assembleMandateInputs({ agentId: "agent-2", metrics, derived, sector: null });
  const baselineScore = scoreMandateCandidate({
    agentId: "agent-2",
    metricVector: withoutHistory.metricVector,
    absoluteEvidence: withoutHistory.absoluteEvidence,
    valuationEvidence: withoutHistory.valuationEvidence,
    peerDistributions: {},
  });
  assert.equal(score.perMetric.revGrowth.missing, false);
  assert.equal(score.maxAvailable - baselineScore.maxAvailable, 17, "only the 17-point revenue-history gap is closed; undefined terms stay unavailable");
  assert.equal(score.actionable, false);
});

test("valuation evidence is still offered when the EDGAR bundle is absent", () => {
  const out = assembleMandateInputs({ agentId: "agent-1", metrics, derived: null, sector: null });
  assert.equal(out.supported, false); // no derived → not scored
  assert.equal(out.valuationEvidence.value, 14); // but the multiple survives for a future path
});

test("cohort scoring ranks data-bearing names and skips unsupported ones", () => {
  const strong = { ticker: "AAA", industry: "Software", sector: "Technology", metrics, derived };
  const weak = { ticker: "BBB", industry: "Software", sector: "Technology", metrics: { ...metrics, revGrowth: 0.04, peerValuation: 40 }, derived: { ...derived, revYoY: 0.04, revAccel: -0.05, epsYoY: -0.1, epsAccel: -0.08 } };
  const foreign = { ticker: "CCC", industry: "Banks", sector: "Financials", metrics, derived: null }; // no derived → unsupported
  const { scores, skipped } = scoreCohortForAgent("agent-1", [strong, weak, foreign]);
  assert.equal(skipped, 1); // CCC skipped
  assert.equal(scores.length, 2);
  assert.equal(scores[0].ticker, "AAA"); // stronger fundamentals rank first
  assert.ok(scores[0].total >= scores[1].total);
  assert.equal(scores[0].complete, false); // partial binding (deferred metrics null) — honest
  assert.equal(typeof scores[0].rawPoints, "number");
  assert.equal(typeof scores[0].maxAvailable, "number");
  assert.equal(scores[0].actionable, false); // below the canonical 80-point floor
});
