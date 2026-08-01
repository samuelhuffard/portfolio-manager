import { test } from "node:test";
import assert from "node:assert/strict";
import { MANDATE_POLICIES } from "../config/agents/mandate-policy.js";
import {
  applyMandateScoreClamp,
  mandateGateEnabled,
  mandateGateSummary,
} from "../lib/mandate-proposal-clamp.js";

const AS_OF = "2026-07-20T21:00:00.000Z";

function record(value, { state = "fresh", source = "fixture", observedAt = AS_OF, retrievedAt = AS_OF } = {}) {
  return { value, state, source, observedAt, retrievedAt };
}

function scoreMetric(metricId, points, maxPoints) {
  return {
    metricId, value: points, unit: "score_points", points, maxPoints,
    source: "fixture", sourceDocumentId: "fixture-document", sourceFiledAt: AS_OF,
    sourceAsOf: AS_OF, retrievedAt: AS_OF, freshnessState: "fresh", peerCount: 12,
    calculationMethod: "fixture", thesisCritical: true, missingReason: null,
  };
}

function scoreObservation(agentId, total = 90, { maxAvailable = 100, actionable = true } = {}) {
  const rawPoints = (total / 100) * maxAvailable;
  return {
    id: `observation-${agentId}`, runId: "run-1", observedAt: AS_OF, agentId,
    mandateId: MANDATE_POLICIES[agentId]?.mandateId,
    mandateVersion: MANDATE_POLICIES[agentId]?.mandateVersion,
    mandateUniverseVersion: "eligible-us-operating-common-equities-v3",
    productionUniversePolicyVersion: "fixture-universe-v1",
    scoringConfigVersion: "mandate-v3-scoring-1+sha256:fixture",
    codeRevision: "fixture-revision", ticker: "AAA", universeSnapshotId: "universe-fixture",
    eligible: true, eligibilityReasonCodes: [], score: total, uncappedScore: total, rawPoints,
    maxAvailablePoints: maxAvailable, complete: maxAvailable === 100, actionable,
    coverageMask: ["earnings_quality", "growth"], missingMetrics: [], criticalMissingMetrics: [],
    fallbackMethod: "peer_relative", thinPeerSet: false, peerSetId: "peer-fixture",
    peerSetLevel: "industry", peerCount: 12, specialSectorKey: null, scoreCause: "filing",
    inputSnapshotId: "evidence-fixture",
    metrics: [scoreMetric("earnings_quality", rawPoints / 2, maxAvailable / 2), scoreMetric("growth", rawPoints / 2, maxAvailable / 2)],
  };
}

function agentOneEvidence(overrides = {}) {
  return {
    securityEligible: record(true),
    averageDollarVolume: record(20_000_000),
    balanceSheetEntryPass: record(true),
    companyDisclosureState: record("clear"),
    criticalCredibilityEvent: record(false),
    spyClose: record(600),
    spy200DayAverage: record(550),
    treasuryYieldChangeBps30TradingDays: record(20),
    marketCapitalization: record(2_000_000_000),
    currentPrice: record(110),
    price200DayAverage: record(100),
    entryRelativeVolume30Day: record(1.2),
    requestedWeightPct: record(15),
    projectedPositionWeightPct: record(15),
    projectedSectorWeightPct: record(75),
    projectedAttributedCashPct: record(10),
    ...overrides,
  };
}

const BUY = { action: "BUY", targetWeight: 15 };

test("gate is off unless MANDATE_SCORE_GATES_PROPOSALS is exactly 1", () => {
  assert.equal(mandateGateEnabled({}), false);
  assert.equal(mandateGateEnabled({ MANDATE_SCORE_GATES_PROPOSALS: "0" }), false);
  assert.equal(mandateGateEnabled({ MANDATE_SCORE_GATES_PROPOSALS: "true" }), false);
  assert.equal(mandateGateEnabled({ MANDATE_SCORE_GATES_PROPOSALS: " 1 " }), true);
});

test("disabled gate is a pure passthrough — live behavior is unchanged", () => {
  const result = applyMandateScoreClamp(BUY, { agentId: "agent-1", asOf: AS_OF, enabled: false });
  assert.deepEqual(result.rec, BUY);
  assert.equal(result.applied, false);
  assert.equal(result.gate, null);
});

test("a SELL is never gated, even with no score at all", () => {
  const sell = { action: "SELL", targetWeight: 0 };
  const result = applyMandateScoreClamp(sell, { agentId: "agent-1", asOf: AS_OF, enabled: true });
  assert.deepEqual(result.rec, sell);
  assert.equal(result.applied, false);
});

test("a HOLD passes through untouched", () => {
  const hold = { action: "HOLD", targetWeight: 0 };
  const result = applyMandateScoreClamp(hold, { agentId: "agent-1", asOf: AS_OF, enabled: true });
  assert.deepEqual(result.rec, hold);
  assert.equal(result.applied, false);
});

