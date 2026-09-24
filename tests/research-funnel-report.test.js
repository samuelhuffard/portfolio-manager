import test from "node:test";
import assert from "node:assert/strict";
import { buildResearchFunnelReport, RESEARCH_FUNNEL_RECEIPT_VERSION } from "../lib/research-funnel-report.js";
import { RESEARCH_OUTCOME_VERSION } from "../lib/research-run-report.js";

function agent(agentId, overrides = {}) {
  return {
    agentId,
    attemptedReviews: 8,
    proposalsCreated: 0,
    evaluatorRejects: 0,
    scanErrors: 0,
    budgetExhaustions: 0,
    researchFunnel: {
      schemaVersion: RESEARCH_FUNNEL_RECEIPT_VERSION,
      reviewBudget: 12,
      priorityCandidates: 12,
      exemptHoldingCandidates: 0,
      peerReadyCandidates: 8,
      deferredPriorityCandidates: 5,
      peerReadyBackfillCandidates: 1,
      proposalResearchEligibleCandidates: 1,
    },
    ...overrides,
  };
}

function run(runId, startedAt, agents) {
  return {
    runId, source: "scheduled", status: "completed", startedAt, completedAt: startedAt,
    classificationVersion: RESEARCH_OUTCOME_VERSION, agents,
  };
}

test("funnel report aggregates only recent completed scheduled receipts", () => {
  const report = buildResearchFunnelReport([
    run("old", "2026-09-10T21:15:00.000Z", [agent("agent-1")]),
    { runId: "manual", source: "manual", status: "completed", startedAt: "2026-09-11T21:15:00.000Z", agents: [agent("agent-1")] },
    run("new", "2026-09-12T21:15:00.000Z", [agent("agent-1"), agent("agent-2", {
      attemptedReviews: 4,
      researchFunnel: {
        ...agent("agent-2").researchFunnel,
        priorityCandidates: 4,
        peerReadyCandidates: 4,
        deferredPriorityCandidates: 0,
        peerReadyBackfillCandidates: 0,
      },
    })]),
  ], { maxRuns: 1 });

  assert.equal(report.completedScheduledRuns, 1);
  assert.deepEqual(report.window.runIds, ["new"]);
  assert.deepEqual(report.perAgent[0], {
    agentId: "agent-1", runs: 1, readinessReceipts: 1, attemptedReviews: 8,
    proposalsCreated: 0, evaluatorRejects: 0, scanErrors: 0, budgetExhaustions: 0,
    receiptAnomalies: {
      missingReadinessTelemetry: 0, invalidReadinessTelemetry: 0,
      inconsistentReadinessTelemetry: 0, incompatibleReadinessSchema: 0, invalidAggregateCounters: 0,
      unknownAgentSummaries: 0, invalidAgentLists: 0,
    },
    reviewBudget: 12, priorityCandidates: 12, exemptHoldingCandidates: 0, peerReadyCandidates: 8,
    deferredPriorityCandidates: 5, peerReadyBackfillCandidates: 1,
    proposalResearchEligibleCandidates: 1,
  });
  assert.equal(report.perAgent[1].attemptedReviews, 4);
  assert.equal(report.perAgent[2].runs, 0);
  assert.deepEqual(report.receiptAnomalies, {
    missingReadinessTelemetry: 0, invalidReadinessTelemetry: 0,
    inconsistentReadinessTelemetry: 0, incompatibleReadinessSchema: 0, invalidAggregateCounters: 0,
    unknownAgentSummaries: 0, invalidAgentLists: 0,
  });
  assert.deepEqual(report.receiptCohorts, [{
    classificationVersion: RESEARCH_OUTCOME_VERSION,
    researchFunnelSchemaVersion: RESEARCH_FUNNEL_RECEIPT_VERSION,
    readinessReceipts: 2,
  }]);
});

