// State-version checks: an approval authorizes a trade against the portfolio as
// it stood at decision time. Between approval and execution, cash can be spent
// by another fill, a position can shrink, or the price can run past the
// manager's limit. Executing a stale approval is how a signed-but-no-longer-valid
// order slips through. Roadmap (Phase 1): "approval is invalidated by material
// portfolio/quote changes."
//
// Pure, no I/O. The caller supplies the current state; this decides validity and
// fails closed with a specific reason. It does NOT replace the signature check —
// the signature proves authenticity, this proves the authorization still applies.

/**
 * @param {{ side: string, amountDollars: number, maxPrice: number | null, ticker: string }} proposal
 * @param {{ cashAvailable?: number, ownedShares?: number, quote?: number | null }} current
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function checkApprovalStillValid(proposal, current) {
  const { side, amountDollars, maxPrice } = proposal;
  const cash = current.cashAvailable;
  const shares = current.ownedShares;
  const quote = current.quote;

  if (side === "BUY") {
    // The cash the BUY reserved must still be there.
    if (typeof cash === "number" && Number.isFinite(cash) && cash + 0.005 < amountDollars) {
      return {
        ok: false,
        reason: `Approval no longer valid: BUY reserved $${amountDollars.toFixed(2)} but only $${cash.toFixed(2)} cash remains. Re-propose against current cash.`,
      };
    }
    // A limit BUY must not fill above the manager's max price.
    if (maxPrice != null && typeof quote === "number" && Number.isFinite(quote) && quote > maxPrice + 1e-9) {
      return {
        ok: false,
        reason: `Approval no longer valid: BUY max price $${maxPrice} but ${proposal.ticker} is $${quote}. Re-propose at the current price.`,
      };
    }
    return { ok: true };
  }

  if (side === "SELL") {
    // The shares the SELL intends to reduce must still be held.
    const impliedShares = maxPrice && maxPrice > 0 ? amountDollars / maxPrice : null;
    if (
      impliedShares != null &&
      typeof shares === "number" &&
      Number.isFinite(shares) &&
      shares + 1e-6 < impliedShares
    ) {
      return {
        ok: false,
        reason: `Approval no longer valid: SELL implies ~${impliedShares.toFixed(4)} shares of ${proposal.ticker} but only ${shares} are held now. Re-propose against the current position.`,
      };
    }
    // A limit SELL must not fill below the manager's floor.
    if (maxPrice != null && typeof quote === "number" && Number.isFinite(quote) && quote + 1e-9 < maxPrice) {
      return {
        ok: false,
        reason: `Approval no longer valid: SELL floor $${maxPrice} but ${proposal.ticker} is $${quote}. Re-propose at the current price.`,
      };
    }
    return { ok: true };
  }

  return { ok: false, reason: `Unknown side "${side}" — cannot validate approval.` };
}

/** Throwing wrapper for money-path call sites that must fail loudly + closed. */
export function assertApprovalStillValid(proposal, current) {
  const result = checkApprovalStillValid(proposal, current);
  if (!result.ok) throw new Error(result.reason);
}
