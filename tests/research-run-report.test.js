import test from "node:test";
import assert from "node:assert/strict";
import {
  RESEARCH_OUTCOME_KINDS,
  RESEARCH_OUTCOME_VERSION,
  addOutcome,
  assertOutcomeConservation,
  blankOutcomeCounts,
  buildResearchRunReport,
  classifyRecommendationOutcome,
  formatResearchRunReport,
  outcomeTotal,
} from "../lib/research-run-report.js";

function facts(overrides = {}) {
  return {
    attempted: true,
    dataGateBlocked: false,
    dataGateStale: false,
    failureKind: null,
    generatorAction: "HOLD",
    finalAction: "HOLD",
    riskOverridden: false,
    evaluatorState: "not_run",
    duplicateOpen: false,
    proposalDisposition: "not_applicable",
    ...overrides,
  };
}

test("classifies every research outcome category from explicit facts", () => {
  const cases = {
    investment_hold: facts(),
    data_gate: facts({ dataGateBlocked: true, generatorAction: null }),
    stale_data: facts({ dataGateBlocked: true, dataGateStale: true, generatorAction: null }),
    budget_exhausted: facts({ failureKind: "budget_exhausted" }),
    review_error: facts({ failureKind: "review_error" }),
    evaluator_reject: facts({ generatorAction: "BUY", finalAction: "HOLD", evaluatorState: "rejected" }),
    evaluator_error: facts({ generatorAction: "BUY", finalAction: "HOLD", evaluatorState: "error" }),
    risk_downgrade: facts({ generatorAction: "BUY", finalAction: "HOLD", riskOverridden: true }),
    duplicate: facts({ generatorAction: "BUY", finalAction: "BUY", duplicateOpen: true }),
    proposal_blocked: facts({ generatorAction: "BUY", finalAction: "BUY", evaluatorState: "approved", proposalDisposition: "blocked" }),
    queue_error: facts({ generatorAction: "BUY", finalAction: "BUY", evaluatorState: "approved", proposalDisposition: "queue_error" }),
    paper_only: facts({ generatorAction: "BUY", finalAction: "BUY", evaluatorState: "approved", proposalDisposition: "paper_only" }),
    proposal_created: facts({ generatorAction: "BUY", finalAction: "BUY", evaluatorState: "approved", proposalDisposition: "created" }),
    unknown: facts({ generatorAction: "BUY", finalAction: "BUY" }),
  };
  for (const kind of RESEARCH_OUTCOME_KINDS) assert.equal(classifyRecommendationOutcome(cases[kind]), kind, kind);
});

test("classification precedence keeps infrastructure outcomes out of investment HOLD", () => {
  assert.equal(classifyRecommendationOutcome(facts({ generatorAction: "BUY", finalAction: "BUY", evaluatorState: "approved", proposalDisposition: "created", failureKind: null })), "proposal_created");
  assert.equal(classifyRecommendationOutcome(facts({ dataGateBlocked: true, dataGateStale: true, generatorAction: null })), "stale_data");
  assert.equal(classifyRecommendationOutcome(facts({ generatorAction: "BUY", finalAction: "HOLD", evaluatorState: "rejected" })), "evaluator_reject");
  assert.equal(classifyRecommendationOutcome(facts({ generatorAction: "BUY", finalAction: "HOLD", riskOverridden: true, evaluatorState: "error" })), "evaluator_error");
});

test("contradictory, missing, and unattempted facts are unknown", () => {
  assert.equal(classifyRecommendationOutcome(null), "unknown");
  assert.equal(classifyRecommendationOutcome(facts({ attempted: false })), "unknown");
  assert.equal(classifyRecommendationOutcome(facts({ dataGateStale: true, dataGateBlocked: false })), "unknown");
  assert.equal(classifyRecommendationOutcome(facts({ generatorAction: "BUY", finalAction: "HOLD", riskOverridden: true, proposalDisposition: "created" })), "unknown");
  assert.equal(classifyRecommendationOutcome(facts({ generatorAction: "BUY", finalAction: "HOLD", evaluatorState: "approved" })), "unknown");
});

test("outcome aggregation conserves attempted reviews", () => {
  let counts = blankOutcomeCounts();
  counts = addOutcome(counts, "investment_hold");
  counts = addOutcome(counts, "unknown");
  counts = addOutcome(counts, "proposal_created");
  assert.equal(outcomeTotal(counts), 3);
  assert.equal(assertOutcomeConservation(counts, 3), true);
  assert.throws(() => assertOutcomeConservation(counts, 2), /conservation failed/);
  assert.throws(() => addOutcome(counts, "not-a-category"), /Unknown research outcome/);
});

test("legacy status is explicitly non-classifiable", () => {
  const report = buildResearchRunReport({ runId: "legacy", status: "completed", agents: [{ agentId: "agent-1", attemptedReviews: 3 }] });
  assert.equal(report.classificationAvailable, false);
  assert.equal(report.reason, "legacy_status_insufficient");
  assert.match(formatResearchRunReport(report), /not classifiable/);
});

test("versioned status reports aggregate counts without private text", () => {
  const status = {
    runId: "run-1",
    status: "completed",
    agents: [{
      agentId: "agent-1",
      attemptedReviews: 2,
      classificationVersion: RESEARCH_OUTCOME_VERSION,
      outcomeCounts: { ...blankOutcomeCounts(), investment_hold: 1, proposal_created: 1 },
    }],
  };
  const report = buildResearchRunReport(status);
  assert.equal(report.classificationAvailable, true);
  assert.equal(report.totals.attemptedReviews, 2);
  assert.equal(report.totals.outcomeCounts.proposal_created, 1);
  assert.equal("rationale" in report, false);
  assert.match(formatResearchRunReport(report), /2 attempted/);
});

test("mismatched persisted counts fail closed", () => {
  const report = buildResearchRunReport({
    runId: "bad-run",
    status: "completed",
    agents: [{
      agentId: "agent-1",
      attemptedReviews: 2,
      classificationVersion: RESEARCH_OUTCOME_VERSION,
      outcomeCounts: { ...blankOutcomeCounts(), investment_hold: 1 },
    }],
  });
  assert.equal(report.classificationAvailable, false);
  assert.equal(report.reason, "outcome_conservation_failed");
});
