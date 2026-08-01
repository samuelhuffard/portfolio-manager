/**
 * Offline Phase 1 mandate-freeze contracts.
 *
 * These draft artifacts make the existing v3 specialist boundaries reviewable
 * without becoming a runtime scoring, selection, proposal, or authority input.
 * The live pipeline must not import this module until the master-plan Phase 3
 * activation gates and unresolved policy decisions are complete.
 */

import { MANDATE_POLICIES } from "./agents/mandate-policy.js";

export const PHASE1_MANDATE_FREEZE_VERSION = "phase1-mandate-freeze-v1-draft";

const SHARED_WORKFLOW = Object.freeze({
  discovery: "broad_catalog_supervised",
  evidenceHandling: "typed_evidence_fail_closed",
  evaluatorAccess: "same_supervised_evaluator_path",
  riskAndSizing: "same_deterministic_risk_and_sizing_path",
  proposalSemantics: "same_supervised_proposal_path",
  ownership: "verified_strategy_owned_sell_lots",
  observability: "same_receipt_and_funnel_semantics",
});

const UNRESOLVED_BY_AGENT = Object.freeze({
  "agent-1": Object.freeze(["Q-001", "Q-002", "Q-003", "Q-004"]),
  "agent-2": Object.freeze(["Q-002", "Q-003", "Q-004"]),
  "agent-3": Object.freeze(["Q-002", "Q-003", "Q-004"]),
});

const CANONICAL_SOURCE = Object.freeze({
  "agent-1": "agent_mandates/Agent_One_Mandate_v3.md",
  "agent-2": "agent_mandates/Agent_Two_Mandate_v3.md",
  "agent-3": "agent_mandates/Agent_Three_Mandate_v3.md",
});

function immutable(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(immutable));
  if (value && typeof value === "object") {
    return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, item]) => [key, immutable(item)])));
  }
  return value;
}

function draftFor(agentId) {
  const policy = MANDATE_POLICIES[agentId];
  if (!policy) throw new Error(`Unknown specialist mandate agent: ${agentId}`);

  return immutable({
    schemaVersion: PHASE1_MANDATE_FREEZE_VERSION,
    status: "draft_policy_freeze_not_runtime",
    agentId,
    mandateId: policy.mandateId,
    mandateVersion: policy.mandateVersion,
    canonicalSourcePath: CANONICAL_SOURCE[agentId],
    sharedWorkflow: SHARED_WORKFLOW,
    universeEligibility: {
      targetPolicyVersion: "eligible-us-operating-common-equities-v3",
      productionPolicy: "broad_catalog_supervised",
      exclusions: "canonical_v3_source",
    },
    rankingAndValuation: {
      scoringApproach: "peer_relative_with_deterministic_absolute_fallback",
      valuationCascade: "company_history_then_sector_then_absolute",
      minimumAvailablePoints: policy.score.minimumAvailablePoints,
      thinPeerConvictionCap: policy.score.thinPeerConvictionCap,
      scoringDetail: "canonical_v3_source",
    },
    evidenceCriticality: {
      entryEvidence: policy.entryEvidence,
      holdingEvidence: policy.holdingEvidence,
      missingBehavior: policy.evidenceSemantics.missingBehavior,
      conflictBehavior: policy.evidenceSemantics.conflictBehavior,
    },
    freshness: {
      recordStateRequired: policy.evidenceSemantics.actionableState,
      quoteAndEstimateThreshold: "policy_unresolved",
      receiptAndTimezoneRule: "policy_unresolved",
    },
    entryAbstentionExit: {
      minimumEntryScore: policy.score.minimumEntryScore,
      macro: policy.macro,
      priceStructure: policy.entry.priceStructure ?? "not_a_separate_rule",
      holdingEvidence: policy.holdingEvidence,
      unresolvedBehavior: "non_actionable",
    },
    horizonBenchmark: {
      horizon: policy.horizon,
      benchmark: "SPY",
      outcomeMaturation: "defined_in_later_measurement_packet",
    },
    risk: {
      entry: policy.entry,
      add: policy.add,
      tiers: policy.score.tiers,
    },
    specialSectorSubstitutions: {
      rule: "deterministic_backend_substitutions_only",
      unresolvedDefinition: "policy_unresolved",
    },
    unresolvedPolicyIds: UNRESOLVED_BY_AGENT[agentId],
    requiredDecisionRecordFields: [
      "exactRule",
      "sourceHierarchy",
      "exceptionRule",
      "owner",
      "acceptedAt",
      "policyVersion",
      "affectedMandates",
      "regressionFixture",
    ],
  });
}

export const PHASE1_COMPILED_MANDATE_DRAFTS = immutable(
  Object.fromEntries(Object.keys(MANDATE_POLICIES).map((agentId) => [agentId, draftFor(agentId)]))
);

const REQUIRED_FIELDS = Object.freeze([
  "schemaVersion",
  "status",
  "agentId",
  "mandateId",
  "mandateVersion",
  "canonicalSourcePath",
  "sharedWorkflow",
  "universeEligibility",
  "rankingAndValuation",
  "evidenceCriticality",
  "freshness",
  "entryAbstentionExit",
  "horizonBenchmark",
  "risk",
  "specialSectorSubstitutions",
  "unresolvedPolicyIds",
  "requiredDecisionRecordFields",
]);

export function compilePhase1MandateDraft(agentId) {
  return PHASE1_COMPILED_MANDATE_DRAFTS[agentId] ?? null;
}

export function validatePhase1MandateDraft(draft) {
  const errors = [];
  if (!draft || typeof draft !== "object") return { valid: false, errors: ["draft_missing"] };
  for (const field of REQUIRED_FIELDS) {
    if (!(field in draft)) errors.push(`missing:${field}`);
  }
  if (draft.schemaVersion !== PHASE1_MANDATE_FREEZE_VERSION) errors.push("schema_version_mismatch");
  if (draft.status !== "draft_policy_freeze_not_runtime") errors.push("runtime_status_forbidden");
  if (!Array.isArray(draft.unresolvedPolicyIds) || draft.unresolvedPolicyIds.length === 0) {
    errors.push("unresolved_policy_ids_required");
  }
  if (draft.freshness?.quoteAndEstimateThreshold !== "policy_unresolved") {
    errors.push("freshness_default_forbidden");
  }
  if (draft.specialSectorSubstitutions?.unresolvedDefinition !== "policy_unresolved") {
    errors.push("special_sector_default_forbidden");
  }
  return { valid: errors.length === 0, errors };
}

/**
 * Fixture-only diagnostic. It intentionally evaluates only explicit draft entry
 * differences, never scores a security and never emits a proposal.
 */
export function evaluatePhase1DraftAbstention({ agentId, score, currentPrice, price50DayAverage, price200DayAverage }) {
  const draft = compilePhase1MandateDraft(agentId);
  if (!draft) return { state: "non_actionable", reason: "unknown_agent" };
  if (!Number.isFinite(score) || score < draft.entryAbstentionExit.minimumEntryScore) {
    return { state: "non_actionable", reason: "minimum_entry_score" };
  }
  const rule = draft.entryAbstentionExit.priceStructure;
  if (rule === "above_200_day" && !(currentPrice > price200DayAverage)) {
    return { state: "non_actionable", reason: "price_structure_above_200_day" };
  }
  if (rule === "price_above_50_and_200_and_50_above_200"
    && !(currentPrice > price50DayAverage && currentPrice > price200DayAverage && price50DayAverage > price200DayAverage)) {
    return { state: "non_actionable", reason: "price_structure_50_200_alignment" };
  }
  return { state: "review_ready", reason: "draft_entry_conditions_met" };
}

