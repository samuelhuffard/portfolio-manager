import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyScoreDelta } from "../lib/score-delta.js";

const NOW = "2026-07-13T20:00:00.000Z";

function metric(metricId, overrides = {}) {
  return {
    metricId,
    value: 0.4,
    unit: "decimal_ratio",
    points: 20,
    maxPoints: 25,
    source: "sec_companyfacts",
    sourceDocumentId: "filing-1",
    sourceFiledAt: "2026-07-01T12:00:00.000Z",
    sourceAsOf: "2026-06-30T00:00:00.000Z",
    retrievedAt: NOW,
    freshnessState: "fresh",
    peerCount: 12,
    calculationMethod: "peer_percentile_band",
    thesisCritical: true,
    missingReason: null,
    ...overrides,
  };
}

function observation(overrides = {}) {
  const metrics = (overrides.metrics ?? [
    metric("eps_estimate", { unit: "usd", value: 3.2, points: 20, maxPoints: 25, source: "consensus_estimates" }),
    metric("insider_ownership", { unit: "percentage_points", value: 8, points: 20, maxPoints: 25, source: "form4_ownership" }),
    metric("pe_ratio", { unit: "multiple", value: 24, points: 20, maxPoints: 25, source: "market_quote" }),
    metric("revenue_growth", { value: 0.35, points: 20, maxPoints: 25 }),
  ]).sort((left, right) => left.metricId.localeCompare(right.metricId));
  const covered = metrics.filter((item) => item.points !== null && item.value !== null && !["unavailable", "unsupported"].includes(item.freshnessState));
  const missing = metrics.filter((item) => !covered.includes(item));
  const rawPoints = covered.reduce((sum, item) => sum + item.points, 0);
  const maxAvailablePoints = covered.reduce((sum, item) => sum + item.maxPoints, 0);
  const score = maxAvailablePoints === 0 ? 0 : (rawPoints / maxAvailablePoints) * 100;
  const criticalMissingMetrics = metrics.filter((item) => item.thesisCritical && item.freshnessState !== "fresh").map((item) => item.metricId);
  const derived = {
    score,
    uncappedScore: score,
    rawPoints,
    maxAvailablePoints,
    complete: missing.length === 0 && criticalMissingMetrics.length === 0 && maxAvailablePoints === 100,
    actionable: missing.length === 0 && maxAvailablePoints >= 80 &&
      metrics.every((item) => !item.thesisCritical || item.freshnessState === "fresh"),
    coverageMask: covered.map((item) => item.metricId),
    missingMetrics: missing.map((item) => item.metricId),
    criticalMissingMetrics,
  };
  return {
    id: "observation-1",
    runId: "run-1",
    observedAt: NOW,
    agentId: "agent-1",
    mandateId: "agent_one",
    mandateVersion: "3.0",
    mandateUniverseVersion: "eligible-us-operating-common-equities-v3",
    productionUniversePolicyVersion: "catalog-technology-subverticals-v1",
    scoringConfigVersion: "mandate-v3-scoring-1+sha256:abc",
    codeRevision: "revision-1",
    ticker: "NVDA",
    universeSnapshotId: "universe-1",
    eligible: true,
    eligibilityReasonCodes: [],
    fallbackMethod: "peer_relative",
    thinPeerSet: false,
    peerSetId: "peer-1",
    peerSetLevel: "industry",
    peerCount: 12,
    specialSectorKey: null,
    scoreCause: "filing",
    inputSnapshotId: "evidence-1",
    metrics,
    ...derived,
    ...overrides,
    metrics,
    coverageMask: overrides.coverageMask ?? derived.coverageMask,
    missingMetrics: overrides.missingMetrics ?? derived.missingMetrics,
    criticalMissingMetrics: overrides.criticalMissingMetrics ?? derived.criticalMissingMetrics,
    score: overrides.score ?? derived.score,
    uncappedScore: overrides.uncappedScore ?? derived.uncappedScore,
    rawPoints: overrides.rawPoints ?? derived.rawPoints,
    maxAvailablePoints: overrides.maxAvailablePoints ?? derived.maxAvailablePoints,
    complete: overrides.complete ?? derived.complete,
    actionable: overrides.actionable ?? derived.actionable,
  };
}

const acceptMateriality = Object.freeze({
  version: "test-materiality-v1",
  evaluate: () => true,
});

const rejectMateriality = Object.freeze({
  version: "test-materiality-v1",
  evaluate: () => false,
});

function changedMetric(id, overrides) {
  return observation({
    metrics: observation().metrics.map((item) => item.metricId === id ? { ...item, ...overrides } : item),
  });
}

