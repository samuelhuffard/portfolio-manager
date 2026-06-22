import { randomUUID } from "node:crypto";

const LEGACY_SORT_DATE = "0000-00-00";

function round4(value) {
  return Math.round(value * 10000) / 10000;
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

function sortKey(lot) {
  return lot.openDate === "legacy" ? LEGACY_SORT_DATE : lot.openDate;
}

/**
 * Creates a new open tax lot. Does not write anywhere — caller persists it (Lots tab).
 */
export function openLot({ ticker, shares, costPerShare, date, agentId, lotId }) {
  if (!Number.isFinite(shares) || shares <= 0) throw new Error("openLot: shares must be positive.");
  if (!Number.isFinite(costPerShare) || costPerShare < 0) throw new Error("openLot: costPerShare must be non-negative.");
  return {
    lotId: lotId || randomUUID(),
    ticker,
    openDate: date,
    agentId: agentId || "unattributed",
    costPerShare: round4(costPerShare),
    sharesOriginal: round4(shares),
    sharesOpen: round4(shares),
    status: "OPEN",
  };
}

/**
 * Consumes open lots for `ticker` FIFO (oldest openDate first; "legacy" lots are oldest)
 * until `sharesToSell` is covered. Returns the realized gain and the updated lot objects
 * (mutated copies — caller is responsible for writing the resulting state back to the Lots tab).
 *
 * Throws if there isn't enough open quantity to cover the sale.
 */
export function consumeLotsFIFO(openLots, ticker, sharesToSell, sellPricePerShare) {
  if (!Number.isFinite(sharesToSell) || sharesToSell <= 0) {
    throw new Error("consumeLotsFIFO: sharesToSell must be positive.");
  }
  if (!Number.isFinite(sellPricePerShare) || sellPricePerShare < 0) {
    throw new Error("consumeLotsFIFO: sellPricePerShare must be non-negative.");
  }

  const candidates = openLots
    .filter((lot) => lot.ticker === ticker && lot.status === "OPEN" && lot.sharesOpen > 0)
    .sort((a, b) => (sortKey(a) < sortKey(b) ? -1 : sortKey(a) > sortKey(b) ? 1 : 0));

  const availableShares = candidates.reduce((sum, lot) => sum + lot.sharesOpen, 0);
  if (availableShares + 1e-6 < sharesToSell) {
    throw new Error(
      `consumeLotsFIFO: only ${availableShares.toFixed(4)} open shares of ${ticker}, cannot sell ${sharesToSell}.`
    );
  }

  let remaining = sharesToSell;
  let realizedGain = 0;
  const lotsConsumed = [];
  const updatedLots = [];

  for (const lot of candidates) {
    if (remaining <= 1e-9) break;
    const sharesFromLot = Math.min(lot.sharesOpen, remaining);
    const gain = sharesFromLot * (sellPricePerShare - lot.costPerShare);
    realizedGain += gain;
    remaining -= sharesFromLot;

    lotsConsumed.push({
      lotId: lot.lotId,
      ticker,
      sharesConsumed: round4(sharesFromLot),
      costPerShare: lot.costPerShare,
      proceedsPerShare: sellPricePerShare,
      gain: round2(gain),
      agentId: lot.agentId,
    });

    const sharesOpenAfter = round4(lot.sharesOpen - sharesFromLot);
    updatedLots.push({
      ...lot,
      sharesOpen: sharesOpenAfter,
      status: sharesOpenAfter <= 1e-6 ? "CLOSED" : "OPEN",
    });
  }

  return { lotsConsumed, realizedGain: round2(realizedGain), updatedLots };
}

/**
 * Applies a set of `updatedLots` (from consumeLotsFIFO) onto a full lot list, replacing
 * the matching lotId entries. Lots not touched by the consumption pass through unchanged.
 */
export function applyLotUpdates(allLots, updatedLots) {
  const byId = new Map(updatedLots.map((lot) => [lot.lotId, lot]));
  return allLots.map((lot) => byId.get(lot.lotId) ?? lot);
}
