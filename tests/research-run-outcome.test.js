import test from "node:test";
import assert from "node:assert/strict";
import { classifyResearchRunOutcome, blankOutcomeCounts } from "../lib/research-run-report.js";

/**
 * The 2026-09-20 scan completed 9 investment HOLDs and hit one Anthropic 500 on
 * a single name. It was recorded as `status: "failed"` with receipt `ok: false` —
 * byte-identical in its top-level signal to a scan that never ran. These tests
 * pin the distinction without changing the legacy status or the deliberate throw.
 */

const agent = (agentId, { attempted = 0, status = "completed", ...counts } = {}) => ({
  agentId,
  status,
  attemptedReviews: attempted,
  outcomeCounts: { ...blankOutcomeCounts(), ...counts },
});

test("a clean run is ok with no reason", () => {
  const result = classifyResearchRunOutcome([
    agent("agent-1", { attempted: 3, investment_hold: 3 }),
    agent("agent-3", { attempted: 1, investment_hold: 1 }),
  ]);
  assert.equal(result.outcome, "ok");
  assert.equal(result.reason, null);
  assert.equal(result.detail.failedReviews, 0);
  assert.deepEqual(result.detail.failuresByKind, {});
});

test("the live 2026-09-20 shape is degraded, not failed", () => {
  // agent-1: 3 holds. agent-2: 5 holds + 1 review_error. agent-3: 1 hold.
  const result = classifyResearchRunOutcome([
    agent("agent-1", { attempted: 3, investment_hold: 3 }),
    agent("agent-2", { attempted: 6, investment_hold: 5, review_error: 1 }),
    agent("agent-3", { attempted: 1, investment_hold: 1 }),
  ]);
  assert.equal(result.outcome, "degraded");
  assert.equal(result.reason, "partial_review_failures");
  assert.equal(result.detail.attemptedReviews, 10);
  assert.equal(result.detail.succeededReviews, 9);
  assert.equal(result.detail.failedReviews, 1);
  assert.deepEqual(result.detail.failuresByKind, { review_error: 1 });
  assert.deepEqual(result.detail.abortedAgents, []);
});

test("a run where every attempted review failed is failed, not degraded", () => {
  const result = classifyResearchRunOutcome([
    agent("agent-1", { attempted: 2, review_error: 2 }),
    agent("agent-2", { attempted: 1, queue_error: 1 }),
  ]);
  assert.equal(result.outcome, "failed");
  assert.equal(result.reason, "all_reviews_failed");
  assert.equal(result.detail.succeededReviews, 0);
});

test("an agent that threw outranks per-review accounting", () => {
  // agent-2 aborted, so its silence is not evidence that nothing was wrong.
  const result = classifyResearchRunOutcome([
    agent("agent-1", { attempted: 5, investment_hold: 5 }),
    agent("agent-2", { attempted: 0, status: "failed" }),
  ]);
  assert.equal(result.outcome, "failed");
  assert.equal(result.reason, "agent_run_aborted");
  assert.deepEqual(result.detail.abortedAgents, ["agent-2"]);
});

test("failure kinds are reported separately so a provider outage is not a budget wall", () => {
  const result = classifyResearchRunOutcome([
    agent("agent-1", { attempted: 4, investment_hold: 2, review_error: 1, budget_exhausted: 1 }),
  ]);
  assert.equal(result.outcome, "degraded");
  assert.deepEqual(result.detail.failuresByKind, { budget_exhausted: 1, review_error: 1 });
});

test("the detail carries no ticker, rationale, or provider message", () => {
  const result = classifyResearchRunOutcome([
    agent("agent-2", { attempted: 2, investment_hold: 1, review_error: 1 }),
  ]);
  const serialized = JSON.stringify(result);
  for (const leak of ["TXG", "rationale", "thesis", "Internal server error", "request_id", "prompt"]) {
    assert.doesNotMatch(serialized, new RegExp(leak, "i"), `outcome detail must not carry ${leak}`);
  }
  assert.deepEqual(
    Object.keys(result.detail).sort(),
    ["abortedAgents", "attemptedReviews", "failedReviews", "failuresByKind", "succeededReviews"],
  );
});

test("an empty roster is ok rather than throwing", () => {
  const result = classifyResearchRunOutcome([]);
  assert.equal(result.outcome, "ok");
  assert.equal(result.detail.attemptedReviews, 0);
});

test("a non-array roster is rejected rather than silently classified", () => {
  assert.throws(() => classifyResearchRunOutcome(null), TypeError);
  assert.throws(() => classifyResearchRunOutcome({}), TypeError);
});

test("the outcome vocabulary stays inside the frozen receipt set", () => {
  const frozen = new Set(["ok", "degraded", "not_configured", "failed", "skipped_not_due"]);
  const shapes = [
    [agent("agent-1", { attempted: 1, investment_hold: 1 })],
    [agent("agent-1", { attempted: 1, review_error: 1 })],
    [agent("agent-1", { attempted: 2, investment_hold: 1, review_error: 1 })],
    [agent("agent-1", { attempted: 0, status: "failed" })],
    [],
  ];
  for (const shape of shapes) {
    assert.ok(frozen.has(classifyResearchRunOutcome(shape).outcome));
  }
});
