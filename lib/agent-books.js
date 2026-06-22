function round2(value) {
  return Math.round(value * 100) / 100;
}

/**
 * Computes one agent's attributed book against the shared portfolio: which open
 * lots are tagged to this agent, their unrealized P&L at current prices, and the
 * realized P&L / win rate from this agent's closed lots (via Trade Ledger sells).
 * Pure function — caller supplies already-fetched `lots` (readAllLots) and `trades`
 * (readTradeLedger) plus a `currentPrices` map of ticker -> price.
 */
export function computeAgentBook(agentId, { lots, trades, currentPrices }) {
  const openLots = lots.filter((lot) => lot.agentId === agentId && lot.status === "OPEN" && lot.sharesOpen > 0);
  const positionsByTicker = new Map();
  for (const lot of openLots) {
    const price = currentPrices[lot.ticker] ?? null;
    const existing = positionsByTicker.get(lot.ticker) ?? { ticker: lot.ticker, sharesOpen: 0, costBasis: 0 };
    existing.sharesOpen += lot.sharesOpen;
    existing.costBasis += lot.sharesOpen * lot.costPerShare;
    positionsByTicker.set(lot.ticker, existing);
  }

  const positions = [...positionsByTicker.values()].map((p) => {
    const price = currentPrices[p.ticker] ?? null;
    const marketValue = price != null ? price * p.sharesOpen : null;
    const unrealizedGain = marketValue != null ? marketValue - p.costBasis : null;
    return {
      ticker: p.ticker,
      sharesOpen: round2(p.sharesOpen),
      costBasis: round2(p.costBasis),
      marketValue: marketValue != null ? round2(marketValue) : null,
      unrealizedGain: unrealizedGain != null ? round2(unrealizedGain) : null,
    };
  });

  const closedTrades = trades.filter((t) => t.agentId === agentId && t.side === "SELL" && t.realizedGain != null);
  const realizedGain = round2(closedTrades.reduce((sum, t) => sum + t.realizedGain, 0));
  const wins = closedTrades.filter((t) => t.realizedGain > 0).length;
  const winRatePct = closedTrades.length ? round2((wins / closedTrades.length) * 100) : null;

  const unrealizedGain = round2(positions.reduce((sum, p) => sum + (p.unrealizedGain ?? 0), 0));

  return {
    agentId,
    positions,
    unrealizedGain,
    realizedGain,
    totalGain: round2(unrealizedGain + realizedGain),
    closedTradeCount: closedTrades.length,
    winRatePct,
  };
}
