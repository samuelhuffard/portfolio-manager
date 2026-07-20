import test from "node:test";
import assert from "node:assert/strict";

import {
  MANDATE_DATA_AREAS,
  PARITY_AGENT_IDS,
  SHARED_MECHANICAL_STAGES,
  CANONICAL_COMMON_PATH_IMPLEMENTATIONS,
  assessAgentParityProof,
  buildMandateDataReceipt,
  buildWorkflowReceipt,
  resolveDiscoveryActivation,
} from "../lib/agent-parity-proof.js";
import {
  aggregateAgentModelCalls,
  assertAggregateSafeParityArtifact,
  buildAgentCohortIdentity,
  buildAgentFunnelTelemetry,
  buildAgentParityCohortPacket,
  buildAgentParityTelemetryEvent,
  buildDailyParityCohortReport,
  formatDailyParityCohortReport,
} from "../lib/agent-parity-telemetry.js";

const NOW = "2026-07-20T22:00:00.000Z";
const CODE_REVISION = "0123456789abcdef";
const JOB_RUN_RECEIPT_HASH = `sha256:${"b".repeat(64)}`;

function identity(agentId) {
  return buildAgentCohortIdentity({
    catalogSnapshotVersion: "catalog-2026-07-20-v1",
    eligibilityPolicyVersion: "operating-common-equity-v1",
    attentionPolicyVersion: `${agentId}-attention-v1`,
    mandateVersion: `${agentId}-mandate-v3`,
    promptVersion: `${agentId}-prompt-v3`,
    evaluatorVersion: "evaluator-v1",
    outcomeClassifierVersion: "research-outcomes-v2",
    codeRevision: CODE_REVISION,
  });
}

function funnel() {
  return {
    catalogVisible: 100,
    catalogEligible: 60,
    catalogScreenedOut: 30,
    catalogUnsupported: 10,
    selected: 10,
    displaced: 50,
    selectedNotAttempted: 1,
    selectedHoldings: 2,
    selectedReunderwrites: 1,
    selectedEvents: 2,
    selectedRanked: 3,
    selectedExploration: 2,
    attempted: 9,
    dataBlocked: 1,
    generatorDegraded: 1,
    investmentHold: 2,
    riskDowngraded: 1,
    evaluatorRejected: 1,
    evaluatorError: 0,
    duplicate: 1,
    queueFailure: 0,
    proposalBlocked: 0,
    paperOnly: 0,
    budgetDenied: 0,
    proposalCreated: 2,
    unknown: 0,
  };
}

function workflow(agentId, evidence = "organic") {
  return SHARED_MECHANICAL_STAGES.map((stage) => buildWorkflowReceipt({
    runId: "parity-run-2026-07-20",
    agentId,
    stageId: stage.id,
    implementationId: CANONICAL_COMMON_PATH_IMPLEMENTATIONS[stage.id],
    contractVersion: stage.contractVersion,
    activation: evidence === "organic" ? "live" : "test",
    proofSource: evidence === "organic" ? "runtime_config" : "common_path_test",
    evidenceClass: evidence,
    codeRevision: CODE_REVISION,
    configIdentity: `config-${stage.id}-v1`,
    jobRunReceiptHash: evidence === "organic" ? JOB_RUN_RECEIPT_HASH : null,
    observedAt: NOW,
  }));
}

function data(agentId, evidence = "organic") {
  return MANDATE_DATA_AREAS.map((areaId) => buildMandateDataReceipt({
    runId: "parity-run-2026-07-20",
    agentId,
    areaId,
    status: "complete",
    adapterId: `${agentId}-${areaId}-adapter-v1`,
    contractVersion: `${areaId}-contract-v1`,
    policyVersion: `${agentId}-${areaId}-policy-v1`,
    evidenceSnapshotVersion: "evidence-snapshot-v1",
    evidenceClass: evidence,
    codeRevision: CODE_REVISION,
    jobRunReceiptHash: evidence === "organic" ? JOB_RUN_RECEIPT_HASH : null,
    observedAt: NOW,
  }));
}

function packet(agentId, evidence = "organic") {
  const workflowReceipts = workflow(agentId, evidence);
  const dataReceipts = data(agentId, evidence);
  const rollback = agentId === "agent-1" ? null : resolveDiscoveryActivation({
    agentId,
    requestedMode: "catalog_live",
    candidateBusReady: true,
    catalogReady: true,
    switchVersion: "discovery-switch-v1",
    configIdentity: "discovery-config-v1",
    codeRevision: CODE_REVISION,
    observedAt: NOW,
  });
  return buildAgentParityCohortPacket({
    runId: `${evidence}-run-${agentId}`,
    agentId,
    evidenceClass: evidence,
    source: evidence === "organic" ? "scheduled-research-scan" : "common-path-test",
    startedAt: "2026-07-20T21:00:00.000Z",
    completedAt: NOW,
    cohortIdentity: identity(agentId),
    funnel: funnel(),
    modelCalls: [
      {
        role: "generator",
        denied: false,
        success: true,
        protectedCapacity: false,
        cacheHit: true,
        inputTokens: 100,
        outputTokens: 20,
        estimatedCostUsd: 0.01,
        latencyMs: 100,
        ticker: "PRIVATE",
        rationale: "must not survive aggregation",
      },
      {
        role: "generator",
        denied: true,
        success: false,
        protectedCapacity: false,
        cacheHit: null,
        estimatedCostUsd: null,
        latencyMs: null,
      },
      {
        role: "evaluator",
        denied: false,
        success: true,
        protectedCapacity: true,
        cacheHit: false,
        inputTokens: 200,
        outputTokens: 40,
        estimatedCostUsd: 0.03,
        latencyMs: 350,
      },
    ],
    startingBudgetUsd: 3,
    protectedCapacityUsd: 1,
    holdingCoverage: {
      expected: 2,
      monitored: 1,
      degraded: 1,
      failed: 0,
      reasons: { stale_required_input: 1 },
    },
    nearMisses: [
      { reasonCode: "stale_required_input", stage: "data", strengthBand: "high", ticker: "PRIVATE" },
      { reasonCode: "evaluator_reject", stage: "evaluator", strengthBand: "highest", thesis: "PRIVATE" },
    ],
    degradationReasons: ["generator_schema_invalid", "stale_required_input"],
    workflowReceiptHashes: workflowReceipts.map((receipt) => receipt.receiptHash),
    dataReceiptHashes: dataReceipts.map((receipt) => receipt.receiptHash),
    rollbackReceiptHash: rollback?.receiptHash ?? null,
  });
}

