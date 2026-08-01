import test from "node:test";
import assert from "node:assert/strict";
import {
  AGENT4_DRAFT_POLICY_OWNERSHIP,
  AGENT4_PAIRED_SHADOW_CASES,
  runAgent4PairedShadowLab,
} from "../lib/agent4-paired-shadow-lab.js";

test("Agent 4 paired shadow lab is deterministic, complete, and authority-free", () => {
  const first = runAgent4PairedShadowLab();
  const second = runAgent4PairedShadowLab();
  assert.deepEqual(first, second);
  assert.equal(first.length, 12);
  assert.deepEqual(new Set(AGENT4_PAIRED_SHADOW_CASES.map((entry) => entry.request.specialistProposal.agentId)), new Set(["agent-1", "agent-2", "agent-3"]));
  assert.ok(first.some((entry) => entry.result.outcome === "ACCEPT"));
  assert.ok(first.some((entry) => entry.result.outcome === "REJECT"));
  assert.equal(first.filter((entry) => entry.result.outcome === "ABSTAIN").length, 2);
  for (const entry of first) {
    assert.equal(entry.mode, "SHADOW");
    assert.equal(entry.liveApprovalHmac, null);
    assert.equal(entry.orderIntent, null);
    assert.equal(entry.queueMutation, null);
    assert.equal(entry.cashReservation, null);
    assert.match(entry.proposalFingerprint, /^[a-f0-9]{64}$/);
  }
  assert.ok(Object.values(AGENT4_DRAFT_POLICY_OWNERSHIP).every((owner) => owner === "fixture_only_policy_unresolved"));
});
