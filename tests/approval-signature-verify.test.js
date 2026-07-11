import { test } from "node:test";
import assert from "node:assert/strict";
import { computeDecisionSignature, isValidApprovalSignature } from "../lib/proposal-signature.js";

const SECRET = "test-secret";
function signed() {
  const p = { id: "p1", status: "ApprovedForBrokerReview", agentId: "agent-1", ticker: "NVDA", side: "BUY", amountDollars: 500, maxPrice: null, decidedAt: "2026-07-11T00:00:00Z", decidedByUserId: "u1" };
  return { ...p, decisionHmac: computeDecisionSignature(p, SECRET) };
}

test("isValidApprovalSignature accepts a correctly signed proposal", () => {
  assert.equal(isValidApprovalSignature(signed(), { secret: SECRET }), true);
});

test("isValidApprovalSignature rejects a forged/mismatched/missing signature and a missing secret (fail closed)", () => {
  const p = signed();
  assert.equal(isValidApprovalSignature({ ...p, decisionHmac: "deadbeef" }, { secret: SECRET }), false);
  assert.equal(isValidApprovalSignature({ ...p, amountDollars: 999999 }, { secret: SECRET }), false); // tampered field
  assert.equal(isValidApprovalSignature({ ...p, decisionHmac: null }, { secret: SECRET }), false);
  assert.equal(isValidApprovalSignature(p, { secret: null }), false); // no secret → fail closed
});