test("funnel telemetry conserves catalog, selection, buckets, attempts, and terminal outcomes", () => {
  const value = buildAgentFunnelTelemetry(funnel());
  assert.deepEqual(value.conservation, {
    catalogConserved: true,
    selectionConserved: true,
    bucketConserved: true,
    attemptConserved: true,
    outcomeConserved: true,
  });
  assert.throws(
    () => buildAgentFunnelTelemetry({ ...funnel(), investmentHold: 3 }),
    /terminal outcomes/,
  );
  assert.throws(
    () => buildAgentFunnelTelemetry({ ...funnel(), selectedExploration: 3 }),
    /selection buckets/,
  );
});

test("model-call telemetry is per-agent aggregate, explicit about unknowns, and preserves p50/p90", () => {
  const result = aggregateAgentModelCalls([
    { role: "generator", denied: false, success: true, protectedCapacity: false, cacheHit: true, inputTokens: 10, outputTokens: 2, estimatedCostUsd: 0.01, latencyMs: 100 },
    { role: "generator", denied: false, success: false, protectedCapacity: false, cacheHit: false, estimatedCostUsd: 0.02, latencyMs: 500 },
    { role: "generator", denied: true, success: false, protectedCapacity: false, cacheHit: null, estimatedCostUsd: null, latencyMs: null },
  ], { startingBudgetUsd: 3, protectedCapacityUsd: 1 });
  assert.equal(result.roles.generator.calls, 3);
  assert.equal(result.roles.generator.denials, 1);
  assert.equal(result.roles.generator.p50LatencyMs, 100);
  assert.equal(result.roles.generator.p90LatencyMs, 500);
  assert.equal(result.roles.generator.latencyUnknownCalls, 1);
  assert.equal(result.roles.generator.costKnownCalls, 2);
});

test("cohort packet and event are deterministic, privacy-safe, and explicit about evidence class", () => {
  const first = packet("agent-2", "organic");
  const second = packet("agent-2", "organic");
  assert.equal(first.packetHash, second.packetHash);
  assert.equal(first.evidenceClass, "organic");
  assert.equal(first.capacity.roles.generator.denials, 1);
  assert.equal(first.nearMisses.count, 2);
  assert.equal(first.holdingCoverage.complete, true);
  assert.equal(assertAggregateSafeParityArtifact(first), true);
  assert.doesNotMatch(JSON.stringify(first), /PRIVATE|rationale|thesis|ticker/i);

  const event = buildAgentParityTelemetryEvent(first);
  assert.match(event.id, /^agent-parity-event:/);
  assert.equal(event.packetHash, first.packetHash);
  assert.equal(event.evidenceClass, "organic");
});

test("daily report keeps organic and synthetic evidence separate and missing agents explicit", () => {
  const organicPackets = PARITY_AGENT_IDS.map((agentId) => packet(agentId, "organic"));
  const syntheticPacket = packet("agent-1", "synthetic");
  const assessment = assessAgentParityProof({
    workflowReceipts: PARITY_AGENT_IDS.flatMap((agentId) => workflow(agentId)),
    dataReceipts: PARITY_AGENT_IDS.flatMap((agentId) => data(agentId)),
    verifiedRuntimeRunReceiptHashes: [JOB_RUN_RECEIPT_HASH],
  });
  const report = buildDailyParityCohortReport({
    reportingDate: "2026-07-20",
    packets: [...organicPackets, syntheticPacket],
    parityAssessment: assessment,
  });
  assert.equal(report.organic.runPacketCount, 3);
  assert.equal(report.organic.agents.every((agent) => agent.present), true);
  assert.equal(report.synthetic.runPacketCount, 1);
  assert.equal(report.synthetic.agents[0].present, true);
  assert.equal(report.synthetic.agents[1].present, false);
  assert.equal(report.paritySummary.parityEvidenceComplete, true);
  assert.equal(report.paritySummary.observerAuthority, "signed_phase0_observer_only");
  assert.equal(assertAggregateSafeParityArtifact(report), true);
  assert.doesNotMatch(JSON.stringify(report), /trustObservationEligible|countsTowardSafetyWindow/i);

  const formatted = formatDailyParityCohortReport(report);
  assert.match(formatted, /ORGANIC: 3 run packet/);
  assert.match(formatted, /SYNTHETIC: 1 run packet/);
  assert.match(formatted, /agent-2: no packet/);
});

test("unknown and zero denominators stay explicit instead of becoming false healthy zeroes", () => {
  const report = buildDailyParityCohortReport({
    reportingDate: "2026-07-20",
    packets: [],
  });
  assert.equal(report.organic.runPacketCount, 0);
  assert.deepEqual(report.organic.agents.map((agent) => agent.reasonCode), [
    "no_packet",
    "no_packet",
    "no_packet",
  ]);
  assert.equal(report.synthetic.runPacketCount, 0);
});
