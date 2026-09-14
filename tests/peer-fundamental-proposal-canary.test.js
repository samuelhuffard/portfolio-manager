import test from "node:test";
import assert from "node:assert/strict";
import {
  createPeerFundamentalProposalCanary,
  peerFundamentalProposalCanarySlots,
  peerFundamentalScreenPolicy,
} from "../lib/peer-fundamental-proposal-canary.js";

test("peer-fundamental proposal promotion is an explicit, per-agent-scan one-slot canary", () => {
  assert.equal(peerFundamentalProposalCanarySlots({}), 0);
  assert.equal(peerFundamentalProposalCanarySlots({ PEER_FUNDAMENTAL_PROPOSAL_CANARY_SLOTS: "0" }), 0);
  assert.equal(peerFundamentalProposalCanarySlots({ PEER_FUNDAMENTAL_PROPOSAL_CANARY_SLOTS: "2" }), 0);
  assert.equal(peerFundamentalProposalCanarySlots({ PEER_FUNDAMENTAL_PROPOSAL_CANARY_SLOTS: "1" }), 1);

  const scheduledAgentScan = createPeerFundamentalProposalCanary({
    PEER_FUNDAMENTAL_PROPOSAL_CANARY_SLOTS: "1",
  });
  const selectedCandidates = ["first", "second", "third"].map((ticker) => ({
    ticker,
    proposalResearchEligible: scheduledAgentScan.claimResearchSlot(),
  }));
  assert.deepEqual(selectedCandidates, [
    { ticker: "first", proposalResearchEligible: true },
    { ticker: "second", proposalResearchEligible: false },
    { ticker: "third", proposalResearchEligible: false },
  ]);

  const anotherScheduledAgentScan = createPeerFundamentalProposalCanary({
    PEER_FUNDAMENTAL_PROPOSAL_CANARY_SLOTS: "1",
  });
  assert.equal(anotherScheduledAgentScan.claimResearchSlot(), true);

  const disabled = createPeerFundamentalProposalCanary();
  assert.equal(disabled.claimResearchSlot(), false);
});

test("peer screen promotion permits full research, never standalone trade authority", () => {
  assert.match(peerFundamentalScreenPolicy(), /Return HOLD/);
  const promoted = peerFundamentalScreenPolicy({ proposalResearchEligible: true });
  assert.match(promoted, /not trade authority/);
  assert.match(promoted, /independent, fresh, cited evidence/);
  assert.match(promoted, /independent evaluator/);
  assert.match(promoted, /Sam's signed approval/);
});