test("funnel report exposes incomplete or incompatible receipts as anomalies", () => {
  const report = buildResearchFunnelReport([
    run("legacy", "2026-09-10T21:15:00.000Z", [agent("agent-1", { researchFunnel: null })]),
    run("old-schema", "2026-09-11T21:15:00.000Z", [agent("agent-1", {
      researchFunnel: { ...agent("agent-1").researchFunnel, schemaVersion: "research-funnel-v0" },
    })]),
    run("partial", "2026-09-12T21:15:00.000Z", [agent("agent-1", {
      researchFunnel: { ...agent("agent-1").researchFunnel, peerReadyCandidates: null },
    })]),
    { runId: "bad-agents", source: "scheduled", status: "completed", startedAt: "2026-09-13T21:15:00.000Z", agents: {} },
    run("unknown", "2026-09-14T21:15:00.000Z", [agent("agent-9")]),
  ]);
  assert.equal(report.perAgent[0].runs, 3);
  assert.equal(report.perAgent[0].readinessReceipts, 0);
  assert.equal(report.perAgent[0].reviewBudget, 0);
  assert.deepEqual(report.perAgent[0].receiptAnomalies, {
    missingReadinessTelemetry: 1, invalidReadinessTelemetry: 1,
    inconsistentReadinessTelemetry: 0, incompatibleReadinessSchema: 1, invalidAggregateCounters: 0,
    unknownAgentSummaries: 0, invalidAgentLists: 0,
  });
  assert.deepEqual(report.receiptAnomalies, {
    missingReadinessTelemetry: 1, invalidReadinessTelemetry: 1,
    inconsistentReadinessTelemetry: 0, incompatibleReadinessSchema: 1, invalidAggregateCounters: 0,
    unknownAgentSummaries: 1, invalidAgentLists: 1,
  });
  assert.deepEqual(report.receiptCohorts, []);
});

test("funnel report excludes receipts whose aggregate stages cannot describe one scan", () => {
  const report = buildResearchFunnelReport([
    run("impossible", "2026-09-14T21:15:00.000Z", [agent("agent-1", {
      attemptedReviews: 9,
      researchFunnel: {
        ...agent("agent-1").researchFunnel,
        priorityCandidates: 1,
        peerReadyCandidates: 9,
        deferredPriorityCandidates: 0,
        peerReadyBackfillCandidates: 0,
        proposalResearchEligibleCandidates: 6,
      },
    })]),
  ]);
  assert.equal(report.perAgent[0].runs, 1);
  assert.equal(report.perAgent[0].readinessReceipts, 0);
  assert.equal(report.perAgent[0].receiptAnomalies.inconsistentReadinessTelemetry, 1);
  assert.equal(report.receiptAnomalies.inconsistentReadinessTelemetry, 1);
  assert.deepEqual(report.receiptCohorts, []);
});

test("funnel report rejects a receipt that exceeds its declared review budget", () => {
  const report = buildResearchFunnelReport([
    run("over-budget", "2026-09-14T21:15:00.000Z", [agent("agent-1", {
      attemptedReviews: 13,
      researchFunnel: {
        ...agent("agent-1").researchFunnel,
        reviewBudget: 12,
        priorityCandidates: 13,
        peerReadyCandidates: 13,
        deferredPriorityCandidates: 0,
        peerReadyBackfillCandidates: 0,
        proposalResearchEligibleCandidates: 1,
      },
    })]),
  ]);
  assert.equal(report.perAgent[0].readinessReceipts, 0);
  assert.equal(report.perAgent[0].receiptAnomalies.inconsistentReadinessTelemetry, 1);
  assert.equal(report.receiptAnomalies.inconsistentReadinessTelemetry, 1);
});

test("funnel report accepts mandatory holding monitoring above the discretionary budget", () => {
  const report = buildResearchFunnelReport([
    run("holding-exempt", "2026-09-14T21:15:00.000Z", [agent("agent-1", {
      attemptedReviews: 13,
      researchFunnel: {
        ...agent("agent-1").researchFunnel,
        reviewBudget: 12, priorityCandidates: 13, exemptHoldingCandidates: 1,
        peerReadyCandidates: 13, deferredPriorityCandidates: 0, peerReadyBackfillCandidates: 0,
      },
    })]),
  ]);
  assert.equal(report.perAgent[0].readinessReceipts, 1);
  assert.equal(report.perAgent[0].exemptHoldingCandidates, 1);
});

test("funnel report uses the latest terminal completion in its selected window", () => {
  const report = buildResearchFunnelReport([
    { ...run("late", "2026-09-14T21:00:00.000Z", [agent("agent-1")]), completedAt: "2026-09-14T23:00:00.000Z" },
    { ...run("newer-start", "2026-09-14T22:00:00.000Z", [agent("agent-1")]), completedAt: "2026-09-14T22:05:00.000Z" },
  ]);
  assert.equal(report.window.lastCompletedAt, "2026-09-14T23:00:00.000Z");
});
