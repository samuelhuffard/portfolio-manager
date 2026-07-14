import test from "node:test";
import assert from "node:assert/strict";

import { AGENTS } from "../config/agents.js";
import { canCreateActionableProposal, classifyResearchFailure, finiteNonNegative, needsImmediateResearchFailureAlert } from "../lib/research-run-health.js";

test("all three mandate-bound specialists can create supervised approval proposals", () => {
  for (const agentId of ["agent-1", "agent-2", "agent-3"]) {
    assert.equal(canCreateActionableProposal(AGENTS.find((agent) => agent.id === agentId)), true);
  }
});

test("non-finite and negative cash fail closed to zero", () => {
  assert.equal(finiteNonNegative(NaN), 0);
  assert.equal(finiteNonNegative("not-a-number"), 0);
  assert.equal(finiteNonNegative(-1), 0);
  assert.equal(finiteNonNegative("25.50"), 25.5);
});

test("budget and rate failures are not classified as investment judgments", () => {
  assert.equal(classifyResearchFailure(new Error("429 rate limit exceeded")).kind, "budget_exhausted");
  assert.equal(classifyResearchFailure(new Error("monthly credit balance exhausted")).kind, "budget_exhausted");
  assert.equal(classifyResearchFailure(new Error("Yahoo fetch failed")).kind, "scan_error");
});

test("provider failures page immediately while ordinary scan errors remain logged", () => {
  assert.equal(classifyResearchFailure(new Error("Anthropic authentication failed")).kind, "provider_unavailable");
  assert.equal(needsImmediateResearchFailureAlert(classifyResearchFailure(new Error("Anthropic authentication failed"))), true);
  assert.equal(needsImmediateResearchFailureAlert(classifyResearchFailure(new Error("Yahoo parse failed"))), false);
});
