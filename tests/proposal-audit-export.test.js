import test from "node:test";
import assert from "node:assert/strict";
import { buildProposalAuditReviewPacket } from "../lib/proposal-audit-export.js";

test("review packet preserves analysis evidence while removing operational identifiers", () => {
  const packet = buildProposalAuditReviewPacket({
    generatedAt: "2026-08-01T12:00:00.000Z",
    proposals: [{
      id: "proposal-123",
      agentId: "agent-1",
      ticker: "NVDA",
      side: "SELL",
      rationale: "Exit thesis is invalidated.",
      status: "ExecutionFailed",
      decisionHmac: "must-not-leave-production",
      decidedByUserId: "user-secret",
      createdByEmail: "sam@example.com",
      fulfilledOrderId: "broker-order-123",
    }],
    researchDecisions: [{ runId: "run-9", proposalId: "proposal-123", ticker: "NVDA", finalAction: "SELL" }],
    activity: [{ timestamp: "2026-08-01T11:00:00.000Z", role: "fund_manager", action: "APPROVAL_DECISION", route: "/api/proposals", userId: "user-secret", rowHmac: "audit-hmac", metadata: { email: "sam@example.com" } }],
  });

  const serialized = JSON.stringify(packet);
  assert.match(packet.proposals[0].proposalRef, /^proposal_/);
  assert.equal(packet.researchDecisions[0].proposalRef, packet.proposals[0].proposalRef);
  assert.match(packet.researchDecisions[0].runRef, /^run_/);
  assert.equal(packet.proposals[0].rationale, "Exit thesis is invalidated.");
  assert.equal(packet.activity[0].action, "APPROVAL_DECISION");
  assert.doesNotMatch(serialized, /must-not-leave-production|user-secret|sam@example\.com|broker-order-123|audit-hmac/);
});
