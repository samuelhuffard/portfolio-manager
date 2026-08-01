import test from "node:test";
import assert from "node:assert/strict";
import {
  PHASE1_COMPILED_MANDATE_DRAFTS,
  PHASE1_MANDATE_FREEZE_VERSION,
  compilePhase1MandateDraft,
  evaluatePhase1DraftAbstention,
  validatePhase1MandateDraft,
} from "../config/phase1-mandate-freeze.js";

test("all specialist mandate drafts compile from one schema and retain unresolved policy", () => {
  const drafts = Object.values(PHASE1_COMPILED_MANDATE_DRAFTS);
  assert.equal(drafts.length, 3);
  for (const draft of drafts) {
    const result = validatePhase1MandateDraft(draft);
    assert.equal(result.valid, true, result.errors.join("; "));
    assert.equal(draft.schemaVersion, PHASE1_MANDATE_FREEZE_VERSION);
    assert.equal(draft.status, "draft_policy_freeze_not_runtime");
    assert.equal(draft.freshness.quoteAndEstimateThreshold, "policy_unresolved");
    assert.ok(draft.requiredDecisionRecordFields.includes("regressionFixture"));
  }
  assert.deepEqual(
    PHASE1_COMPILED_MANDATE_DRAFTS["agent-1"].sharedWorkflow,
    PHASE1_COMPILED_MANDATE_DRAFTS["agent-2"].sharedWorkflow
  );
  assert.deepEqual(
    PHASE1_COMPILED_MANDATE_DRAFTS["agent-2"].sharedWorkflow,
    PHASE1_COMPILED_MANDATE_DRAFTS["agent-3"].sharedWorkflow
  );
});

test("draft validation rejects an invented freshness default or runtime activation", () => {
  const original = compilePhase1MandateDraft("agent-1");
  const inventedFreshness = {
    ...original,
    freshness: { ...original.freshness, quoteAndEstimateThreshold: "15_minutes" },
  };
  assert.deepEqual(validatePhase1MandateDraft(inventedFreshness), {
    valid: false,
    errors: ["freshness_default_forbidden"],
  });
  assert.equal(validatePhase1MandateDraft({ ...original, status: "runtime_active" }).valid, false);
});

test("same dated fixture exposes deliberate specialist abstention differences without a proposal", () => {
  const common = {
    currentPrice: 105,
    price50DayAverage: 110,
    price200DayAverage: 100,
  };
  assert.deepEqual(
    evaluatePhase1DraftAbstention({ agentId: "agent-1", score: 90, ...common }),
    { state: "review_ready", reason: "draft_entry_conditions_met" }
  );
  assert.deepEqual(
    evaluatePhase1DraftAbstention({ agentId: "agent-2", score: 90, ...common }),
    { state: "non_actionable", reason: "price_structure_50_200_alignment" }
  );
  assert.deepEqual(
    evaluatePhase1DraftAbstention({
      agentId: "agent-3",
      score: 55,
      currentPrice: 120,
      price50DayAverage: 110,
      price200DayAverage: 100,
    }),
    { state: "non_actionable", reason: "minimum_entry_score" }
  );
});

