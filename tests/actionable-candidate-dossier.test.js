import test from "node:test";
import assert from "node:assert/strict";
import { summarizeActionableCandidateDossiers } from "../lib/actionable-candidate-dossier.js";

const NOW = "2026-07-13T20:00:00.000Z";

function metric(metricId, overrides = {}) {
  return {
    metricId, value: 0.8, unit: "decimal_ratio", points: 40, maxPoints: 50,
    source: "fixture", sourceDocumentId: "fixture-document", sourceFiledAt: NOW,
    sourceAsOf: NOW, retrievedAt: NOW, freshnessState: "fresh", peerCount: 12,
    calculationMethod: "fixture", thesisCritical: true, missingReason: null, ...overrides,
  };
}

function observation(ticker, overrides = {}) {
  const metrics = overrides.metrics ?? [metric("earnings_quality"), metric("growth")];
  const rawPoints = metrics.reduce((total, item) => total + (item.points ?? 0), 0);
  const maxAvailablePoints = metrics.reduce((total, item) => total + (item.maxPoints ?? 0), 0);
  return {
    id: `observation-${ticker}`, runId: "run-1", observedAt: NOW, agentId: "agent-1",
    mandateId: "agent_one", mandateVersion: "3.0",
    mandateUniverseVersion: "eligible-us-operating-common-equities-v3",
    productionUniversePolicyVersion: "catalog-technology-subverticals-v1",
    scoringConfigVersion: "mandate-v3-scoring-1+sha256:fixture", codeRevision: "fixture-revision",
    ticker, universeSnapshotId: "universe-fixture", eligible: true, eligibilityReasonCodes: [],
    score: rawPoints, uncappedScore: rawPoints, rawPoints, maxAvailablePoints, complete: true,
    actionable: true, coverageMask: ["earnings_quality", "growth"], missingMetrics: [],
    criticalMissingMetrics: [], fallbackMethod: "peer_relative", thinPeerSet: false,
    peerSetId: "peers-fixture", peerSetLevel: "industry", peerCount: 12,
    specialSectorKey: null, scoreCause: "filing", inputSnapshotId: "evidence-fixture", metrics,
    ...overrides,
  };
}

test("a canonically actionable observation is ready only for deep research", () => {
  const summary = summarizeActionableCandidateDossiers([{ ticker: "AAA", agentId: "agent-1" }], [observation("AAA")]);
  assert.equal(summary.readyForDeepResearchCount, 1);
  assert.equal(summary.blockedCount, 0);
  assert.deepEqual(summary.reasonCodeCounts, {});
});

test("the adapter's intentional actionable=false pin remains a visible blocker", () => {
  const summary = summarizeActionableCandidateDossiers([{ ticker: "AAA", agentId: "agent-1" }], [
    observation("AAA", { actionable: false }),
  ]);
  assert.equal(summary.readyForDeepResearchCount, 0);
  assert.deepEqual(summary.reasonCodeCounts, { observation_not_research_actionable: 1 });
});

test("invalid, duplicate, and malformed advisory inputs fail closed without throwing", () => {
  const later = observation("AAA", { id: "observation-AAA-later", observedAt: "2026-07-13T21:00:00.000Z", actionable: false });
  const invalid = { agentId: "agent-1", ticker: "INVALID" };
  const summary = summarizeActionableCandidateDossiers([
    { ticker: "AAA", agentId: "agent-1" },
    { ticker: "MISSING", agentId: "agent-1" },
    { ticker: "INVALID", agentId: "agent-1" },
    { ticker: "", agentId: "agent-1" },
  ], [observation("AAA"), later, invalid, { ticker: "BROKEN" }]);
  assert.deepEqual(summary, {
    version: "actionable-candidate-dossier-shadow-v2",
    mode: "shadow_only",
    evaluatedCount: 4,
    readyForDeepResearchCount: 0,
    blockedCount: 4,
    invalidObservationCount: 2,
    observationsInputInvalid: false,
    assessmentUnavailableCount: 1,
    reasonCodeCounts: {
      observation_invalid: 1,
      observation_missing: 1,
      observation_not_research_actionable: 1,
    },
  });
  assert.equal(JSON.stringify(summary).includes("AAA"), false);
  assert.deepEqual(
    summarizeActionableCandidateDossiers([{ ticker: "AAA", agentId: "agent-1" }], [observation("AAA"), later]),
    summarizeActionableCandidateDossiers([{ ticker: "AAA", agentId: "agent-1" }], [later, observation("AAA")]),
  );
});
