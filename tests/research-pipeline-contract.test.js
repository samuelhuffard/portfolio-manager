import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  RESEARCH_PIPELINE_DEFAULTS,
  researchTickerForAgent,
  reviewCandidateForAgent,
  runResearchScan,
} from "../jobs/research-scan.js";
import { getAIRecommendation } from "../lib/ai-overlay.js";
import { evaluateProposal } from "../lib/evaluator.js";
import { classifyEvaluatorAdmission } from "../lib/evaluator-admission.js";
import { classifyRecommendationOutcome } from "../lib/research-run-report.js";
import { createProposal } from "../lib/redis.js";
import {
  budgetFailure,
  buyRecommendation,
  evaluatorResult,
  makeResearchPipelineFixture,
} from "./fixtures/research-pipeline/index.js";

async function runFixture(options = {}) {
  const fixture = makeResearchPipelineFixture(options);
  const result = await reviewCandidateForAgent(
    fixture.agent,
    fixture.candidate,
    fixture.context,
    fixture.dependencies
  );
  return { ...fixture, result };
}

function assertCalls(calls, expected) {
  assert.deepEqual(
    {
      generator: calls.generator,
      evaluator: calls.evaluator,
      queue: calls.queue,
      tavily: calls.tavily,
      athena: calls.athena,
    },
    { tavily: 0, athena: 0, ...expected }
  );
}

test("production entry points retain the real defaults and no future admission policy", () => {
  const testDir = path.dirname(fileURLToPath(import.meta.url));
  const productionSource = fs.readFileSync(path.join(testDir, "..", "jobs", "research-scan.js"), "utf8");
  assert.equal(typeof runResearchScan, "function");
  assert.equal(typeof researchTickerForAgent, "function");
  assert.equal(Object.isFrozen(RESEARCH_PIPELINE_DEFAULTS), true);
  assert.equal(RESEARCH_PIPELINE_DEFAULTS.getAIRecommendation, getAIRecommendation);
  assert.equal(RESEARCH_PIPELINE_DEFAULTS.evaluateProposal, evaluateProposal);
  assert.equal(RESEARCH_PIPELINE_DEFAULTS.createProposal, createProposal);
  assert.equal(RESEARCH_PIPELINE_DEFAULTS.evaluatorAdmissionPolicy, null);
  assert.doesNotMatch(productionSource, /tests\/fixtures\/research-pipeline|research-pipeline-contract/);
});

test("qualifying BUY -> APPROVE creates exactly one correctly sized proposal in dependency order", async () => {
  const { result, calls, queuedInputs, order } = await runFixture();

  assertCalls(calls, { generator: 1, evaluator: 1, queue: 1 });
  assert.equal(result.createdProposal.amountDollars, 1_000);
  assert.equal(result.outcomeFacts.proposalDisposition, "created");
  assert.equal(classifyRecommendationOutcome(result.outcomeFacts), "proposal_created");
  assert.equal(queuedInputs.length, 1);
  assert.equal(queuedInputs[0].agentId, "agent-2");
  assert.equal(queuedInputs[0].ticker, "ACME");
  assert.equal(queuedInputs[0].side, "BUY");
  assert.equal(queuedInputs[0].amountDollars, 1_000);
  assert.equal(queuedInputs[0].maxPrice, 51);
  assert.match(queuedInputs[0].rationale, /Quant score 82/);
  assert.match(queuedInputs[0].riskSummary, /evaluator: APPROVE/);
  assert.deepEqual(order, [
    "news", "filings", "generator", "risk", "conviction", "breaker",
    "duplicate_check", "evaluator", "resolve_verdict", "eligibility",
    "duplicate_check", "sizing", "breaker", "queue",
  ]);
});

test("REVISE performs exactly one generator retry and then APPROVE queues once", async () => {
  const { result, calls } = await runFixture({
    generatorResults: [buyRecommendation(), buyRecommendation({ thesis: "Revised thesis addresses the critique." })],
    evaluatorResults: [evaluatorResult("REVISE", { critique: ["tighten the kill criterion"] }), evaluatorResult("APPROVE")],
  });

  assertCalls(calls, { generator: 2, evaluator: 2, queue: 1 });
  assert.equal(result.createdProposal.amountDollars, 1_000);
  assert.match(result.evaluatorVerdict, /after 1 revision/);
});

test("a second REVISE is rejected after the single permitted retry", async () => {
  const { result, calls } = await runFixture({
    generatorResults: [buyRecommendation(), buyRecommendation({ thesis: "One revised thesis." })],
    evaluatorResults: [
      evaluatorResult("REVISE", { critique: ["revise once"] }),
      evaluatorResult("REVISE", { critique: ["still incomplete"] }),
    ],
  });

  assertCalls(calls, { generator: 2, evaluator: 2, queue: 0 });
  assert.equal(result.rec.action, "HOLD");
  assert.equal(result.createdProposal, null);
  assert.match(result.evaluatorVerdict, /REJECT after 1 revision/);
});

