const MAX_AMOUNT_DOLLARS = 10000; // mirrors portfolio-dashboard's lib/proposals.ts cap

/**
 * Converts a risk-gated AI recommendation into a dollar amount for the approval queue.
 * BUY sizes the INCREMENT toward the target weight — (targetWeightPct − current
 * position % of total account value) × total account value — so topping up an
 * existing position can never overshoot the position cap the risk engine just
 * enforced (sizing the full target as *new* dollars was doubling positions).
 * Total account value (cash + invested) is the single denominator throughout,
 * so the very first trade on a freshly-funded account can still be sized. The
 * result is then capped by currently available idle cash.
 *
 * For tiny starter accounts, percentage weights create unusably small proposals. If an
 * agent config sets `percentageSizingMinPortfolioValue`, new BUYs below that account
 * value use a concentrated starter allocation instead: account value divided across
 * `starterPortfolioMaxPositions`, minus a reserve only if that agent explicitly
 * configures one.
 *
 * SELL sizes off the actual dollar market value of the ticker's current position
 * (a full-exit amount) — never a weight × total-value product, which overstated
 * the order whenever idle cash existed (weights are % of invested capital).
 *
 * Pure function — no I/O. Returns { amountDollars, clamped, starterSized?, cashClamped? }
 * or null when nothing sizeable exists yet (e.g. BUY before the account has been
 * funded, or a BUY whose position already meets its target weight).
 */
export function sizeProposalAmount({
  action,
  targetWeightPct,
  totalPortfolioValue,
  currentPositionValue = 0,
  cashAvailable,
  limits = {},
}) {
  let raw;
  let starterSized = false;
  let cashClamped = false;
  if (action === "BUY") {
    if (!totalPortfolioValue || totalPortfolioValue <= 0) return null;
    if (cashAvailable != null && cashAvailable <= 0) return null;

    const currentWeightPct = (Math.max(0, currentPositionValue) / totalPortfolioValue) * 100;
    const incrementPct = (targetWeightPct ?? 0) - currentWeightPct;
    const threshold = limits.percentageSizingMinPortfolioValue ?? 0;
    const isNewPosition = !currentPositionValue || currentPositionValue <= 0;

    if (isNewPosition && threshold > 0 && totalPortfolioValue < threshold) {
      const slots = Math.max(1, limits.starterPortfolioMaxPositions ?? 2);
      const reservePct = limits.starterPortfolioCashReservePct ?? limits.minCashReservePct ?? 0;
      const deployableValue = totalPortfolioValue * Math.max(0, 1 - reservePct / 100);
      raw = deployableValue / slots;
      starterSized = true;
    } else {
      if (incrementPct <= 0) return null; // already at/above target — nothing to buy
      raw = (incrementPct / 100) * totalPortfolioValue;
    }

    if (cashAvailable != null && raw > cashAvailable) {
      raw = cashAvailable;
      cashClamped = true;
    }
  } else if (action === "SELL") {
    if (!currentPositionValue || currentPositionValue <= 0) return null;
    raw = currentPositionValue;
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
