import { TICKER_RE } from "../contracts/proposal.js";

const number = (value) => (value == null || value === "" ? null : Number(value));
const finite = (value) => Number.isFinite(value);

// The Holdings writer binds this metadata to the exact rounded sheet rows with
// an inventory digest, so a later manual edit cannot inherit the marker.
export function buildMcpHoldingsQuoteSnapshot(timestamp) {
  const instant = new Date(timestamp);
  if (!Number.isFinite(instant.getTime())) throw new Error("MCP holdings snapshot requires a valid timestamp.");
  return {
    quoteSnapshotVersion: "robinhood-mcp-positions-v1",
    quoteSource: "robinhood-trading-mcp:get_equity_positions",
    quoteTimestamp: instant.toISOString(),
  };
}

/** Validate the fixed read-only MCP snapshot shape before it reaches Sheets. */
export function parseMcpHoldingsInput(input) {
  if (!input || !Array.isArray(input.positions)) throw new Error('Input must have a "positions" array.');
  if (!("cash" in input) && !("buying_power" in input)) {
    throw new Error("Input must include explicit cash or buying_power; refusing to assume $0.");
  }
  const seenTickers = new Set();
  const holdings = input.positions.map((p, index) => {
    const ticker = String(p?.ticker ?? p?.symbol ?? "").trim().toUpperCase();
    const shares = number(p?.shares ?? p?.quantity);
    const avgCost = number(p?.avgCost ?? p?.average_buy_price);
    const currentPrice = number(p?.currentPrice ?? p?.current_price ?? p?.last_trade_price);
    if (!TICKER_RE.test(ticker)) throw new Error(`positions[${index}] has an invalid ticker.`);
    if (seenTickers.has(ticker)) throw new Error(`positions[${index}] duplicates ${ticker}.`);
    seenTickers.add(ticker);
    if (!finite(shares) || shares < 0) throw new Error(`positions[${index}] has invalid shares.`);
    if (!finite(avgCost) || avgCost < 0) throw new Error(`positions[${index}] has invalid average cost.`);
    if (!finite(currentPrice) || currentPrice <= 0) throw new Error(`positions[${index}] has invalid current price.`);
    const marketValue = number(p?.marketValue ?? p?.equity ?? p?.market_value) ?? shares * currentPrice;
    const costBasis = number(p?.costBasis ?? p?.cost_basis) ?? shares * avgCost;
    const gainLoss = number(p?.gainLoss ?? p?.equity_change ?? p?.unrealized_profit_loss) ?? marketValue - costBasis;
    let gainLossPct = number(p?.gainLossPct ?? p?.percent_change ?? p?.unrealized_profit_loss_percentage);
    if (gainLossPct != null && Math.abs(gainLossPct) < 10 && costBasis > 0) gainLossPct *= 100;
    if (![marketValue, costBasis, gainLoss].every(finite)) throw new Error(`positions[${index}] has invalid value fields.`);
    return { ticker, name: p?.name ?? p?.simpleName ?? "", shares, avgCost, currentPrice, marketValue, costBasis, gainLoss, gainLossPct };
  });
  const cash = number(input.cash ?? input.buying_power);
  if (!finite(cash) || cash < 0) throw new Error("Input cash/buying_power must be a finite non-negative number.");
  return { holdings, cash };
}
