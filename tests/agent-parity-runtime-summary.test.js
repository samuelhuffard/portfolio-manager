import test from "node:test";
import assert from "node:assert/strict";

import {
  AGENT_PARITY_RUNTIME_SUMMARY_VERSION,
  buildAgentParityRuntimeSummary,
  toPublicAgentParityRuntimeSummary,
} from "../lib/agent-parity-runtime-summary.js";
import {
  getAgentParityRuntimeSummary,
  setAgentParityRuntimeSummary,
} from "../lib/redis.js";
import { blankOutcomeCounts, RESEARCH_OUTCOME_VERSION } from "../lib/research-run-report.js";

const NOW = "2026-07-20T21:30:00.000Z";

function agent(agentId, overrides = {}) {
  return {
    agentId,
    status: "completed",
    classificationVersion: RESEARCH_OUTCOME_VERSION,
    attemptedReviews: 2,
    recommendationsWritten: 2,
    actionCounts: { BUY: 1, SELL: 0, HOLD: 1 },
    proposalsCreated: 1,
    proposalCounts: { BUY: 1, SELL: 0 },
    scanErrors: 0,
    budgetExhaustions: 0,
    evaluatorRejects: 0,
    outcomeCounts: { ...blankOutcomeCounts(), investment_hold: 1, proposal_created: 1 },
    discovery: {
      status: "complete",
      source: "catalog",
      degraded: false,
      reasonCode: null,
      candidateBusVersion: "bus-v1",
      catalogSnapshotId: "catalog-safe-digest",
      screenPolicyVersion: `${agentId}-screen-v1`,
      attentionPolicyVersion: `${agentId}-attention-v1`,
      visible: 4000,
      eligible: 1000,
      screenedOut: 3000,
      counts: { holdings: 1, movers: 1, ranked: 15, exploration: 3 },
      ticker: "PRIVATE",
    },
    researchFunnel: {
      reviewBudget: 12,
      priorityCandidates: 12,
      peerReadyCandidates: 9,
      deferredPriorityCandidates: 4,
      peerReadyBackfillCandidates: 1,
      proposalResearchEligibleCandidates: 1,
    },
    modelCalls: {
      generator: { attempted: 2, succeeded: 2, failed: 0 },
      evaluator: { attempted: 1, succeeded: 1, failed: 0 },
    },
    capacity: {
      allocationPolicyVersion: "equal-agent-run-cap-v1",
      maxUsd: 1,
      ending: { reservedUsd: 0.12 },
    },
    error: "private failure text",
    rationale: "private thesis",
    ...overrides,
  };
}

function status(overrides = {}) {
  return {
    runId: "run-organic-1",
    source: "scheduled",
    status: "completed",
    startedAt: "2026-07-20T21:15:00.000Z",
    completedAt: NOW,
    classificationVersion: RESEARCH_OUTCOME_VERSION,
    agents: ["agent-1", "agent-2", "agent-3"].map((agentId) => agent(agentId)),
    ...overrides,
  };
}

test("scheduled runtime summary is aggregate-safe and explicitly not organic proof", () => {
  const summary = buildAgentParityRuntimeSummary(status());
  assert.equal(summary.schemaVersion, AGENT_PARITY_RUNTIME_SUMMARY_VERSION);
  assert.equal(summary.evidenceClass, "organic_runtime_unverified");
  assert.equal(summary.organicProofEligible, false);
  assert.equal(summary.terminalJobReceiptHash, null);
  assert.equal(summary.agents.length, 3);
  assert.equal(summary.agents.every((row) => row.present), true);
  assert.equal(summary.agents.every((row) => row.outcomes.conservationValid), true);
  assert.equal(summary.agents.every((row) => row.modelCalls.generator.conservationValid), true);
  assert.deepEqual(summary.agents[0].funnel.researchReadiness, {
    reviewBudget: 12,
    priorityCandidates: 12,
    exemptHoldingCandidates: 0,
    peerReadyCandidates: 9,
    deferredPriorityCandidates: 4,
    peerReadyBackfillCandidates: 1,
    proposalResearchEligibleCandidates: 1,
  });
  const encoded = JSON.stringify(summary);
  for (const forbidden of ["PRIVATE", "private thesis", "private failure text", "\"ticker\"", "\"rationale\"", "\"error\""]) {
    assert.equal(encoded.includes(forbidden), false, forbidden);
  }
});

test("missing agents and invalid model-call conservation remain explicit", () => {
  const summary = buildAgentParityRuntimeSummary(status({
    agents: [agent("agent-1", {
      modelCalls: {
        generator: { attempted: 2, succeeded: 1, failed: 0 },
        evaluator: { attempted: 0, succeeded: 0, failed: 0 },
      },
    })],
  }));
  assert.equal(summary.agents[0].modelCalls.generator.conservationValid, false);
  assert.equal(summary.agents[1].agentId, "agent-2");
  assert.equal(summary.agents[1].present, false);
  assert.equal(summary.agents[2].present, false);
});

test("public projection discards injected fields and refuses forged proof state", () => {
  const retained = {
    ...buildAgentParityRuntimeSummary(status()),
    updatedAt: NOW,
    organicProofEligible: true,
    terminalJobReceiptHash: "forged",
    ticker: "PRIVATE",
    rationale: "PRIVATE",
  };
  const projected = toPublicAgentParityRuntimeSummary(retained);
  assert.equal(projected.organicProofEligible, false);
  assert.equal(projected.terminalJobReceiptHash, null);
  assert.equal(projected.updatedAt, NOW);
  assert.equal(Object.hasOwn(projected, "ticker"), false);
  assert.equal(Object.hasOwn(projected, "rationale"), false);
});

test("Redis persistence atomically bounds latest/history and read-back reprojects", async () => {
  const calls = [];
  let retained = null;
  const redis = {
    async eval(script, keys, args) {
      calls.push({ script, keys, args });
      retained = args[1];
      return 1;
    },
    async get(key) {
      assert.equal(key, "pm:agent-parity-runtime:latest");
      return retained;
    },
  };
  const persisted = await setAgentParityRuntimeSummary(
    buildAgentParityRuntimeSummary(status()),
    { redis, now: () => new Date(NOW) }
  );
  assert.equal(persisted.appended, true);
  assert.deepEqual(calls[0].keys, [
    "pm:agent-parity-runtime:history-run:run-organic-1",
    "pm:agent-parity-runtime:history",
    "pm:agent-parity-runtime:latest",
  ]);
  assert.equal(calls[0].args[2], "49");
  assert.equal(calls[0].args[3], String(14 * 24 * 3600));
  const readBack = await getAgentParityRuntimeSummary({ redis });
  assert.equal(readBack.runId, "run-organic-1");
  assert.equal(readBack.updatedAt, NOW);
  assert.equal(readBack.organicProofEligible, false);
});
