const PRICE_TOLERANCE_PCT = 0.05; // 5% slack vs maxPrice/limit, fills rarely land exactly on a quote
const AMOUNT_TOLERANCE_PCT = 0.15; // proposals are dollar-sized, fills are share-sized — allow rounding slack

/**
 * Matches a detected Robinhood fill to the open approved proposal it most likely fulfills.
 * `trade` is {ticker, side, shares, price, amount, date}. `openProposals` should already be
 * filtered to status === "ApprovedForBrokerReview" && !fulfilledAt (see lib/redis.js).
 *
 * Pure function — no I/O. Returns { agentId, proposalId } where proposalId is null and
 * agentId is "unattributed" when nothing matches (e.g. a manual trade outside the approval flow).
 */
export function matchTradeToApprovedProposal(trade, openProposals) {
  const candidates = openProposals.filter((p) => p.ticker === trade.ticker && p.side === trade.side);
  if (candidates.length === 0) return { agentId: "unattributed", proposalId: null };

  const scored = candidates
    .filter((p) => {
      if (p.maxPrice != null && trade.price > p.maxPrice * (1 + PRICE_TOLERANCE_PCT)) return false;
      const amountDiffPct = Math.abs(trade.amount - p.amountDollars) / p.amountDollars;
      return amountDiffPct <= AMOUNT_TOLERANCE_PCT;
    })
    .map((p) => ({ proposal: p, amountDiffPct: Math.abs(trade.amount - p.amountDollars) / p.amountDollars }))
    .sort((a, b) => a.amountDiffPct - b.amountDiffPct);

  if (scored.length === 0) return { agentId: "unattributed", proposalId: null };

  const best = scored[0].proposal;
  return { agentId: best.agentId, proposalId: best.id };
}
