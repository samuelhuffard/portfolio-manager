const MAX_AMOUNT_DOLLARS = 10000; // mirrors portfolio-dashboard's lib/proposals.ts cap

/**
 * Converts a risk-gated AI recommendation into a dollar amount for the approval queue.
 * BUY sizes off total account value (cash + invested) so the very first trade on a
 * freshly-funded account can still be sized — "% of invested capital" breaks down to
 * zero before any position exists. SELL sizes off the dollar value of the ticker's
 * current position (a full-exit amount), since the AI overlay doesn't specify a
 * partial-sell weight and risk-engine.js always forces SELL's targetWeight to 0.
 *
 * Pure function — no I/O. Returns { amountDollars, clamped } or null when nothing
 * sizeable exists yet (e.g. BUY before the account has been funded).
 */
export function sizeProposalAmount({ action, targetWeightPct, totalPortfolioValue, currentPositionWeightPct }) {
  let raw;
  if (action === "BUY") {
    if (!totalPortfolioValue || totalPortfolioValue <= 0) return null;
    raw = (targetWeightPct / 100) * totalPortfolioValue;
  } else if (action === "SELL") {
    if (!currentPositionWeightPct || !totalPortfolioValue || totalPortfolioValue <= 0) return null;
    raw = (currentPositionWeightPct / 100) * totalPortfolioValue;
  } else {
    return null;
  }

  if (!Number.isFinite(raw) || raw <= 0) return null;

  const clamped = raw > MAX_AMOUNT_DOLLARS;
  const amountDollars = Math.round((clamped ? MAX_AMOUNT_DOLLARS : raw) * 100) / 100;
  return { amountDollars, clamped };
}

/**
 * True when an open (undecided, or decided-but-unfulfilled) proposal already exists
 * for this agent/ticker/side — used to avoid re-queueing the same signal on every
 * scan run before Sam has acted on the first one.
 */
export function hasOpenProposal(proposals, { agentId, ticker, side }) {
  return proposals.some(
    (p) =>
      p.agentId === agentId &&
      p.ticker === ticker &&
      p.side === side &&
      (p.status === "Pending" || (p.status === "ApprovedForBrokerReview" && !p.fulfilledAt))
  );
}