test("an enabled gate with no score observation fails closed to HOLD", () => {
  const result = applyMandateScoreClamp(BUY, { agentId: "agent-1", asOf: AS_OF, enabled: true });
  assert.equal(result.rec.action, "HOLD");
  assert.equal(result.rec.targetWeight, 0);
  assert.match(result.rec.overrideNotes[0], /no mandate score observation/);
  assert.equal(result.applied, true);
});

test("a non-actionable score (coverage below 80) downgrades the BUY to HOLD", () => {
  // This is exactly today's state: agent-1 can only bind 53 of 100 points.
  const result = applyMandateScoreClamp(BUY, {
    agentId: "agent-1",
    evidence: agentOneEvidence(),
    asOf: AS_OF,
    enabled: true,
    scoreObservation: scoreObservation("agent-1", 90, { maxAvailable: 53, actionable: false }),
  });
  assert.equal(result.rec.action, "HOLD");
  const notes = result.rec.overrideNotes.join(" ");
  assert.match(notes, /mandate_score_insufficient_coverage/);
  assert.match(notes, /mandate_score_not_actionable/);
});

test("a score below the agent's minimum entry score downgrades to HOLD", () => {
  const result = applyMandateScoreClamp(BUY, {
    agentId: "agent-1",
    evidence: agentOneEvidence(),
    asOf: AS_OF,
    enabled: true,
    scoreObservation: scoreObservation("agent-1", 40), // below the 45 floor
  });
  assert.equal(result.rec.action, "HOLD");
});

test("agent-3 rejects a 55 that agent-1 would accept — its floor is 65", () => {
  const observation = scoreObservation("agent-3", 55);
  const result = applyMandateScoreClamp(BUY, {
    agentId: "agent-3", evidence: agentOneEvidence(), asOf: AS_OF, enabled: true,
    scoreObservation: observation,
  });
  assert.equal(result.rec.action, "HOLD");
});

test("tier 1 permits the full 15% for agent-1 and leaves an in-band size alone", () => {
  const result = applyMandateScoreClamp(BUY, {
    agentId: "agent-1",
    evidence: agentOneEvidence(),
    asOf: AS_OF,
    enabled: true,
    scoreObservation: scoreObservation("agent-1", 90),
  });
  assert.equal(result.rec.action, "BUY");
  assert.equal(result.rec.targetWeight, 15);
  assert.equal(result.gate.tier.name, "tier_1");
  assert.match(result.rec.overrideNotes.join(" "), /tier_1/);
});

test("the clamp never RAISES a conservative request into the tier band", () => {
  // Tier 1 permits 10-15%; a 3% request must stay 3%, per the pipeline's
  // downgrade-only invariant.
  const small = { action: "BUY", targetWeight: 3 };
  const result = applyMandateScoreClamp(small, {
    agentId: "agent-1",
    evidence: agentOneEvidence({ requestedWeightPct: record(3), projectedPositionWeightPct: record(3) }),
    asOf: AS_OF,
    enabled: true,
    scoreObservation: scoreObservation("agent-1", 90),
  });
  assert.equal(result.rec.action, "BUY");
  assert.equal(result.rec.targetWeight, 3);
});

test("a request above the tier ceiling is blocked by the sizing policy", () => {
  const tooBig = { action: "BUY", targetWeight: 20 };
  const result = applyMandateScoreClamp(tooBig, {
    agentId: "agent-1",
    evidence: agentOneEvidence({ requestedWeightPct: record(20), projectedPositionWeightPct: record(20) }),
    asOf: AS_OF,
    enabled: true,
    scoreObservation: scoreObservation("agent-1", 90),
  });
  assert.equal(result.rec.action, "HOLD");
  assert.match(result.rec.overrideNotes.join(" "), /requested_weight_above_conviction_tier/);
});

test("a malformed asOf fails closed rather than throwing into the scan loop", () => {
  const result = applyMandateScoreClamp(BUY, {
    agentId: "agent-1", evidence: agentOneEvidence(), asOf: "not-an-instant", enabled: true,
    scoreObservation: scoreObservation("agent-1", 90),
  });
  assert.equal(result.rec.action, "HOLD");
  assert.match(result.rec.overrideNotes.join(" "), /sizing evaluation failed/);
});

test("mandateGateSummary exposes tier, score and blockers for the evaluator", () => {
  const observation = scoreObservation("agent-1", 90);
  const { gate } = applyMandateScoreClamp(BUY, {
    agentId: "agent-1", evidence: agentOneEvidence(), asOf: AS_OF, enabled: true,
    scoreObservation: observation,
  });
  const summary = mandateGateSummary(gate, observation);
  assert.equal(summary.tier, "tier_1");
  assert.deepEqual(summary.tierRange, [10, 15]);
  assert.equal(summary.score, 90);
  assert.equal(summary.maxAvailablePoints, 100);
  assert.equal(summary.eligible, true);
  assert.deepEqual(summary.blockers, []);
  assert.ok(summary.evidenceLineage.length >= 3);
  assert.equal(mandateGateSummary(null), null);
});
