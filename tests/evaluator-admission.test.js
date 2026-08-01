import test from "node:test";
import assert from "node:assert/strict";
import { EVALUATOR_ADMISSION_REASON_CODES, classifyEvaluatorAdmission } from "../lib/evaluator-admission.js";

function result(overrides = {}) {
  return { verdict: "APPROVE", numericSpotCheck: "pass", suspectEvidence: [], ...overrides };
}

test("admits only a clean structured APPROVE", () => {
  assert.deepEqual(classifyEvaluatorAdmission(result()), { admitted: true, reasonCodes: [] });
});

test("rejects every contradictory APPROVE diagnostic", () => {
  assert.deepEqual(classifyEvaluatorAdmission(result({ numericSpotCheck: "fail" })), {
    admitted: false,
    reasonCodes: ["numeric_spot_check_failed"],
  });
  assert.deepEqual(classifyEvaluatorAdmission(result({ suspectEvidence: ["instruction-shaped source"] })), {
    admitted: false,
    reasonCodes: ["suspect_evidence_present"],
  });
  assert.deepEqual(classifyEvaluatorAdmission(result({ numericSpotCheck: "no_numbers_quoted", suspectEvidence: ["x"] })), {
    admitted: false,
    reasonCodes: ["numeric_spot_check_failed", "suspect_evidence_present"],
  });
});

test("non-approvals remain non-admitted without inventing a parse failure", () => {
  assert.deepEqual(classifyEvaluatorAdmission(result({ verdict: "REJECT" })), {
    admitted: false,
    reasonCodes: ["verdict_not_approve"],
  });
});

test("missing, unknown, and parser-failed evaluator results fail closed", () => {
  for (const value of [null, {}, result({ numericSpotCheck: "unknown" }), result({ suspectEvidence: null }), result({ parseError: true }), result({ parseError: "false" })]) {
    assert.deepEqual(classifyEvaluatorAdmission(value), { admitted: false, reasonCodes: ["invalid_evaluator_result"] });
  }
});

test("reason codes are restricted to the documented deterministic allowlist", () => {
  const allowed = new Set(EVALUATOR_ADMISSION_REASON_CODES);
  for (const fixture of [result(), result({ verdict: "REVISE" }), result({ numericSpotCheck: "fail", suspectEvidence: ["x"] }), null]) {
    for (const code of classifyEvaluatorAdmission(fixture).reasonCodes) assert.equal(allowed.has(code), true);
  }
});
