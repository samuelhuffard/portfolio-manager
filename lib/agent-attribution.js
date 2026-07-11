const PRICE_TOLERANCE_PCT = 0.05; // 5% slack vs maxPrice/limit, fills rarely land exactly on a quote
const AMOUNT_TOLERANCE_PCT = 0.15; // proposals are dollar-sized, fills are share-sized — allow rounding slack

/**
 * Matches a detected Robinhood fill to the exact signed proposal identified by
 * the broker refId. `trade` is {ticker, side, shares, price, amount, date, refId}.
 * `openProposals` should already be
 * filtered to status === "ApprovedForBrokerReview" && !fulfilledAt (see lib/redis.js).
 *
 * Pure function — no I/O. Returns { agentId, proposalId } where proposalId is null and
 * agentId is "unattributed" when nothing matches (e.g. a manual trade outside the approval flow).
 *
 * `verifySignature` (Codex #3): a `(proposal) => boolean` validity check. A
 * candidate must not only CARRY a `decisionHmac` but have a VALID one — otherwise
 * a forged/random signature string could attribute and fulfill a fill. FAILS
 * CLOSED: if no verifier is supplied we cannot confirm validity, so nothing is
 * attributed (Codex re-review — the safer API refuses rather than falling back to
 * a presence-only check). Production (holdings-sync) always supplies the real one.
 */
export function matchTradeToApprovedProposal(trade, openProposals, { verifySignature } = {}) {
  if (!trade.refId) return { agentId: "unattributed", proposalId: null };
  const verify = typeof verifySignature === "function" ? verifySignature : () => false;
  const candidates = openProposals.filter(
    (p) =>
      p.id === trade.refId &&
      p.decisionHmac &&
      verify(p) &&
      p.ticker === trade.ticker &&
      p.side === trade.side
  );
  if (candidates.length === 0) return { agentId: "unattributed", proposalId: null };

  const exact = candidates
    .filter((p) => {
      if (p.maxPrice != null && trade.price > p.maxPrice * (1 + PRICE_TOLERANCE_PCT)) return false;
      const amountDiffPct = Math.abs(trade.amount - p.amountDollars) / p.amountDollars;
      return amountDiffPct <= AMOUNT_TOLERANCE_PCT;
    });

  if (exact.length !== 1) return { agentId: "unattributed", proposalId: null };

  const best = exact[0];
  return { agentId: best.agentId, proposalId: best.id };
}
