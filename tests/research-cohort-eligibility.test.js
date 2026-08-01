import test from "node:test";
import assert from "node:assert/strict";
import {
  REQUIRED_VERSION_IDENTITY_FIELDS,
  RESEARCH_COHORT_REASON_CODES,
  classifyResearchCohortEligibility,
} from "../lib/research-cohort-eligibility.js";

function facts(overrides = {}) {
  return {
    origin: "organic",
    dataStatus: "actionable",
    operationalStatus: "ok",
    classificationStatus: "classified",
    identity: { observationId: "obs-1", researchRunId: "run-1", agentId: "agent-1" },
    versions: Object.fromEntries(REQUIRED_VERSION_IDENTITY_FIELDS.map((field) => [field, `${field}-v1`])),
    ...overrides,
  };
}

test("admits a complete structured organic setup", () => {
  assert.deepEqual(classifyResearchCohortEligibility(facts()), { eligible: true, reasonCodes: [] });
});

test("forced, manual, legacy, and synthetic origins cannot enter an organic cohort", () => {
  const cases = {
    forced: "origin_forced",
    manual: "origin_manual",
    legacy: "origin_legacy",
    synthetic: "origin_non_organic_fixture",
    fixture: "origin_non_organic_fixture",
    replay: "origin_non_organic_fixture",
    seeded: "origin_non_organic_fixture",
    backfill: "origin_non_organic_fixture",
    test: "origin_non_organic_fixture",
  };
  for (const [origin, reason] of Object.entries(cases)) {
    assert.deepEqual(classifyResearchCohortEligibility(facts({ origin })), { eligible: false, reasonCodes: [reason] }, origin);
  }
});

test("data, operational, and classification degradations are explicit exclusions", () => {
  const cases = [
    [{ dataStatus: "stale" }, "data_stale"],
    [{ dataStatus: "blocked" }, "data_blocked"],
    [{ dataStatus: "unknown" }, "data_status_unknown"],
    [{ operationalStatus: "provider_failure" }, "provider_failure"],
    [{ operationalStatus: "budget_exhausted" }, "budget_exhausted"],
    [{ operationalStatus: "parser_failure" }, "parser_failure"],
    [{ operationalStatus: "queue_failure" }, "queue_failure"],
    [{ operationalStatus: "duplicate" }, "duplicate_blocked"],
    [{ operationalStatus: "ownership_blocked" }, "ownership_blocked"],
    [{ classificationStatus: "unknown" }, "classification_unknown"],
  ];
  for (const [overrides, reason] of cases) {
    assert.deepEqual(classifyResearchCohortEligibility(facts(overrides)), { eligible: false, reasonCodes: [reason] });
  }
});

test("missing lineage or any required version identity fails closed", () => {
  assert.deepEqual(classifyResearchCohortEligibility(facts({ identity: { observationId: "obs-1", researchRunId: "run-1" } })), {
    eligible: false,
    reasonCodes: ["identity_missing"],
  });
  for (const field of REQUIRED_VERSION_IDENTITY_FIELDS) {
    const versions = { ...facts().versions, [field]: "" };
    assert.deepEqual(classifyResearchCohortEligibility(facts({ versions })), {
      eligible: false,
      reasonCodes: ["version_identity_missing"],
    }, field);
  }
});

test("multiple exclusions retain deterministic reason-code order", () => {
  assert.deepEqual(
    classifyResearchCohortEligibility(facts({
      origin: "manual",
      dataStatus: "stale",
      operationalStatus: "parser_failure",
      classificationStatus: "unknown",
      identity: null,
      versions: null,
    })),
    {
      eligible: false,
      reasonCodes: ["origin_manual", "data_stale", "parser_failure", "classification_unknown", "identity_missing", "version_identity_missing"],
    }
  );
});

test("cohort reason codes are closed and invalid input fails closed", () => {
  assert.deepEqual(classifyResearchCohortEligibility(null), { eligible: false, reasonCodes: ["invalid_eligibility_facts"] });
  assert.deepEqual(
    classifyResearchCohortEligibility(facts({ origin: "unrecognized", operationalStatus: "unrecognized" })),
    { eligible: false, reasonCodes: ["origin_unknown", "operational_status_unknown"] }
  );
  const allowed = new Set(RESEARCH_COHORT_REASON_CODES);
  for (const code of classifyResearchCohortEligibility(facts({ origin: "unrecognized", operationalStatus: "unrecognized" })).reasonCodes) {
    assert.equal(allowed.has(code), true);
  }
});
