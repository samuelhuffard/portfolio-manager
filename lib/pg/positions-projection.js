/**
 * Convert an authoritative Holdings read into the deliberately replaceable
 * Postgres positions projection. This contains no ledger or execution state.
 */
export function positionsProjectionFromHoldings(holdings = []) {
  if (!Array.isArray(holdings)) throw new TypeError("holdings must be an array");
  return holdings.map((holding) => ({
    ticker: holding.ticker,
    name: holding.name ?? null,
    shares: holding.shares,
    avgCost: holding.avgCost,
    costBasis: holding.costBasis,
    marketValue: holding.marketValue ?? null,
  }));
}
