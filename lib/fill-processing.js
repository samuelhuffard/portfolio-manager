import { matchTradeToApprovedProposal } from "./agent-attribution.js";
import { openLot, consumeLotsFIFO, applyLotUpdates } from "./tax-lots.js";

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
export function planFillProcessing({ fills = [], existingOrderIds = [], openProposals = [], lots = [] }) {
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
    const trade = { ticker: fill.ticker, side: fill.side, shares: fill.shares, price: fill.price, amount: fill.amount, date: fill.date };
    const { agentId, proposalId } = matchTradeToApprovedProposal(trade, candidates);
    // A proposal can only fulfill one fill — drop it from the pool so a second
    // same-ticker/side fill doesn't re-match it (which used to throw and abort the batch).
    if (proposalId) candidates = candidates.filter((p) => p.id !== proposalId);

    let realizedGain = null;
    if (fill.side === "BUY") {
      const lot = openLot({ ticker: fill.ticker, shares: fill.shares, costPerShare: fill.price, date: fill.date, agentId });
      newLots.push(lot);
      workingLots = [...workingLots, lot];
    } else if (fill.side === "SELL") {
      try {
        const { realizedGain: gain, updatedLots } = consumeLotsFIFO(workingLots, fill.ticker, fill.shares, fill.price);
        realizedGain = gain;
        workingLots = applyLotUpdates(workingLots, updatedLots);
        for (const updated of updatedLots) lotUpdatesById.set(updated.lotId, updated);
      } catch (err) {
        warnings.push(`Could not apply FIFO consumption for SELL ${fill.ticker}: ${err.message}`);
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
      realizedGain,
    });
  }

  return { freshFills, skipped, tradeRows, newLots, lotUpdates: [...lotUpdatesById.values()], warnings };
}
