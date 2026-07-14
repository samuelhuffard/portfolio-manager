import { createHash } from "node:crypto";
import { buildInventory, canonicalDecimal } from "./pg/inventory.js";

export const HOLDINGS_QUOTE_SOURCE = "yahoo-finance2:quote";
export const HOLDINGS_QUOTE_SNAPSHOT_VERSION = "yahoo-quote-set-v1";

const HOLDINGS_MARKER_INVENTORY = {
  key: "ticker",
  fields: ["ticker", "shares", "currentPrice", "marketValue"],
  numericFields: ["shares", "currentPrice", "marketValue"],
  numericPrecisions: { shares: 8, currentPrice: 8, marketValue: 2 },
};

export function roundDecimalNumber(value, precision) {
  if (value == null || value === "") return null;
  const rounded = Number(canonicalDecimal(value, precision));
  if (!Number.isFinite(rounded)) throw new TypeError(`value must be a finite decimal: ${String(value)}`);
  return rounded;
}

/** One canonical monetary projection feeds both authoritative and shadow writes. */
export function canonicalizeHoldingsForPersistence(holdings = []) {
  return holdings.map((holding) => ({
    ...holding,
    marketValue: holding.marketValue == null ? null : roundDecimalNumber(holding.marketValue, 2),
    costBasis: holding.costBasis == null ? null : roundDecimalNumber(holding.costBasis, 2),
    gainLoss: holding.gainLoss == null ? null : roundDecimalNumber(holding.gainLoss, 2),
  }));
}

/**
 * Bind quote provenance to the exact held units, provider price, and resulting
 * market value written to Holdings. This prevents a stale marker from surviving
 * a manual or interleaved edit to any input that produced the valuation.
 */
export function buildHoldingsValuationDigest(holdings = []) {
  const rows = holdings
    .map((holding) => Array.isArray(holding)
      ? { ticker: holding[0], shares: holding[2], currentPrice: holding[4], marketValue: holding[5] }
      : {
          ticker: holding?.ticker,
          shares: holding?.shares,
          currentPrice: holding?.currentPrice,
          marketValue: holding?.marketValue,
        })
    .filter((holding) => String(holding.ticker ?? "").trim() !== "")
    .map((holding) => ({
      ticker: String(holding.ticker).trim().toUpperCase(),
      shares: holding.shares,
      currentPrice: holding.currentPrice,
      marketValue: holding.marketValue,
    }));
  return buildInventory(rows, HOLDINGS_MARKER_INVENTORY).digest;
}

function quoteInstant(value) {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null;
  const normalized = typeof value === "number" && value > 0 && value < 1e12 ? value * 1000 : value;
  const date = new Date(normalized);
  return Number.isFinite(date.getTime()) ? date : null;
}

/**
 * Identify the exact provider quote set used to value the Holdings write.
 * Any missing price/time makes the replaceable valuation explicitly
 * non-comparable; transactional holdings still continue independently.
 */
export function buildHoldingsQuoteSnapshot(quotes, tickers) {
  const symbols = [...new Set((tickers ?? []).map((ticker) => String(ticker).trim().toUpperCase()).filter(Boolean))].sort();
  if (!symbols.length) return null;
  const items = [];
  for (const ticker of symbols) {
    const quote = quotes?.[ticker];
    const price = Number(quote?.regularMarketPrice);
    const timestamp = quoteInstant(quote?.regularMarketTime);
    if (!Number.isFinite(price) || !timestamp) return null;
    items.push({ ticker, price, timestamp: timestamp.toISOString() });
  }
  const digest = createHash("sha256").update(JSON.stringify(items)).digest("hex");
  const quoteTimestamp = items.reduce((latest, item) => item.timestamp > latest ? item.timestamp : latest, items[0].timestamp);
  return {
    quoteSnapshotVersion: `${HOLDINGS_QUOTE_SNAPSHOT_VERSION}:${digest}`,
    quoteSource: HOLDINGS_QUOTE_SOURCE,
    quoteTimestamp,
  };
}
