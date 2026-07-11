// Ownership-scoped lot selection. Enforces roadmap invariant #3: a strategy may
// only SELL/reduce lots IT owns, and a SELL's realized P&L is attributed to that
// strategy's consumed lots — never a shared FIFO that eats another strategy's
// oldest lots and corrupts its attribution (the audit's shared-FIFO finding).
//
// Pure functions, no I/O. `consumeLotsFIFO` (lib/tax-lots.js) stays as the
// account-wide primitive; this wraps ownership on top so callers opt into the
// scoped, fail-closed behavior. Wiring the SELL path to prefer this is a
// separate, review-gated change.

import { consumeLotsFIFO } from "./tax-lots.js";
import { LOT_UNATTRIBUTED } from "../contracts/lot.js";

/** Open shares of `ticker` owned by `agentId` (excludes other strategies + unattributed). */
export function ownedOpenShares(openLots, ticker, agentId) {
  return openLots
    .filter(
      (lot) =>
        lot.ticker === ticker &&
        lot.status === "OPEN" &&
        lot.sharesOpen > 0 &&
        lot.agentId === agentId
    )
    .reduce((sum, lot) => sum + lot.sharesOpen, 0);
}

/**
 * Throws unless `agentId` owns at least `sharesToSell` open shares of `ticker`.
 * Fail-closed: an agent that owns nothing (or only borrowed the ticker from
 * another strategy's lots) cannot pass. `"unattributed"` can never be an owner
 * here — attributed strategies never own unattributed lots.
 */
export function assertAgentOwnsShares(openLots, ticker, agentId, sharesToSell) {
  if (!agentId || agentId === LOT_UNATTRIBUTED) {
    throw new Error(
      `SELL ownership check: a strategy SELL must name its owning agent, got "${agentId}". ` +
        "Unattributed/manual lots require an explicit reconciled decision, not a strategy proposal."
    );
  }
  if (!Number.isFinite(sharesToSell) || sharesToSell <= 0) {
    throw new Error("assertAgentOwnsShares: sharesToSell must be positive.");
  }
  const owned = ownedOpenShares(openLots, ticker, agentId);
  if (owned + 1e-6 < sharesToSell) {
    throw new Error(
      `SELL ownership violation: ${agentId} owns ${owned.toFixed(4)} open shares of ${ticker}, ` +
        `cannot sell ${sharesToSell}. A strategy may only sell lots it opened.`
    );
  }
}

/**
 * Ownership-scoped FIFO consumption: like `consumeLotsFIFO`, but only the
 * `agentId`'s own open lots of `ticker` are eligible. Fails closed if the agent
 * doesn't own enough, so it can never consume another strategy's lots.
 *
 * Returns the same `{ lotsConsumed, realizedGain, updatedLots }` shape as
 * `consumeLotsFIFO`, so callers can swap it in without changing downstream
 * accounting. Every consumed lot is guaranteed to carry `agentId`.
 */
export function consumeOwnedLotsFIFO(openLots, { ticker, agentId, sharesToSell, sellPricePerShare }) {
  assertAgentOwnsShares(openLots, ticker, agentId, sharesToSell);
  const ownedLots = openLots.filter((lot) => lot.agentId === agentId);
  return consumeLotsFIFO(ownedLots, ticker, sharesToSell, sellPricePerShare);
}

/** Open shares of `ticker` that are unattributed (owned by no strategy). */
function unattributedOpenShares(openLots, ticker) {
  return openLots
    .filter((lot) => lot.ticker === ticker && lot.status === "OPEN" && lot.sharesOpen > 0 && lot.agentId === LOT_UNATTRIBUTED)
    .reduce((sum, lot) => sum + lot.sharesOpen, 0);
}

/**
 * Consumes `agentId`'s OWN lots first, then tops up from UNATTRIBUTED (legacy/
 * manual) lots only — never another strategy's lots (Codex Decision A). Fails
 * closed if own + unattributed together cannot cover the sale, so a caller can
 * route the fill to reconciliation instead of silently crossing strategies or
 * booking a phantom SELL. Returns the same shape as `consumeLotsFIFO`.
 */
export function consumeOwnedThenUnattributedFIFO(openLots, { ticker, agentId, sharesToSell, sellPricePerShare }) {
  if (!agentId || agentId === LOT_UNATTRIBUTED) {
    throw new Error(`SELL ownership check: a strategy SELL must name its owning agent, got "${agentId}".`);
  }
  if (!Number.isFinite(sharesToSell) || sharesToSell <= 0) {
    throw new Error("consumeOwnedThenUnattributedFIFO: sharesToSell must be positive.");
  }
  const ownAvail = ownedOpenShares(openLots, ticker, agentId);
  const unattAvail = unattributedOpenShares(openLots, ticker);
  if (ownAvail + unattAvail + 1e-6 < sharesToSell) {
    throw new Error(
      `SELL cannot be reconciled from ownership: ${agentId} owns ${ownAvail.toFixed(4)} + ${unattAvail.toFixed(4)} unattributed ` +
        `open shares of ${ticker}, need ${sharesToSell}. Refusing to consume another strategy's lots.`
    );
  }

  const own = openLots.filter((lot) => lot.agentId === agentId);
  const unatt = openLots.filter((lot) => lot.agentId === LOT_UNATTRIBUTED);
  const lotsConsumed = [];
  const updatedLots = [];
  let realizedGain = 0;
  let remaining = sharesToSell;

  const fromOwn = Math.min(remaining, ownAvail);
  if (fromOwn > 1e-9) {
    const r = consumeLotsFIFO(own, ticker, fromOwn, sellPricePerShare);
    realizedGain += r.realizedGain;
    lotsConsumed.push(...r.lotsConsumed);
    updatedLots.push(...r.updatedLots);
    remaining -= fromOwn;
  }
  if (remaining > 1e-9) {
    const r = consumeLotsFIFO(unatt, ticker, remaining, sellPricePerShare);
    realizedGain += r.realizedGain;
    lotsConsumed.push(...r.lotsConsumed);
    updatedLots.push(...r.updatedLots);
    remaining -= remaining;
  }
  return { lotsConsumed, realizedGain: Math.round(realizedGain * 100) / 100, updatedLots };
}
