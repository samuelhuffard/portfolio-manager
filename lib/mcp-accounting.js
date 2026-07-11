import { appendLots, appendTradeLedgerEntries, applyLotUpdatesToSheet, readAllLots, readTradeLedger } from "./sheets.js";
import { consumeLotsFIFO, openLot } from "./tax-lots.js";
import { consumeOwnedThenUnattributedFIFO } from "./owned-lots.js";
import { LOT_UNATTRIBUTED } from "../contracts/lot.js";
import { assertApprovedProposalSignature } from "./proposal-signature.js";
import { ownershipEnforcementEnabled } from "./ownership-flag.js";
import { recordReconciliationNeeded } from "./redis.js";

const AMOUNT_TOLERANCE_PCT = 0.15;

function round2(value) {
  return Math.round(value * 100) / 100;
}

function parsePositiveNumber(value, label) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${label} must be a positive number.`);
  return parsed;
}

function normalizeSide(side) {
  const normalized = String(side ?? "").trim().toUpperCase();
  if (normalized !== "BUY" && normalized !== "SELL") throw new Error(`side must be BUY or SELL, got: ${side}`);
  return normalized;
}

export function validateMcpFillInput({ proposal, existingTrades = [], orderId, ticker, side, shares, price, agentId, signatureSecret }) {
  if (!proposal) throw new Error("Approved proposal not found.");
  if (proposal.status !== "ApprovedForBrokerReview") {
    throw new Error(`Proposal ${proposal.id} is not approved for broker review.`);
  }
  assertApprovedProposalSignature(proposal, signatureSecret !== undefined ? { secret: signatureSecret } : {});
  if (proposal.fulfilledAt) throw new Error(`Proposal ${proposal.id} is already fulfilled.`);
  if (!orderId || !String(orderId).trim()) throw new Error("orderId is required.");

  const normalizedOrderId = String(orderId).trim();
  if (existingTrades.some((trade) => trade.orderId === normalizedOrderId)) {
    throw new Error(`Order ${normalizedOrderId} is already recorded in Trade Ledger.`);
  }

  const normalizedTicker = String(ticker ?? "").trim().toUpperCase();
  if (!normalizedTicker) throw new Error("ticker is required.");
  if (normalizedTicker !== proposal.ticker) {
    throw new Error(`Ticker mismatch: fill ${normalizedTicker}, proposal ${proposal.ticker}.`);
  }

  const normalizedSide = normalizeSide(side);
  if (normalizedSide !== proposal.side) {
    throw new Error(`Side mismatch: fill ${normalizedSide}, proposal ${proposal.side}.`);
  }

  const normalizedAgentId = agentId ?? proposal.agentId;
  if (normalizedAgentId !== proposal.agentId) {
    throw new Error(`Agent mismatch: fill ${normalizedAgentId}, proposal ${proposal.agentId}.`);
  }

  const parsedShares = parsePositiveNumber(shares, "shares");
  const parsedPrice = parsePositiveNumber(price, "price");
  const amount = round2(parsedShares * parsedPrice);

  if (proposal.maxPrice != null && normalizedSide === "BUY" && parsedPrice > proposal.maxPrice) {
    throw new Error(`Fill price $${parsedPrice} exceeds proposal maxPrice $${proposal.maxPrice}.`);
  }

  // BUYs must land near the proposed size in both directions. SELLs may fill
  // BELOW the proposed dollars (the executor sells the entire remaining
  // position when it's worth less than the proposal) — only overshoot is an error.
  const amountDiffPct = (amount - proposal.amountDollars) / proposal.amountDollars;
  const overshot = amountDiffPct > AMOUNT_TOLERANCE_PCT;
  const undershot = amountDiffPct < -AMOUNT_TOLERANCE_PCT;
  if (overshot || (normalizedSide === "BUY" && undershot)) {
    throw new Error(
      `Fill amount $${amount} differs from proposal $${proposal.amountDollars} by ${(amountDiffPct * 100).toFixed(1)}%.`
    );
  }

  return {
    date: new Date().toISOString(),
    ticker: normalizedTicker,
    side: normalizedSide,
    shares: parsedShares,
    price: parsedPrice,
    amount,
    orderId: normalizedOrderId,
    agentId: proposal.agentId,
    proposalId: proposal.id,
    realizedGain: null,
  };
}

// `enforceOwnership` (OFF by default — flipping it on is a reviewed money-path
// change, roadmap Wave 1): when true, an attributed SELL only consumes lots its
// own strategy opened (invariant #3). Here the fill's agent is always the
// approved proposal's agent (validated upstream), so the only fallback is a
// genuinely unattributed agent.
export function applyFillToLots(trade, lots, { enforceOwnership = false } = {}) {
  if (trade.side === "BUY") {
    return {
      trade: { ...trade, realizedGain: null },
      newLots: [
        openLot({
          ticker: trade.ticker,
          shares: trade.shares,
          costPerShare: trade.price,
          date: trade.date.slice(0, 10),
          agentId: trade.agentId,
        }),
      ],
      updatedLots: [],
    };
  }

  const owned = enforceOwnership && trade.agentId && trade.agentId !== LOT_UNATTRIBUTED;
  if (owned) {
    try {
      const { realizedGain, updatedLots } = consumeOwnedThenUnattributedFIFO(lots, {
        ticker: trade.ticker, agentId: trade.agentId, sharesToSell: trade.shares, sellPricePerShare: trade.price,
      });
      return { trade: { ...trade, realizedGain }, newLots: [], updatedLots, needsReconciliation: false };
    } catch (err) {
      // Ownership-scoped SELL can't reconcile from owned/unattributed lots. The
      // broker order already executed, so the caller still records the trade, but
      // must persist a reconciliation record and NOT mark the proposal fulfilled
      // (Codex #1 / Decision A) — never fabricate a realized gain or cross into
      // another strategy's lots.
      return {
        trade: { ...trade, realizedGain: null },
        newLots: [],
        updatedLots: [],
        needsReconciliation: true,
        reconciliationReason: err.message,
      };
    }
  }

  // Legacy account-wide path (flag off) — unchanged; an over-sell throws.
  const { realizedGain, updatedLots } = consumeLotsFIFO(lots, trade.ticker, trade.shares, trade.price);
  return { trade: { ...trade, realizedGain }, newLots: [], updatedLots, needsReconciliation: false };
}

export async function recordMcpFill({ sheets, spreadsheetId, sheetIds, proposal, orderId, ticker, side, shares, price, agentId }) {
  const [existingTrades, lots] = await Promise.all([
    readTradeLedger(sheets, spreadsheetId),
    readAllLots(sheets, spreadsheetId),
  ]);

  const normalizedOrderId = String(orderId ?? "").trim();
  const existingTrade = existingTrades.find((trade) => trade.orderId === normalizedOrderId);
  if (existingTrade) {
    if (existingTrade.proposalId !== proposal?.id) {
      throw new Error(`Order ${normalizedOrderId} is already recorded against another proposal.`);
    }
    return { trade: existingTrade, newLots: [], updatedLots: [], alreadyRecorded: true };
  }

  const tradeInput = validateMcpFillInput({
    proposal,
    existingTrades,
    orderId,
    ticker,
    side,
    shares,
    price,
    agentId,
  });
  const { trade, newLots, updatedLots, needsReconciliation, reconciliationReason } = applyFillToLots(
    tradeInput,
    lots,
    { enforceOwnership: ownershipEnforcementEnabled() }
  );

  // The broker order already executed — record the trade either way (ledger =
  // truth about what happened at the broker). Lots only move when reconciled.
  await appendTradeLedgerEntries(sheets, spreadsheetId, sheetIds["Trade Ledger"], [trade]);
  if (newLots.length) await appendLots(sheets, spreadsheetId, sheetIds["Lots"], newLots);
  if (updatedLots.length) await applyLotUpdatesToSheet(sheets, spreadsheetId, updatedLots);

  if (needsReconciliation) {
    // Fail CLOSED: the durable record MUST persist. If it can't, recordReconciliationNeeded
    // throws — we surface it loudly and let the caller leave the proposal unfulfilled;
    // we never silently proceed as though the mismatch is tracked.
    await recordReconciliationNeeded({
      orderId: normalizedOrderId, proposalId: proposal?.id, ticker: trade.ticker,
      side: trade.side, shares: trade.shares, reason: reconciliationReason ?? "ownership-scoped SELL could not consume owned/unattributed lots",
    });
  }

  return { trade, newLots, updatedLots, needsReconciliation: Boolean(needsReconciliation) };
}
