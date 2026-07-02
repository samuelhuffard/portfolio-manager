import { appendLots, appendTradeLedgerEntries, applyLotUpdatesToSheet, readAllLots, readTradeLedger } from "./sheets.js";
import { consumeLotsFIFO, openLot } from "./tax-lots.js";
import { assertApprovedProposalSignature } from "./proposal-signature.js";

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

export function applyFillToLots(trade, lots) {
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

  const { realizedGain, updatedLots } = consumeLotsFIFO(lots, trade.ticker, trade.shares, trade.price);
  return {
    trade: { ...trade, realizedGain },
    newLots: [],
    updatedLots,
  };
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
  const { trade, newLots, updatedLots } = applyFillToLots(tradeInput, lots);

  await appendTradeLedgerEntries(sheets, spreadsheetId, sheetIds["Trade Ledger"], [trade]);
  if (newLots.length) await appendLots(sheets, spreadsheetId, sheetIds["Lots"], newLots);
  if (updatedLots.length) await applyLotUpdatesToSheet(sheets, spreadsheetId, updatedLots);

  return { trade, newLots, updatedLots };
}
