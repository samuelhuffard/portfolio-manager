import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeProposalShadowDrift } from "../lib/pg/proposal-shadow-repair.js";

const base = {
  id: "proposal-1",
  agentId: "agent-3",
  ticker: "GS",
  side: "BUY",
  amountDollars: 6.05,
  maxPrice: null,
  rationale: "Private rationale text",
  riskSummary: "Private risk text",
  status: "Pending",
  decidedAt: null,
  decidedByUserId: null,
  decisionNote: null,
  decisionHmac: null,
  fulfilledAt: null,
  fulfilledOrderId: null,
  fulfilledShares: null,
  updatedAt: "2026-07-24T15:00:00.000Z",
};

test("proposal repair preview ignores equivalent decimal storage", () => {
  const result = summarizeProposalShadowDrift([base], [{ ...base, amountDollars: "6.0500" }]);
  assert.deepEqual(result, {
    authoritativeCount: 1,
    shadowCount: 1,
    missingInShadow: 0,
    missingInAuthoritative: 0,
    changedRecords: 0,
    fieldCounts: {},
    ok: true,
  });
});

test("proposal repair preview reports lifecycle fields without exposing their values", () => {
  const shadow = { ...base, status: "ApprovedForBrokerReview", decisionHmac: "signed", updatedAt: "2026-07-24T15:05:00.000Z" };
  const result = summarizeProposalShadowDrift([base], [shadow]);
  assert.equal(result.ok, false);
  assert.equal(result.changedRecords, 1);
  assert.deepEqual(result.fieldCounts, { decisionHmac: 1, status: 1, updatedAt: 1 });
  assert.equal(JSON.stringify(result).includes("Private rationale text"), false);
});
