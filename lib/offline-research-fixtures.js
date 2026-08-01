/**
 * W2-only fixture validators. They operate exclusively on supplied local data
 * and must never be imported by a job, server, scheduler, or proposal writer.
 */
import { createHash } from "node:crypto";

export const RESEARCH_FIXTURE_VERSION = "offline-research-fixture-v1";
export const RESEARCH_SAMPLE_KINDS = Object.freeze([
  "QualifyingSetup",
  "OrganicProposal",
  "ResearchExclusion",
  "GeneratorDegraded",
]);
export const BLIND_GRADING_RUBRIC = Object.freeze([
  "factual_support", "variant_view", "valuation_assumptions", "disconfirmation",
  "kill_criteria", "uncertainty", "mandate_fit",
]);
const SOURCE_TIERS = new Set(["primary", "regulatory", "issuer", "derived", "corroborating"]);

export function fixtureFingerprint(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function invalidTime(value) {
  return !Number.isFinite(Date.parse(value));
}

export function validateOfflineResearchSample(sample) {
  const errors = [];
  if (!sample || sample.version !== RESEARCH_FIXTURE_VERSION) errors.push("invalid_version");
  if (!RESEARCH_SAMPLE_KINDS.includes(sample?.kind)) errors.push("invalid_kind");
  if (invalidTime(sample?.decisionTime)) errors.push("invalid_decision_time");
  if (!Array.isArray(sample?.evidence) || sample.evidence.length === 0) errors.push("evidence_required");
  for (const fact of sample?.evidence ?? []) {
    if (!fact?.sourceTier || !SOURCE_TIERS.has(fact.sourceTier)) errors.push("source_tier_required");
    if (invalidTime(fact?.retrievedAt) || invalidTime(fact?.availableAt)) errors.push("invalid_evidence_time");
    if (!invalidTime(sample?.decisionTime) && Date.parse(fact.retrievedAt) > Date.parse(sample.decisionTime)) errors.push("retrieved_after_decision");
    if (!invalidTime(sample?.decisionTime) && Date.parse(fact.availableAt) > Date.parse(sample.decisionTime)) errors.push("future_fact");
  }
  if (!sample?.telemetry || typeof sample.telemetry.terminalReason !== "string") errors.push("terminal_reason_required");
  if (!Array.isArray(sample?.telemetry?.stageMargins)) errors.push("stage_margins_required");
  for (const margin of sample?.telemetry?.stageMargins ?? []) {
    if (!margin?.stage || !Number.isFinite(margin.margin)) errors.push("invalid_stage_margin");
  }
  if (sample?.kind === "OrganicProposal" && sample?.classification !== "review_ready") errors.push("proposal_must_be_review_ready");
  if (sample?.kind !== "OrganicProposal" && sample?.classification === "review_ready") errors.push("non_proposal_cannot_be_review_ready");
  if (sample?.label !== "synthetic_local_non_promotional") errors.push("synthetic_label_required");
  return { valid: errors.length === 0, errors: [...new Set(errors)] };
}

export function validateBlindGrade(grade) {
  const errors = [];
  if (!grade || grade.version !== "blind-grade-v1") errors.push("invalid_grade_version");
  if (!grade?.reviewerId || !Array.isArray(grade?.scores)) errors.push("grade_fields_required");
  const ids = new Set(grade?.scores?.map((score) => score.criterion));
  if (BLIND_GRADING_RUBRIC.some((criterion) => !ids.has(criterion))) errors.push("rubric_incomplete");
  if ((grade?.scores ?? []).some((score) => !Number.isFinite(score.score) || score.score < 0 || score.score > 5)) errors.push("invalid_grade_score");
  return { valid: errors.length === 0, errors: [...new Set(errors)] };
}

export function validateFrozenGoldenSet(manifest) {
  const errors = [];
  if (!manifest || manifest.version !== "bench30-golden-set-v1") errors.push("invalid_manifest_version");
  if (!Array.isArray(manifest?.slots) || manifest.slots.length !== 30) errors.push("exactly_30_slots_required");
  const slots = manifest?.slots ?? [];
  if (new Set(slots.map((slot) => slot.id)).size !== slots.length) errors.push("duplicate_slot");
  if (new Set(slots.map((slot) => slot.policyVersion)).size !== 1) errors.push("mixed_policy_versions");
  if ("vendorResults" in (manifest ?? {})) errors.push("vendor_results_forbidden");
  for (const slot of slots) {
    if (!slot?.sourceTier) errors.push("slot_source_tier_required");
    if (!Array.isArray(slot?.expectedFacts) || !Array.isArray(slot?.expectedMissingness)) errors.push("slot_expectations_required");
    if (invalidTime(slot?.decisionTime)) errors.push("slot_decision_time_required");
    if (slot?.retrievalReceipt?.retrievedAt && Date.parse(slot.retrievalReceipt.retrievedAt) > Date.parse(slot.decisionTime)) errors.push("slot_retrieved_after_decision");
  }
  return { valid: errors.length === 0, errors: [...new Set(errors)] };
}

export function verifyFrozenFixture(value, expectedFingerprint) {
  return fixtureFingerprint(value) === expectedFingerprint;
}
