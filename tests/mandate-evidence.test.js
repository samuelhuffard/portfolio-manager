import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assembleMandateInputs,
  BOUND_METRICS,
  BOUND_METRICS_BY_AGENT,
  UNBOUND_METRICS,
} from "../lib/mandate-evidence.js";
import { scoreCohortForAgent } from "../jobs/mandate-scoring.js";

// A representative EDGAR `_derived` bundle (fractions, as lib/edgar-metrics.js emits).
const derived = {
  revYoY: 0.22, // 22% YoY
  revAccel: 0.06, // +6pp acceleration
  epsYoY: 0.25,
  epsAccel: 0.04,
  grossMarginTrendYoY: 0.025, // +2.5pp = 250bps
  interestCoverage: 12,
  cashRunwayQuarters: 999,
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
  assert.equal(out.metricVector.balanceSheet, null);
  assert.equal(out.absoluteEvidence.balanceSheet, undefined);
  assert.equal(UNBOUND_METRICS.includes("balanceSheet"), true);
});

test("Q-001 masks numeric legacy balance-sheet and derived interest coverage inputs", () => {
  const out = assembleMandateInputs({ agentId: "agent-1", metrics, derived, sector: null });
  assert.equal(out.metricVector.balanceSheet, null);
  assert.equal(out.absoluteEvidence.balanceSheet, undefined);
  assert.equal(out.boundMetrics.includes("balanceSheet"), false);
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
