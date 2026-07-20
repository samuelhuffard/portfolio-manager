import test from "node:test";
import assert from "node:assert/strict";

import {
  CAPABILITY_COVERAGE,
  CAPABILITY_STATES,
  CURRENT_SKILL_CAPABILITY_MATRIX,
  MANDATE_POLICY_DIFFERENCES,
  PARITY_AGENT_IDS,
  SHARED_SKILL_CAPABILITIES,
  SHARED_TRUST_CONTROLS,
  assessAgentCapabilityParity,
  assessFleetCapabilityParity,
  buildCompleteParityTarget,
  capabilitySatisfiesParity,
} from "../lib/agent-capability-parity.js";

test("the parity vocabulary is explicit and fail-closed", () => {
  assert.deepEqual(CAPABILITY_STATES, [
    "deterministic_live",
    "deterministic_shadow",
    "advisory_only",
    "missing",
  ]);
  assert.deepEqual(CAPABILITY_COVERAGE, ["complete", "partial", "none"]);

  assert.equal(capabilitySatisfiesParity({ state: "deterministic_live", coverage: "complete" }), true);
  assert.equal(capabilitySatisfiesParity({ state: "deterministic_live", coverage: "partial" }), false);
  assert.equal(capabilitySatisfiesParity({ state: "deterministic_shadow", coverage: "complete" }), false);
  assert.equal(capabilitySatisfiesParity({ state: "advisory_only", coverage: "complete" }), false);
  assert.equal(capabilitySatisfiesParity({ state: "missing", coverage: "none" }), false);
  assert.equal(capabilitySatisfiesParity(undefined), false);
});

test("every agent is assessed against the same trust and skill capabilities", () => {
  assert.equal(new Set(SHARED_TRUST_CONTROLS.map(({ id }) => id)).size, SHARED_TRUST_CONTROLS.length);
  assert.equal(new Set(SHARED_SKILL_CAPABILITIES.map(({ id }) => id)).size, SHARED_SKILL_CAPABILITIES.length);

  for (const agentId of PARITY_AGENT_IDS) {
    assert.deepEqual(
      Object.keys(CURRENT_SKILL_CAPABILITY_MATRIX[agentId]).sort(),
      SHARED_SKILL_CAPABILITIES.map(({ id }) => id).sort()
    );
    assert.ok(MANDATE_POLICY_DIFFERENCES[agentId]);
  }
});

test("the current snapshot preserves trust evidence but does not claim fair skill parity", () => {
  const fleet = assessFleetCapabilityParity();
  assert.equal(fleet.trustObservationEligible, true);
  assert.equal(fleet.skillObservationComparable, false);

  for (const result of fleet.agents) {
    assert.equal(result.trustReady, true);
    assert.equal(result.trustObservationEligible, true);
    assert.equal(result.capabilityReady, false);
    assert.equal(result.skillObservationEligible, false);
    assert.ok(result.skillBlockers.length > 0);
  }
});

test("the baseline records Agent 1's real discovery advantage without treating it as complete parity", () => {
  assert.equal(
    capabilitySatisfiesParity(CURRENT_SKILL_CAPABILITY_MATRIX["agent-1"].broad_candidate_discovery),
    true
  );
  assert.equal(
    capabilitySatisfiesParity(CURRENT_SKILL_CAPABILITY_MATRIX["agent-2"].broad_candidate_discovery),
    false
  );
  assert.equal(
    capabilitySatisfiesParity(CURRENT_SKILL_CAPABILITY_MATRIX["agent-3"].broad_candidate_discovery),
    false
  );

  assert.equal(
    CURRENT_SKILL_CAPABILITY_MATRIX["agent-1"].supported_mandate_evidence_adapter.state,
    "deterministic_shadow"
  );
  assert.equal(
    CURRENT_SKILL_CAPABILITY_MATRIX["agent-2"].supported_mandate_evidence_adapter.state,
    "missing"
  );
  assert.equal(
    CURRENT_SKILL_CAPABILITY_MATRIX["agent-3"].supported_mandate_evidence_adapter.state,
    "missing"
  );
});

test("a complete target can reach parity without making mandate policies identical", () => {
  const target = buildCompleteParityTarget();
  const fleet = assessFleetCapabilityParity(target);
  assert.equal(fleet.trustObservationEligible, true);
  assert.equal(fleet.skillObservationComparable, true);
  assert.ok(fleet.agents.every((agent) => agent.capabilityReady));

  assert.notEqual(MANDATE_POLICY_DIFFERENCES["agent-1"].mandate, MANDATE_POLICY_DIFFERENCES["agent-2"].mandate);
  assert.notEqual(MANDATE_POLICY_DIFFERENCES["agent-2"].holdingCadence, MANDATE_POLICY_DIFFERENCES["agent-3"].holdingCadence);
});

test("removing one live control fails only the relevant readiness dimension", () => {
  const target = buildCompleteParityTarget();
  target.skillMatrix["agent-2"].deterministic_entry_policy = {
    state: "advisory_only",
    coverage: "complete",
    evidence: "prompt text only",
  };

  const result = assessAgentCapabilityParity("agent-2", target);
  assert.equal(result.trustReady, true);
  assert.equal(result.capabilityReady, false);
  assert.deepEqual(result.skillBlockers.map(({ capabilityId }) => capabilityId), ["deterministic_entry_policy"]);
});

test("unknown agents fail closed", () => {
  assert.throws(() => assessAgentCapabilityParity("agent-4"), /Unknown parity agent/);
});
