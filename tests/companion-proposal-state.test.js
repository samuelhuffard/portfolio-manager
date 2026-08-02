import test from "node:test";
import assert from "node:assert/strict";
import { validateCompanionProposalStatePatch } from "../lib/companion-proposal-state.js";
import { applyProposalFulfillment } from "../lib/redis.js";

test("companion may report bounded execution state only", () => {
  const patch = { executionState: "Executing", executionOrderId: "broker-order-1" };
  assert.equal(validateCompanionProposalStatePatch(patch), patch);
  assert.equal(validateCompanionProposalStatePatch({ status: "ExecutionFailed", executionState: "BrokerRejected" }).status, "ExecutionFailed");
});

test("companion cannot mutate approvals, fulfillment, or financial fields", () => {
  for (const patch of [
    { fulfilledAt: "2026-08-01T00:00:00.000Z" },
    { amountDollars: 50 },
    { status: "ApprovedForBrokerReview" },
    { executionShares: 0 },
  ]) {
    assert.throws(() => validateCompanionProposalStatePatch(patch));
  }
});

test("companion cannot report execution state for a pending or fulfilled proposal", () => {
  const patch = { executionState: "Executing" };
  assert.throws(() => validateCompanionProposalStatePatch(patch, { status: "Pending", fulfilledAt: null }));
  assert.throws(() => validateCompanionProposalStatePatch(patch, { status: "ApprovedForBrokerReview", fulfilledAt: "2026-08-01T00:00:00.000Z" }));
});

test("the exact terminal-failure patch emitted by the Mac is accepted without client-owned updatedAt", () => {
  const patch = {
    status: "ExecutionFailed",
    executionState: "BrokerRejected",
    executionFailedAt: "2026-08-01T12:00:00.000Z",
    executionFailureReason: "broker rejected order",
  };
  assert.equal(validateCompanionProposalStatePatch(patch, { status: "ApprovedForBrokerReview", fulfilledAt: null }), patch);
});

test("fulfillment clears Executing before the authoritative proposal is shadowed", () => {
  const proposal = { id: "proposal-1", status: "ApprovedForBrokerReview", executionState: "Executing" };
  const fulfilled = applyProposalFulfillment(proposal, "order-1", "2026-08-01T12:00:00.000Z", 0.25);
  assert.equal(fulfilled.executionState, null);
  assert.equal(fulfilled.fulfilledOrderId, "order-1");
  assert.equal(fulfilled.fulfilledShares, 0.25);
});
