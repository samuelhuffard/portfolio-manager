// Lightweight cross-repo contract for the aggregate-only research health
// projection. The dashboard mirrors these values and its drift test imports
// this module directly, so changing a public field or reason code in only one
// repository fails CI. Never add tickers, rationales, evidence, holdings, or
// investor/account data to these allow-lists.

export const RESEARCH_DATA_STATUS_FIELDS = Object.freeze([
  "state", "reason", "runId", "startedAt", "completedAt", "cataloged", "classified",
  "metricRows", "scored", "complete", "partial", "unsupported", "oldestInputDate",
  "newestInputDate", "failureStage", "selectionMode", "selectionPolicyVersion",
  "selectionPolicyUnresolved", "selectionCandidateCount", "selectionSelectedCount",
  "selectionDisplacedCount", "selectionOverlapCount", "selectionReasonCodeCounts",
]);

export const SHADOW_SELECTION_STATUS_FIELDS = Object.freeze([
  "state", "reason", "runId", "selectionRunId", "mode", "policyVersion", "policyUnresolved",
  "candidateCount", "selectedCount", "displacedCount", "overlapCount", "eligibleEventCount",
  "reasonCodeCounts", "failureStage",
]);

export const SHADOW_SELECTION_REASON_CODES = Object.freeze([
  "holding", "mandatory_reunderwrite", "displaced", "material_thesis_breaking_event",
  "validated_economic_score_change", "high_stable_score", "fixed_exploration_allocation",
  "material_filing", "score_changed", "filing_change", "market_change", "estimate_change",
  "ownership_change", "materiality_policy_accepted", "current_observation_not_actionable",
  "previous_thesis_critical_evidence_not_fresh", "research_ineligible",
]);

export const SHADOW_SELECTION_REASON_CODE_SET = new Set(SHADOW_SELECTION_REASON_CODES);