test("returns the exact initial shape and does not invent a comparable delta", () => {
  const result = classifyScoreDelta({ current: observation() });
  assert.deepEqual(Object.keys(result), [
    "delta", "material", "primaryCause", "allCauses", "researchEligible", "reasonCodes",
    "changedMetrics", "coverageChanged", "peerSetChanged", "versionChanged",
  ]);
  assert.equal(result.delta, null);
  assert.equal(result.primaryCause, "initial");
  assert.deepEqual(result.allCauses, ["initial"]);
  assert.equal(result.material, null);
  assert.equal(result.researchEligible, false);
});

test("classifies filing, market, estimate, ownership, and restatement changes", () => {
  const previous = observation();
  const filing = changedMetric("revenue_growth", {
    value: 0.25,
    points: 14,
    sourceDocumentId: "filing-2",
    sourceFiledAt: "2026-07-12T12:00:00.000Z",
    sourceAsOf: "2026-06-30T00:00:00.000Z",
  });
  assert.equal(classifyScoreDelta({ previous, current: filing, materialityPolicy: acceptMateriality }).primaryCause, "filing");
  assert.equal(classifyScoreDelta({ previous, current: filing, materialityPolicy: acceptMateriality }).researchEligible, true);

  assert.equal(classifyScoreDelta({ previous, current: changedMetric("pe_ratio", { value: 32, points: 10 }) }).primaryCause, "market");
  assert.equal(classifyScoreDelta({ previous, current: changedMetric("eps_estimate", { value: 3.8, points: 24 }) }).primaryCause, "estimate");
  assert.equal(classifyScoreDelta({ previous, current: changedMetric("insider_ownership", { value: 11, points: 24 }) }).primaryCause, "ownership");
  assert.equal(classifyScoreDelta({ previous, current: changedMetric("revenue_growth", { value: 0.2, points: 12 }) }).primaryCause, "restatement");
});

test("coverage and peer-set causes are observable but never directly research-eligible", () => {
  const previous = observation();
  const unavailable = metric("revenue_growth", {
    value: null,
    points: null,
    sourceDocumentId: null,
    sourceFiledAt: null,
    sourceAsOf: null,
    freshnessState: "unavailable",
    missingReason: "vendor_lag",
  });
  const coverage = observation({
    metrics: [...observation().metrics.filter((item) => item.metricId !== "revenue_growth"), unavailable],
    scoreCause: "coverage",
  });
  const coverageResult = classifyScoreDelta({ previous, current: coverage, materialityPolicy: acceptMateriality });
  assert.equal(coverageResult.primaryCause, "coverage");
  assert.equal(coverageResult.coverageChanged, true);
  assert.equal(coverageResult.researchEligible, false);

  const peerSetResult = classifyScoreDelta({
    previous,
    current: observation({ peerSetId: "peer-2", peerCount: 13 }),
    materialityPolicy: acceptMateriality,
  });
  assert.equal(peerSetResult.primaryCause, "peer_set");
  assert.equal(peerSetResult.peerSetChanged, true);
  assert.equal(peerSetResult.researchEligible, false);
});

test("version changes have priority over simultaneous causes and are never eligible", () => {
  const previous = observation();
  const unavailable = metric("eps_estimate", {
    unit: "usd",
    source: "consensus_estimates",
    value: null,
    points: null,
    sourceDocumentId: null,
    sourceFiledAt: null,
    sourceAsOf: null,
    freshnessState: "unavailable",
    missingReason: "coverage_not_available",
  });
  const current = observation({
    scoringConfigVersion: "mandate-v3-scoring-2+sha256:def",
    peerSetId: "peer-2",
    metrics: [unavailable, ...observation().metrics.filter((item) => item.metricId !== "eps_estimate")].map((item) =>
      item.metricId === "revenue_growth" ? { ...item, value: 0.25, points: 14, sourceDocumentId: "filing-2", sourceFiledAt: "2026-07-12T12:00:00.000Z" } : item,
    ),
  });
  const result = classifyScoreDelta({ previous, current, materialityPolicy: acceptMateriality });
  assert.deepEqual(result.allCauses, ["version", "coverage", "filing", "estimate", "peer_set"]);
  assert.equal(result.primaryCause, "version");
  assert.equal(result.versionChanged, true);
  assert.equal(result.researchEligible, false);
});

test("changed metric IDs are lexicographically deterministic", () => {
  const previous = observation();
  const current = observation({
    metrics: observation().metrics.map((item) => {
      if (item.metricId === "pe_ratio") return { ...item, value: 30, points: 12 };
      if (item.metricId === "revenue_growth") return { ...item, value: 0.2, points: 12 };
      return item;
    }),
  });
  const result = classifyScoreDelta({ previous, current });
  assert.deepEqual(result.changedMetrics, ["pe_ratio", "revenue_growth"]);
});

