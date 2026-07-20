import test from "node:test";
import assert from "node:assert/strict";

import {
  buildLiveHoldingMandateEvidence,
  canQueueHoldingPolicyExit,
  holdingMarketSeriesIsFresh,
  holdingPolicyExitAmount,
} from "../lib/holding-mandate-evidence.js";
import { evaluateMandateHolding } from "../lib/mandate-policy.js";

const AS_OF = "2026-07-20T21:00:00.000Z";

function bars({ count = 260, start = 400, step = -1 } = {}) {
  const first = Date.parse(AS_OF) - (count - 1) * 86_400_000;
  return Array.from({ length: count }, (_, index) => {
    const close = start + step * index;
    return {
      date: new Date(first + index * 86_400_000),
      open: close + 1,
      high: close + 2,
      low: close - 2,
      close,
      volume: 1_000_000,
    };
  });
}

function input(agentId, overrides = {}) {
  return {
    agentId,
    position: {
      agentId,
      ticker: "SAME",
      shares: 2,
      marketValue: 300,
      returnPct: -10,
      firstOpenAt: "2026-01-02T21:00:00.000Z",
    },
    bars: bars(),
    benchmarkBars: bars({ start: 100, step: 0 }),
    fundamentals: {
      sector: "Technology",
      nextEarningsDate: "2026-08-01",
      raw: { financialData: {} },
    },
    earningsSurprise: {
      periodEnd: "2026-06-30T20:00:00.000Z",
      epsSurprisePct: -8,
    },
    portfolioValue: 1_000,
    portfolioValueAsOf: AS_OF.slice(0, 10),
    asOf: AS_OF,
    ...overrides,
  };
}

test("all three owners use one evidence contract while their mandate rules remain distinct", () => {
  const oneEvidence = buildLiveHoldingMandateEvidence(input("agent-1"));
  const twoEvidence = buildLiveHoldingMandateEvidence(input("agent-2"));
  const threeEvidence = buildLiveHoldingMandateEvidence(input("agent-3"));

  const one = evaluateMandateHolding({ agentId: "agent-1", evidence: oneEvidence, asOf: AS_OF });
  const two = evaluateMandateHolding({ agentId: "agent-2", evidence: twoEvidence, asOf: AS_OF });
  const three = evaluateMandateHolding({ agentId: "agent-3", evidence: threeEvidence, asOf: AS_OF });

  assert.equal(one.action, "SELL_FULL");
  assert.ok(one.reasonCodes.includes("atr_2_5_exit_ladder"));
  assert.equal(two.action, "SELL_FULL");
  assert.ok(two.reasonCodes.includes("confirmed_50_200_day_trend_break"));
  assert.equal(three.action, "SELL_PARTIAL");
  assert.ok(three.reasonCodes.includes("position_drift_above_25_pct"));
  assert.deepEqual([one.phase, two.phase, three.phase], ["holding", "holding", "holding"]);
  assert.deepEqual([one.policyVersion, two.policyVersion, three.policyVersion], [
    one.policyVersion, one.policyVersion, one.policyVersion,
  ]);
});

test("unsupported mandate facts remain explicit and fail closed to review", () => {
  const evidence = buildLiveHoldingMandateEvidence(input("agent-3", {
    position: {
      agentId: "agent-3",
      ticker: "SAME",
      shares: 0.5,
      marketValue: 100,
      returnPct: 5,
      firstOpenAt: null,
    },
  }));
  assert.equal(evidence.structuralFullExitTrigger.state, "unavailable");
  assert.equal(evidence.businessEvidenceScoreExValuation.state, "unavailable");
  assert.equal(evidence.valuationHistoricalPercentile.state, "unavailable");
  const result = evaluateMandateHolding({ agentId: "agent-3", evidence, asOf: AS_OF });
  assert.equal(result.coverageComplete, false);
  assert.equal(result.action, "REVIEW_REQUIRED");
  assert.ok(result.blockers.some((entry) =>
    entry.code === "evidence_not_actionable:structuralFullExitTrigger:unavailable"
  ));
});

test("stale or absent market series cannot fire an automatic holding exit", () => {
  const staleBars = bars().map((bar) => ({
    ...bar,
    date: new Date(bar.date.getTime() - 30 * 86_400_000),
  }));
  const staleEvidence = buildLiveHoldingMandateEvidence(input("agent-2", {
    bars: staleBars,
    benchmarkBars: staleBars.map((bar) => ({ ...bar, close: 100 })),
  }));
  assert.equal(staleEvidence.consecutiveClosesBelow50Day.state, "stale");
  const stale = evaluateMandateHolding({ agentId: "agent-2", evidence: staleEvidence, asOf: AS_OF });
  assert.equal(stale.action, "REVIEW_REQUIRED");

  const absentEvidence = buildLiveHoldingMandateEvidence(input("agent-1", {
    bars: [],
    benchmarkBars: [],
  }));
  assert.equal(absentEvidence.lastCompletedSessionAt.state, "unavailable");
  const absent = evaluateMandateHolding({ agentId: "agent-1", evidence: absentEvidence, asOf: AS_OF });
  assert.equal(absent.action, "REVIEW_REQUIRED");
});

test("owner-attributed partial exits use mandate-specific sizing", () => {
  const agentTwo = {
    action: "SELL_PARTIAL",
    agentId: "agent-2",
    reasonCodes: ["confirmed_50_day_relative_strength_break"],
  };
  const agentThree = {
    action: "SELL_PARTIAL",
    agentId: "agent-3",
    reasonCodes: ["position_drift_above_25_pct"],
  };
  assert.equal(
    holdingPolicyExitAmount({ evaluation: agentTwo, position: { marketValue: 300 }, portfolioValue: 1_000 }),
    150
  );
  assert.equal(
    holdingPolicyExitAmount({ evaluation: agentThree, position: { marketValue: 300 }, portfolioValue: 1_000 }),
    100
  );
  assert.equal(
    holdingPolicyExitAmount({
      evaluation: { action: "REVIEW_REQUIRED", agentId: "agent-1", reasonCodes: [] },
      position: { marketValue: 300 },
      portfolioValue: 1_000,
    }),
    null
  );
});

test("an exit trigger cannot queue while the common evidence contract is incomplete", () => {
  assert.equal(canQueueHoldingPolicyExit({ action: "SELL_FULL", coverageComplete: false }), false);
  assert.equal(canQueueHoldingPolicyExit({ action: "SELL_PARTIAL", coverageComplete: false }), false);
  assert.equal(canQueueHoldingPolicyExit({ action: "REVIEW_REQUIRED", coverageComplete: true }), false);
  assert.equal(canQueueHoldingPolicyExit({ action: "SELL_FULL", coverageComplete: true }), true);
});

test("market-series freshness rejects missing, future, and old bars", () => {
  assert.equal(holdingMarketSeriesIsFresh([], AS_OF), false);
  assert.equal(holdingMarketSeriesIsFresh([{ date: "2026-07-20T20:00:00.000Z" }], AS_OF), true);
  assert.equal(holdingMarketSeriesIsFresh([{ date: "2026-07-21T20:00:00.000Z" }], AS_OF), false);
  assert.equal(holdingMarketSeriesIsFresh([{ date: "2026-07-10T20:00:00.000Z" }], AS_OF), false);
});
