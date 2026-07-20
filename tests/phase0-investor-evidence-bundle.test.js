import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPhase0InvestorEvidenceBundle } from "../lib/phase0-investor-evidence-bundle.js";

function input(overrides = {}) {
  return {
    metadata: { version: "phase0-bundle-v1", asOf: "2026-07-20T20:20:00.000Z", releaseCommit: "1cc6f4f" },
    organicPhase0: {
      evidenceClass: "organic_phase0",
      operatorBurden: [{ category: "manual_reauth", interventionCount: 1, minutes: 5 }],
      decisionLineage: [
        { agentId: "agent-1", caseType: "investment_hold", count: 3 },
        { agentId: "agent-1", caseType: "near_miss", count: 1 },
        { agentId: "agent-2", caseType: "proposal", count: 1 },
      ],
      outcomeTrackingSeeds: [
        { agentId: "agent-1", seedType: "selected", count: 4, policyBinding: "not_configured" },
        { agentId: "agent-1", seedType: "near_miss", count: 1, policyBinding: "not_configured" },
        { agentId: "agent-2", seedType: "displaced", count: 8, policyBinding: "not_configured" },
      ],
      researchUnitEconomics: [
        { agentId: "agent-1", reviews: 4, generatorCalls: 4, evaluatorCalls: 1, estimatedCostUsd: null, totalLatencyMs: null, measurementState: "not_instrumented" },
        { agentId: "agent-2", reviews: 1, generatorCalls: 1, evaluatorCalls: 1, estimatedCostUsd: null, totalLatencyMs: null, measurementState: "not_instrumented" },
      ],
    },
    syntheticRehearsal: {
      evidenceClass: "synthetic_rehearsal",
      decisionLineage: [{ agentId: "agent-3", caseType: "proposal", count: 1 }],
      outcomeTrackingSeeds: [{ agentId: "agent-3", seedType: "proposal", count: 1, policyBinding: "not_configured" }],
    },
    ...overrides,
  };
}

test("builds deterministic aggregate evidence and keeps synthetic evidence separate", () => {
  const first = buildPhase0InvestorEvidenceBundle(input());
  const second = buildPhase0InvestorEvidenceBundle(input());
  assert.deepEqual(first, second);
  assert.equal(first.bundle.conclusion, "not_assessed");
  assert.equal(first.bundle.evidence.organic_phase0.decisionLineage.cases, 5);
  assert.equal(first.bundle.evidence.organic_phase0.outcomeTrackingSeeds.seeds, 13);
  assert.equal(first.bundle.evidence.organic_phase0.researchUnitEconomics.estimatedCostUsd, null);
  assert.equal(first.bundle.evidence.synthetic_rehearsal.decisionLineage.cases, 1);
  assert.equal(first.bundle.guardrails.organicSyntheticSeparated, true);
});

test("rejects private decision data rather than accidentally projecting it", () => {
  assert.throws(() => buildPhase0InvestorEvidenceBundle(input({ organicPhase0: { evidenceClass: "organic_phase0", decisionLineage: [{ agentId: "agent-1", caseType: "investment_hold", count: 1, ticker: "PRIVATE" }] } })), /ticker is not allowed/);
  assert.throws(
    () => buildPhase0InvestorEvidenceBundle(input({ metadata: { version: "phase0-bundle-v1", asOf: "2026-07-20T20:20:00.000Z", releaseCommit: "1cc6f4f", rationale: "private" } })),
    /rationale is not allowed/
  );
});

test("does not convert missing cost or latency telemetry into false zeroes", () => {
  const built = buildPhase0InvestorEvidenceBundle(input({
    organicPhase0: { evidenceClass: "organic_phase0", researchUnitEconomics: [{ agentId: "agent-1", reviews: 1, generatorCalls: 1, evaluatorCalls: 0, estimatedCostUsd: null, totalLatencyMs: null, measurementState: "not_instrumented" }] },
    syntheticRehearsal: { evidenceClass: "synthetic_rehearsal" },
  })).bundle;
  const economics = built.evidence.organic_phase0.researchUnitEconomics;
  assert.equal(economics.estimatedCostUsd, null);
  assert.equal(economics.totalLatencyMs, null);
  assert.equal(economics.latencyAggregation, "sum_of_call_durations");
  assert.equal(built.evidence.synthetic_rehearsal.state, "not_recorded");
});

test("rejects free-form values, duplicate dimensions, and an implicit evidence boundary", () => {
  assert.throws(() => buildPhase0InvestorEvidenceBundle(input({
    organicPhase0: { evidenceClass: "organic_phase0", operatorBurden: [{ category: "NVDA private rationale", interventionCount: 1, minutes: 1 }] },
  })), /category is unsupported/);
  assert.throws(() => buildPhase0InvestorEvidenceBundle(input({
    organicPhase0: { evidenceClass: "organic_phase0", outcomeTrackingSeeds: [{ agentId: "agent-1", seedType: "selected", count: 1, policyBinding: "secret ticker thesis" }] },
  })), /policyBinding is unsupported/);
  assert.throws(() => buildPhase0InvestorEvidenceBundle(input({
    organicPhase0: { evidenceClass: "organic_phase0", researchUnitEconomics: [
      { agentId: "agent-1", reviews: 1, generatorCalls: 1, evaluatorCalls: 0, estimatedCostUsd: null, totalLatencyMs: null, measurementState: "not_instrumented" },
      { agentId: "agent-1", reviews: 2, generatorCalls: 2, evaluatorCalls: 0, estimatedCostUsd: null, totalLatencyMs: null, measurementState: "not_instrumented" },
    ] },
  })), /duplicate agent rows/);
  assert.throws(() => buildPhase0InvestorEvidenceBundle(input({
    organicPhase0: { evidenceClass: "synthetic_rehearsal" },
  })), /must declare organic_phase0/);
});