test("timestamp-only transport changes are retry with zero delta", () => {
  const previous = observation({ actionable: false });
  const current = observation({
    id: "observation-retry",
    runId: "run-retry",
    observedAt: "2026-07-13T20:05:00.000Z",
    scoreCause: "retry",
    actionable: false,
    metrics: observation().metrics.map((item) => ({ ...item, retrievedAt: "2026-07-13T20:05:00.000Z" })),
  });
  const result = classifyScoreDelta({ previous, current, materialityPolicy: acceptMateriality });
  assert.equal(result.delta, 0);
  assert.equal(result.primaryCause, "retry");
  assert.deepEqual(result.allCauses, ["retry"]);
  assert.deepEqual(result.changedMetrics, []);
  assert.equal(result.material, false);
  assert.equal(result.researchEligible, false);
});

test("special-sector and metric-definition changes fail closed as version/incomparable", () => {
  const previous = observation();
  const specialSector = classifyScoreDelta({ previous, current: observation({ specialSectorKey: "banks" }) });
  assert.deepEqual(specialSector.allCauses, ["version"]);
  assert.equal(specialSector.primaryCause, "version");
  assert.equal(specialSector.versionChanged, true);
  assert.equal(specialSector.researchEligible, false);

  const unitChanged = changedMetric("revenue_growth", { unit: "percentage_points", value: 35 });
  const unitResult = classifyScoreDelta({ previous, current: unitChanged });
  assert.deepEqual(unitResult.allCauses, ["version"]);
  assert.equal(unitResult.researchEligible, false);

  const methodChanged = changedMetric("revenue_growth", { calculationMethod: "absolute_threshold_band" });
  const methodResult = classifyScoreDelta({ previous, current: methodChanged });
  assert.deepEqual(methodResult.allCauses, ["version"]);
  assert.equal(methodResult.researchEligible, false);
  assert.ok(methodResult.reasonCodes.includes("incomparable_observation"));
});

test("previous stale thesis-critical evidence blocks an otherwise material filing", () => {
  const staleRevenue = metric("revenue_growth", { freshnessState: "stale" });
  const previous = observation({
    metrics: [...observation().metrics.filter((item) => item.metricId !== "revenue_growth"), staleRevenue],
    actionable: false,
  });
  const current = changedMetric("revenue_growth", {
    value: 0.25,
    points: 14,
    sourceDocumentId: "filing-2",
    sourceFiledAt: "2026-07-12T12:00:00.000Z",
  });
  const result = classifyScoreDelta({ previous, current, materialityPolicy: acceptMateriality });
  assert.equal(result.primaryCause, "filing");
  assert.equal(result.material, true);
  assert.equal(result.researchEligible, false);
  assert.ok(result.reasonCodes.includes("previous_thesis_critical_evidence_not_fresh"));
});

test("unexplained score-only changes fail closed as provenance/version inconsistency", () => {
  const previous = observation();
  const current = observation({ score: previous.score + 5 });
  const result = classifyScoreDelta({ previous, current, materialityPolicy: acceptMateriality });
  assert.equal(result.delta, 5);
  assert.deepEqual(result.changedMetrics, []);
  assert.deepEqual(result.allCauses, ["version"]);
  assert.equal(result.versionChanged, true);
  assert.equal(result.researchEligible, false);
  assert.ok(result.reasonCodes.includes("unexplained_output_change"));
});

test("unknown materiality is fail-closed, while an injected versioned policy controls material", () => {
  const previous = observation();
  const current = changedMetric("revenue_growth", {
    value: 0.25,
    points: 14,
    sourceDocumentId: "filing-2",
    sourceFiledAt: "2026-07-12T12:00:00.000Z",
  });
  const unknown = classifyScoreDelta({ previous, current });
  assert.equal(unknown.material, null);
  assert.equal(unknown.researchEligible, false);
  assert.ok(unknown.reasonCodes.includes("materiality_policy_missing"));

  const rejected = classifyScoreDelta({ previous, current, materialityPolicy: rejectMateriality });
  assert.equal(rejected.material, false);
  assert.equal(rejected.researchEligible, false);
  assert.ok(rejected.reasonCodes.includes("materiality_policy_rejected"));
});

test("invalid observations, invalid policies, and mismatched series fail closed", () => {
  assert.throws(() => classifyScoreDelta({ current: { ...observation(), score: "high" } }));
  assert.throws(() => classifyScoreDelta({ previous: { ...observation(), ticker: "not a ticker" }, current: observation() }));
  assert.throws(() => classifyScoreDelta({ previous: observation(), current: observation({ ticker: "AAPL" }) }));
  assert.throws(() => classifyScoreDelta({ previous: observation(), current: observation({ scoringConfigVersion: "v2" }), materialityPolicy: { version: "missing-evaluator" } }), /evaluate function/);
});
