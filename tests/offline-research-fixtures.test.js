import test from "node:test";
import assert from "node:assert/strict";
import { BENCH30_GOLDEN_SET } from "../fixtures/bench30-golden-set.js";
import {
  RESEARCH_FIXTURE_VERSION,
  BLIND_GRADING_RUBRIC,
  fixtureFingerprint,
  validateBlindGrade,
  validateFrozenGoldenSet,
  validateOfflineResearchSample,
  verifyFrozenFixture,
} from "../lib/offline-research-fixtures.js";

const good = {
  version: RESEARCH_FIXTURE_VERSION, kind: "OrganicProposal",
  decisionTime: "2025-01-31T21:00:00.000Z", label: "synthetic_local_non_promotional",
  classification: "review_ready", telemetry: { terminalReason: "passed_fixture_gate", stageMargins: [{ stage: "evidence", margin: 1 }] },
  evidence: [{ sourceTier: "primary", retrievedAt: "2025-01-31T20:00:00.000Z", availableAt: "2025-01-31T19:00:00.000Z" }],
};

test("Bench30 is frozen metadata with exactly thirty slots and no provider result", () => {
  assert.deepEqual(validateFrozenGoldenSet(BENCH30_GOLDEN_SET), { valid: true, errors: [] });
  assert.equal(BENCH30_GOLDEN_SET.slots.length, 30);
  assert.equal("vendorResults" in BENCH30_GOLDEN_SET, false);
});

test("fixture chronology and source tier fail closed", () => {
  assert.deepEqual(validateOfflineResearchSample(good), { valid: true, errors: [] });
  const future = structuredClone(good);
  future.evidence[0].retrievedAt = "2025-02-01T00:00:00.000Z";
  future.evidence[0].availableAt = "2025-02-01T00:00:00.000Z";
  assert.deepEqual(validateOfflineResearchSample(future), {
    valid: false, errors: ["retrieved_after_decision", "future_fact"],
  });
  const noTier = structuredClone(good);
  delete noTier.evidence[0].sourceTier;
  assert.equal(validateOfflineResearchSample(noTier).errors.includes("source_tier_required"), true);
});

test("frozen local fixture detects mutation and mixed policy manifests fail closed", () => {
  const fingerprint = fixtureFingerprint(BENCH30_GOLDEN_SET);
  assert.equal(verifyFrozenFixture(BENCH30_GOLDEN_SET, fingerprint), true);
  const altered = structuredClone(BENCH30_GOLDEN_SET);
  altered.slots[0].scenario = "mutated";
  assert.equal(verifyFrozenFixture(altered, fingerprint), false);
  altered.slots[1].policyVersion = "other-policy";
  assert.equal(validateFrozenGoldenSet(altered).errors.includes("mixed_policy_versions"), true);
});

test("blind grading rubric is complete and bounded", () => {
  const grade = {
    version: "blind-grade-v1", reviewerId: "fixture-reviewer",
    scores: BLIND_GRADING_RUBRIC.map((criterion) => ({ criterion, score: 3 })),
  };
  assert.deepEqual(validateBlindGrade(grade), { valid: true, errors: [] });
  assert.equal(validateBlindGrade({ ...grade, scores: grade.scores.slice(1) }).errors.includes("rubric_incomplete"), true);
});
