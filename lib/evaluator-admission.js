/**
 * Conservative, diagnostic-only admission for an evaluator result.
 *
 * This is deliberately separate from the live evaluator/queue path. It answers
 * whether a structured evaluator result is suitable for a future quality cohort;
 * it never changes a recommendation or authorizes a proposal.
 */
export const EVALUATOR_ADMISSION_REASON_CODES = Object.freeze([
  "verdict_not_approve",
  "numeric_spot_check_failed",
  "suspect_evidence_present",
  "invalid_evaluator_result",
]);

const VERDICTS = new Set(["APPROVE", "REVISE", "REJECT"]);
const NUMERIC_SPOT_CHECKS = new Set(["pass", "fail", "no_numbers_quoted"]);

/**
 * Admit only a structurally valid, contradiction-free approval.
 * Unknown or incomplete facts are invalid rather than optimistic.
 */
export function classifyEvaluatorAdmission(result) {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return { admitted: false, reasonCodes: ["invalid_evaluator_result"] };
  }

  const validResult =
    VERDICTS.has(result.verdict) &&
    NUMERIC_SPOT_CHECKS.has(result.numericSpotCheck) &&
    Array.isArray(result.suspectEvidence) &&
    result.suspectEvidence.every((item) => typeof item === "string") &&
    (result.parseError == null || result.parseError === false);
  if (!validResult) return { admitted: false, reasonCodes: ["invalid_evaluator_result"] };

  const reasonCodes = [];
  if (result.verdict !== "APPROVE") reasonCodes.push("verdict_not_approve");
  if (result.numericSpotCheck !== "pass") reasonCodes.push("numeric_spot_check_failed");
  if (result.suspectEvidence.length > 0) reasonCodes.push("suspect_evidence_present");
  return { admitted: reasonCodes.length === 0, reasonCodes };
}