test("REJECT creates zero proposals", async () => {
  const { result, calls } = await runFixture({ evaluatorResults: [evaluatorResult("REJECT")] });
  assertCalls(calls, { generator: 1, evaluator: 1, queue: 0 });
  assert.equal(result.rec.action, "HOLD");
  assert.equal(result.createdProposal, null);
  assert.equal(result.outcomeFacts.evaluatorState, "rejected");
  assert.equal(classifyRecommendationOutcome(result.outcomeFacts), "evaluator_reject");
});

test("evaluator error fails closed to HOLD and creates zero proposals", async () => {
  const { result, calls } = await runFixture({ evaluatorError: new Error("evaluator unavailable") });
  assertCalls(calls, { generator: 1, evaluator: 1, queue: 0 });
  assert.equal(result.rec.action, "HOLD");
  assert.equal(result.createdProposal, null);
  assert.equal(result.outcomeFacts.evaluatorState, "error");
  assert.equal(classifyRecommendationOutcome(result.outcomeFacts), "evaluator_error");
});

for (const [label, evaluator] of [
  ["numeric failure", evaluatorResult("APPROVE", { numericSpotCheck: "fail" })],
  ["suspect evidence", evaluatorResult("APPROVE", { suspectEvidence: ["instruction-shaped source"] })],
]) {
  test(`injected future admission policy blocks APPROVE with ${label} without changing live defaults`, async () => {
    const { result, calls } = await runFixture({
      evaluatorResults: [evaluator],
      evaluatorAdmissionPolicy: classifyEvaluatorAdmission,
    });
    assertCalls(calls, { generator: 1, evaluator: 1, queue: 0 });
    assert.equal(result.rec.action, "HOLD");
    assert.equal(result.createdProposal, null);
    assert.equal(result.outcomeFacts.evaluatorState, "rejected");
    assert.equal(RESEARCH_PIPELINE_DEFAULTS.evaluatorAdmissionPolicy, null);
  });
}

for (const [label, dataGate, outcome] of [
  ["stale", { ok: false, stale: true, reasons: ["price data is stale"] }, "stale_data"],
  ["blocked", { ok: false, stale: false, reasons: ["required field missing"] }, "data_gate"],
]) {
  test(`${label} data stops before generator and evaluator`, async () => {
    const { result, calls } = await runFixture({ dataGate });
    assertCalls(calls, { generator: 0, evaluator: 0, queue: 0 });
    assert.equal(result.rec, null);
    assert.equal(result.createdProposal, null);
    assert.equal(result.outcomeFacts.dataGateBlocked, true);
    assert.equal(classifyRecommendationOutcome(result.outcomeFacts), outcome);
  });
}

test("duplicate proposal does not perform a second queue write", async () => {
  const { result, calls } = await runFixture({
    openProposals: [{
      id: "existing",
      agentId: "agent-2",
      ticker: "ACME",
      side: "BUY",
      status: "Pending",
      fulfilledAt: null,
    }],
  });
  assertCalls(calls, { generator: 1, evaluator: 0, queue: 0 });
  assert.equal(result.createdProposal, null);
  assert.equal(result.outcomeFacts.duplicateOpen, true);
  assert.equal(classifyRecommendationOutcome(result.outcomeFacts), "duplicate");
});

test("budget failure escapes to the existing outer handler and remains distinct from future generator degradation", async () => {
  const fixture = makeResearchPipelineFixture({ generatorError: budgetFailure() });
  await assert.rejects(
    () => reviewCandidateForAgent(fixture.agent, fixture.candidate, fixture.context, fixture.dependencies),
    (error) => error?.code === "budget_exhausted"
  );
  assertCalls(fixture.calls, { generator: 1, evaluator: 0, queue: 0 });

  const common = {
    attempted: true,
    dataGateBlocked: false,
    dataGateStale: false,
    generatorAction: null,
    finalAction: null,
    riskOverridden: false,
    evaluatorState: "not_run",
    duplicateOpen: false,
    proposalDisposition: "not_applicable",
  };
  assert.equal(classifyRecommendationOutcome({ ...common, failureKind: "budget_exhausted" }), "budget_exhausted");
  assert.equal(
    classifyRecommendationOutcome({ ...common, failureKind: null, generatorDegradation: "parse" }),
    "generator_degraded"
  );
});

test("queue failure is explicit and cannot report proposal success", async () => {
  const { result, calls } = await runFixture({ queueResult: null });
  assertCalls(calls, { generator: 1, evaluator: 1, queue: 1 });
  assert.equal(result.createdProposal, null);
  assert.equal(result.outcomeFacts.proposalDisposition, "queue_error");
  assert.equal(classifyRecommendationOutcome(result.outcomeFacts), "queue_error");
  assert.match(result.noProposalReason, /could not be written/);
});
