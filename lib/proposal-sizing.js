const MAX_AMOUNT_DOLLARS = 10000; // mirrors portfolio-dashboard's lib/proposals.ts cap

/**
 * Converts a risk-gated AI recommendation into a dollar amount for the approval queue.
 * BUY normally sizes off total account value (cash + invested) so the very first trade
 * on a freshly-funded account can still be sized — "% of invested capital" breaks down
 * to zero before any position exists. It is then capped by currently available
 * idle cash so no single BUY proposal can exceed deployable cash.
 *
 * For tiny starter accounts, percentage weights create unusably small proposals. If an
 * agent config sets `percentageSizingMinPortfolioValue`, new BUYs below that account
 * value use a concentrated starter allocation instead: account value divided across
 * `starterPortfolioMaxPositions`, minus a reserve only if that agent explicitly
 * configures one.
 *
 * SELL sizes off the dollar value of the ticker's current position (a full-exit amount),
 * since the AI overlay doesn't specify a partial-sell weight and risk-engine.js always
 * forces SELL's targetWeight to 0.
 *
 * Pure function — no I/O. Returns { amountDollars, clamped, starterSized?, cashClamped? }
 * or null when nothing sizeable exists yet (e.g. BUY before the account has been funded).
 */
export function sizeProposalAmount({
  action,
  targetWeightPct,
  totalPortfolioValue,
  currentPositionWeightPct,
  cashAvailable,
  limits = {},
}) {
  let raw;
  let starterSized = false;
  let cashClamped = false;
  if (action === "BUY") {
    if (!totalPortfolioValue || totalPortfolioValue <= 0) return null;
    if (cashAvailable != null && cashAvailable <= 0) return null;

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

    if (cashAvailable != null && raw > cashAvailable) {
      raw = cashAvailable;
      cashClamped = true;
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
  return {
    amountDollars,
    clamped,
    ...(starterSized ? { starterSized } : {}),
    ...(cashClamped ? { cashClamped } : {}),
  };
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

/**
 * True when this agent/ticker/side has already had a proposal review inside the
 * cooldown window. Used for ordinary research-scan SELL/rotation proposals so
 * agents don't ask to churn the same position every day. Risk-stop/exit monitors
 * intentionally do not use this helper.
 */
export function hasRecentProposal(proposals, { agentId, ticker, side, cooldownDays, now = new Date() }) {
  if (!cooldownDays || cooldownDays <= 0) return false;
  const cutoff = now.getTime() - cooldownDays * 24 * 60 * 60 * 1000;
  return proposals.some((p) => {
    if (p.agentId !== agentId || p.ticker !== ticker || p.side !== side) return false;
    const ts = Date.parse(p.createdAt ?? p.updatedAt ?? "");
    return Number.isFinite(ts) && ts >= cutoff;
  });
}
