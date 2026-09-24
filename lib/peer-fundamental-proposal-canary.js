// A peer-fundamental rank is an entry signal for research, never trade authority.
// The default is zero slots; the explicit one-slot canary is reversible without a deploy.
export function peerFundamentalProposalCanarySlots(env = process.env) {
  return env.PEER_FUNDAMENTAL_PROPOSAL_CANARY_SLOTS?.trim() === "1" ? 1 : 0;
}

// A canary instance belongs to one scheduled agent scan. Keeping the consumed
// state here prevents a second candidate in that scan from receiving the slot.
export function createPeerFundamentalProposalCanary(env = process.env) {
  let remainingSlots = peerFundamentalProposalCanarySlots(env);

  return {
    claimResearchSlot() {
      if (remainingSlots <= 0) return false;
      remainingSlots -= 1;
      return true;
    },
  };
}

// Peer-fundamental promotion is observed only through scheduled research.
// Manual re-runs must remain unable to consume a proposal-eligible slot.
export function createScheduledPeerFundamentalProposalCanary({ source, env = process.env } = {}) {
  return createPeerFundamentalProposalCanary(source === "scheduled" ? env : {});
}

export function peerFundamentalScreenPolicy({ proposalResearchEligible = false } = {}) {
  if (!proposalResearchEligible) {
    return "This Lab score is a partial peer-fundamental research screen, not a complete agent-mandate score. It may be discussed as a relative score only, but it cannot authorize a BUY or SELL. Return HOLD and state what additional mandate evidence would be needed for an actionable conclusion.";
  }
  return "This peer-fundamental score is a partial screening signal that earned this candidate one supervised research slot; it is not trade authority. You may return BUY or SELL only when independent, fresh, cited evidence establishes the full thesis, bear case, valuation assumptions, and kill criteria. A peer rank, normalized score, or unsupported news item alone can never support an action. The deterministic risk checks, independent evaluator, and Sam's signed approval remain mandatory.";
}
