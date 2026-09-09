import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MandateScoreMetricSchema,
  MandateScoreObservationSchema,
  OBSERVATION_UNITS,
  SCORE_CAUSES,
} from "../contracts/research-observation.js";

const NOW = "2026-07-13T20:00:00.000Z";

function metric(overrides = {}) {
  return {
    metricId: "earnings_quality",
    value: 0.78,
    unit: "decimal_ratio",
    points: 40,
    maxPoints: 50,
    source: "sec_companyfacts",
    sourceDocumentId: "0000123456-26-000001",
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

function fullObservation(overrides = {}) {
  const metrics = [
    metric(),
    metric({ metricId: "growth", value: 0.35, points: 38, maxPoints: 50 }),
  ];
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
    codeRevision: "6e0aa24",
    ticker: "NVDA",
    universeSnapshotId: "universe-1",
    eligible: true,
    eligibilityReasonCodes: [],
    score: 78,
    uncappedScore: 78,
    rawPoints: 78,
    maxAvailablePoints: 100,
    complete: true,
    actionable: true,
    coverageMask: ["earnings_quality", "growth"],
    missingMetrics: [],
    criticalMissingMetrics: [],
    fallbackMethod: "peer_relative",
    thinPeerSet: false,
    peerSetId: "peer-1",
    peerSetLevel: "industry",
    peerCount: 12,
    specialSectorKey: null,
    scoreCause: "filing",
    inputSnapshotId: "evidence-1",
    metrics,
    ...overrides,
  };
}

test("complete observation parses and exports the frozen enums", () => {
  assert.doesNotThrow(() => MandateScoreObservationSchema.parse(fullObservation()));
  assert.ok(OBSERVATION_UNITS.includes("percentage_points"));
  assert.ok(SCORE_CAUSES.includes("coverage"));
});

test("partial observations are stored but not proposal-actionable", () => {
  const partialMetric = metric({
    metricId: "growth",
    value: null,
    points: null,
    maxPoints: 50,
    sourceDocumentId: null,
    sourceFiledAt: null,
    sourceAsOf: null,
    freshnessState: "unavailable",
    thesisCritical: false,
    missingReason: "history_not_available",
  });
  const partial = fullObservation({
    score: 80,
    uncappedScore: 80,
    rawPoints: 40,
    maxAvailablePoints: 50,
    complete: false,
    actionable: false,
    coverageMask: ["earnings_quality"],
    missingMetrics: ["growth"],
    criticalMissingMetrics: [],
    metrics: [metric(), partialMetric],
  });
  assert.doesNotThrow(() => MandateScoreObservationSchema.parse(partial));
});

test("unsupported special-sector observations remain valid stored telemetry", () => {
  const unsupported = fullObservation({
    eligible: false,
    eligibilityReasonCodes: ["special_sector_evidence_unsupported"],
    score: 0,
    uncappedScore: 0,
    rawPoints: 0,
    maxAvailablePoints: 0,
    complete: false,
    actionable: false,
    coverageMask: [],
    missingMetrics: ["bank_nim"],
    criticalMissingMetrics: ["bank_nim"],
    fallbackMethod: "none",
    thinPeerSet: true,
    peerSetId: "peer-empty-absolute",
    peerSetLevel: "none",
    peerCount: 0,
    specialSectorKey: "banks",
    scoreCause: "initial",
    metrics: [metric({
      metricId: "bank_nim",
      value: null,
      points: null,
      maxPoints: 25,
      sourceDocumentId: null,
      sourceFiledAt: null,
      sourceAsOf: null,
      freshnessState: "unsupported",
      peerCount: 0,
      calculationMethod: "special_sector_adapter",
      thesisCritical: true,
      missingReason: "bank_adapter_not_implemented",
    })],
  });
  assert.doesNotThrow(() => MandateScoreObservationSchema.parse(unsupported));
});

test("coverage arrival and mandate-version changes are stored but cannot be directly actionable", () => {
  const unavailableGrowth = metric({
    metricId: "growth",
    value: null,
    points: null,
    sourceDocumentId: null,
    sourceFiledAt: null,
    sourceAsOf: null,
    freshnessState: "unavailable",
    thesisCritical: false,
    missingReason: "coverage_arrived_after_previous_observation",
  });
  const coverageArrival = fullObservation({
    score: 80,
    uncappedScore: 80,
    rawPoints: 40,
    maxAvailablePoints: 50,
    complete: false,
    actionable: false,
    coverageMask: ["earnings_quality"],
    missingMetrics: ["growth"],
    criticalMissingMetrics: [],
    scoreCause: "coverage",
    metrics: [metric(), unavailableGrowth],
  });
  const versionChange = fullObservation({ mandateVersion: "3.1", actionable: false, scoreCause: "version" });
  assert.doesNotThrow(() => MandateScoreObservationSchema.parse(coverageArrival));
  assert.doesNotThrow(() => MandateScoreObservationSchema.parse(versionChange));
});

test("strict units, timestamps, coverage, completeness, and actionability fail closed", () => {
  assert.throws(() => MandateScoreMetricSchema.parse(metric({ unit: "percent" })), /Invalid enum value/);
  assert.throws(() => MandateScoreMetricSchema.parse(metric({ retrievedAt: "2026-07-13" })), /Invalid datetime/);
  assert.throws(() => MandateScoreObservationSchema.parse(fullObservation({ complete: false })), /complete must reflect/);
  assert.throws(() => MandateScoreObservationSchema.parse(fullObservation({ coverageMask: ["growth", "earnings_quality"] })), /lexicographically sorted/);
  assert.throws(() => MandateScoreObservationSchema.parse(fullObservation({ coverageMask: ["earnings_quality"] })), /coverageMask must exactly/);
  assert.throws(() => MandateScoreObservationSchema.parse(fullObservation({ scoreCause: "coverage" })), /never directly research-actionable/);
  assert.throws(() => MandateScoreObservationSchema.parse(fullObservation({
    metrics: [], rawPoints: 0, maxAvailablePoints: 0, score: 0, uncappedScore: 0,
    complete: false, coverageMask: [], fallbackMethod: "none",
  })), /every thesis-critical metric to be fresh and present/);
  assert.throws(() => MandateScoreObservationSchema.parse(fullObservation({
    metrics: [metric(), metric({ metricId: "growth", freshnessState: "policy_unresolved" })],
  })), /criticalMissingMetrics must exactly/);
  assert.throws(() => MandateScoreObservationSchema.parse({ ...fullObservation(), unexpected: true }), /Unrecognized key/);
});
