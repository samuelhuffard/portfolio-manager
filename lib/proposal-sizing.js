const MAX_AMOUNT_DOLLARS = 10000; // mirrors portfolio-dashboard's lib/proposals.ts cap

/**
 * Converts a risk-gated AI recommendation into a dollar amount for the approval queue.
 * BUY normally sizes off total account value (cash + invested) so the very first trade
 * on a freshly-funded account can still be sized — "% of invested capital" breaks down
 * to zero before any position exists.
 *
 * For tiny starter accounts, percentage weights create unusably small proposals. If an
 * agent config sets `percentageSizingMinPortfolioValue`, new BUYs below that account
 * value use a concentrated starter allocation instead: deployable value after cash
 * reserve divided across `starterPortfolioMaxPositions`.
 *
 * SELL sizes off the dollar value of the ticker's current position (a full-exit amount),
 * since the AI overlay doesn't specify a partial-sell weight and risk-engine.js always
 * forces SELL's targetWeight to 0.
 *
 * Pure function — no I/O. Returns { amountDollars, clamped, starterSized? } or null
 * when nothing sizeable exists yet (e.g. BUY before the account has been funded).
 */
export function sizeProposalAmount({
  action,
  targetWeightPct,
  totalPortfolioValue,
  currentPositionWeightPct,
  limits = {},
}) {
  let raw;
  let starterSized = false;
  if (action === "BUY") {
    if (!totalPortfolioValue || totalPortfolioValue <= 0) return null;
    const percentageRaw = (targetWeightPct / 100) * totalPortfolioValue;
    const threshold = limits.percentageSizingMinPortfolioValue ?? 0;
    const isNewPosition = !currentPositionWeightPct || currentPositionWeightPct <= 0;

    if (isNewPosition && threshold > 0 && totalPortfolioValue < threshold) {
      const slots = Math.max(1, limits.starterPortfolioMaxPositions ?? 2);
      const reservePct = limits.starterPortfolioCashReservePct ?? limits.minCashReservePct ?? 0;
      const deployableValue = totalPortfolioValue * Math.max(0, 1 - reservePct / 100);
      raw = deployableValue / slots;
      starterSized = true;
    } else {
      raw = percentageRaw;
    }
  } else if (action === "SELL") {
    if (!currentPositionWeightPct || !totalPortfolioValue || totalPortfolioValue <= 0) return null;
    raw = (currentPositionWeightPct / 100) * totalPortfolioValue;
  } else {
    return null;
  }

  if (!Number.isFinite(raw) || raw <= 0) return null;

  const clamped = raw > MAX_AMOUNT_DOLLARS;
  const amountDollars = Math.round((clamped ? MAX_AMOUNT_DOLLARS : raw) * 100) / 100;
  return starterSized ? { amountDollars, clamped, starterSized } : { amountDollars, clamped };
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
