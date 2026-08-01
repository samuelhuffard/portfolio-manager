/**
 * Pure, diagnostic-only eligibility for a prospective organic research cohort.
 *
 * It deliberately does not decide whether an action is investable, and it has
 * no runtime, storage, proposal, or scheduler imports. Future adapters must
 * provide structured facts; this module never infers lineage from prose.
 */
export const RESEARCH_COHORT_REASON_CODES = Object.freeze([
  "invalid_eligibility_facts",
  "origin_forced",
  "origin_manual",
  "origin_legacy",
  "origin_non_organic_fixture",
  "origin_unknown",
  "data_stale",
  "data_blocked",
  "data_status_unknown",
  "provider_failure",
  "budget_exhausted",
  "parser_failure",
  "queue_failure",
  "duplicate_blocked",
  "ownership_blocked",
  "operational_status_unknown",
  "classification_unknown",
  "identity_missing",
  "version_identity_missing",
]);

export const REQUIRED_VERSION_IDENTITY_FIELDS = Object.freeze([
  "mandateVersion",
  "evaluatorPolicyVersion",
  "evaluatorModelVersion",
  "generatorPolicyVersion",
  "generatorModelVersion",
  "scoringVersion",
  "candidatePolicyVersion",
  "universePolicyVersion",
  "evidenceSnapshotId",
  "evidenceSchemaVersion",
]);

const ORIGIN_REASON_CODES = Object.freeze({
  forced: "origin_forced",
  manual: "origin_manual",
  legacy: "origin_legacy",
  synthetic: "origin_non_organic_fixture",
  fixture: "origin_non_organic_fixture",
  replay: "origin_non_organic_fixture",
  seeded: "origin_non_organic_fixture",
  backfill: "origin_non_organic_fixture",
  test: "origin_non_organic_fixture",
});

const OPERATIONAL_REASON_CODES = Object.freeze({
  provider_failure: "provider_failure",
  budget_exhausted: "budget_exhausted",
  parser_failure: "parser_failure",
  queue_failure: "queue_failure",
  duplicate: "duplicate_blocked",
  ownership_blocked: "ownership_blocked",
});

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function hasCompleteIdentity(identity) {
  return identity && typeof identity === "object" && !Array.isArray(identity) &&
    ["observationId", "researchRunId", "agentId"].every((field) => nonEmptyString(identity[field]));
}

function hasCompleteVersionIdentity(versions) {
  return versions && typeof versions === "object" && !Array.isArray(versions) &&
    REQUIRED_VERSION_IDENTITY_FIELDS.every((field) => nonEmptyString(versions[field]));
}

/**
 * Classify structured cohort facts without granting any authority.
 *
 * Contract values:
 * - origin: organic | forced | manual | legacy | synthetic | fixture | replay |
 *   seeded | backfill | test
 * - dataStatus: actionable | stale | blocked
 * - operationalStatus: ok | provider_failure | budget_exhausted | parser_failure |
 *   queue_failure | duplicate | ownership_blocked
 * - classificationStatus: classified | unknown
 */
export function classifyResearchCohortEligibility(facts) {
  if (!facts || typeof facts !== "object" || Array.isArray(facts)) {
    return { eligible: false, reasonCodes: ["invalid_eligibility_facts"] };
  }

  const reasonCodes = [];
  if (facts.origin !== "organic") reasonCodes.push(ORIGIN_REASON_CODES[facts.origin] ?? "origin_unknown");

  if (facts.dataStatus === "stale") reasonCodes.push("data_stale");
  else if (facts.dataStatus === "blocked") reasonCodes.push("data_blocked");
  else if (facts.dataStatus !== "actionable") reasonCodes.push("data_status_unknown");

  if (facts.operationalStatus !== "ok") {
    reasonCodes.push(OPERATIONAL_REASON_CODES[facts.operationalStatus] ?? "operational_status_unknown");
  }

  if (facts.classificationStatus !== "classified") reasonCodes.push("classification_unknown");
  if (!hasCompleteIdentity(facts.identity)) reasonCodes.push("identity_missing");
  if (!hasCompleteVersionIdentity(facts.versions)) reasonCodes.push("version_identity_missing");

  return { eligible: reasonCodes.length === 0, reasonCodes };
}
