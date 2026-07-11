import { matchTradeToApprovedProposal } from "./agent-attribution.js";
import { openLot, consumeLotsFIFO, applyLotUpdates } from "./tax-lots.js";
import { consumeOwnedThenUnattributedFIFO } from "./owned-lots.js";
import { LOT_UNATTRIBUTED } from "../contracts/lot.js";

/**
 * Pure planning core of the fill-processing path, extracted from
 * jobs/holdings-sync.js so the money math is testable without Sheets/Redis
 * (docs/TEST_PLAN.md #10). Given detected Robinhood fills plus current
 * ledger/proposal/lot state, decides exactly what to write: Trade Ledger rows,
 * new lots, lot updates, and which proposals each fill fulfills. No I/O —
 * the caller persists the plan and logs skipped/warning entries.
 *
 * Tested in tests/fill-processing.test.js.
 */
// `enforceOwnership` (OFF by default — flipping it on is a reviewed money-path
// change, roadmap Wave 1): when true, an attributed SELL only consumes lots its
// own strategy opened (invariant #3), instead of the account-wide FIFO that can
// eat another strategy's oldest lots and corrupt attribution. Unattributed
// (legacy/manual) SELLs fall back to the account-wide path, since no strategy
// owns those lots. An attributed SELL that exceeds its own owned shares warns
// (batch survives) rather than reaching across strategies.
export function planFillProcessing({ fills = [], existingOrderIds = [], openProposals = [], lots = [], enforceOwnership = false, verifySignature } = {}) {
  // The Trade Ledger is the source of truth for "already recorded" — the
  // pm:last-fill-sync-at cursor alone can't prevent double-booking (e.g. the
  // post-trade sync kicked by /record-trade re-fetches the fill it just wrote).
  const seenOrderIds = new Set(existingOrderIds);
  const skipped = [];
  const freshFills = fills.filter((f) => {
    if (f.orderId && seenOrderIds.has(f.orderId)) {
      skipped.push(f);
      return false;
    }
    if (f.orderId) seenOrderIds.add(f.orderId); // also dedupe within this batch
    return true;
  });

  let workingLots = lots;
  let candidates = openProposals;
  const newLots = [];
  const tradeRows = [];
  const warnings = [];
  const lotUpdatesById = new Map();

  for (const fill of freshFills) {
    const trade = {
      ticker: fill.ticker,
      side: fill.side,
      shares: fill.shares,
      price: fill.price,
      amount: fill.amount,
      date: fill.date,
      refId: fill.refId ?? null,
    };
    const { agentId, proposalId } = matchTradeToApprovedProposal(trade, candidates, { verifySignature });
    // A proposal can only fulfill one fill — drop it from the pool so a second
    // same-ticker/side fill doesn't re-match it (which used to throw and abort the batch).
    if (proposalId) candidates = candidates.filter((p) => p.id !== proposalId);

    let realizedGain = null;
    let needsReconciliation = false;
    if (fill.side === "BUY") {
      const lot = openLot({ ticker: fill.ticker, shares: fill.shares, costPerShare: fill.price, date: fill.date, agentId });
      newLots.push(lot);
      workingLots = [...workingLots, lot];
    } else if (fill.side === "SELL") {
      const owned = enforceOwnership && agentId && agentId !== LOT_UNATTRIBUTED;
      try {
        const { realizedGain: gain, updatedLots } = owned
          ? consumeOwnedThenUnattributedFIFO(workingLots, { ticker: fill.ticker, agentId, sharesToSell: fill.shares, sellPricePerShare: fill.price })
          : consumeLotsFIFO(workingLots, fill.ticker, fill.shares, fill.price);
        realizedGain = gain;
        workingLots = applyLotUpdates(workingLots, updatedLots);
        for (const updated of updatedLots) lotUpdatesById.set(updated.lotId, updated);
      } catch (err) {
        if (owned) {
          // The broker position DID change, so we still record the trade — but
          // the ownership-scoped lot ledger could not be reconciled (the SELL
          // would have to cross another strategy's lots, or is un-consumable).
          // Flag it: the caller records the row, alerts, and must NOT mark the
          // proposal fulfilled until the lot accounting is repaired (Codex #1 /
          // Decision A). Never fabricate a realized gain here.
          needsReconciliation = true;
          warnings.push(`SELL ${fill.ticker} needs reconciliation — lot ledger not updated: ${err.message}`);
        } else {
          // Default account-wide path — preserve the legacy warn-and-record
          // behavior exactly (an over-sell records the row with null gain).
          warnings.push(`Could not apply FIFO consumption for SELL ${fill.ticker}: ${err.message}`);
        }
      }
    }

    tradeRows.push({
      date: fill.date,
      ticker: fill.ticker,
      side: fill.side,
      shares: fill.shares,
      price: fill.price,
      amount: fill.amount,
      orderId: fill.orderId,
      agentId,
      proposalId,
      needsReconciliation,
      realizedGain,
    });
  }

  return { freshFills, skipped, tradeRows, newLots, lotUpdates: [...lotUpdatesById.values()], warnings };
}
