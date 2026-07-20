// The Holdings sheet projects broker shares to four decimals. Allow only that
// display-rounding residue, and only when it is also worth no more than $0.05
// at the sheet-implied price. Either larger share or dollar drift fails closed.
const SHARE_TOLERANCE = 1e-4;
const DOLLAR_TOLERANCE = 0.05;

function finiteNonnegative(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function round(value, places = 4) {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

/**
 * Project one agent's research holdings from verified strategy lots while
 * reconciling the complete open-lot book to the aggregate Holdings snapshot.
 * Any mismatch fails closed before an agent can monitor or size a SELL.
 */
export function projectAgentOwnedHoldings({ agentId, lots = [], holdings = [] } = {}) {
  if (!agentId || agentId === "unattributed") throw new TypeError("a named research agent is required");

  const holdingByTicker = new Map();
  for (const holding of holdings) {
    const ticker = String(holding?.ticker ?? "").trim().toUpperCase();
    if (!ticker || holdingByTicker.has(ticker)) {
      throw new Error(`holding_ownership_invalid: duplicate or missing Holdings ticker ${ticker || "UNKNOWN"}`);
    }
    if (!finiteNonnegative(holding.shares) || !finiteNonnegative(holding.marketValue)) {
      throw new Error(`holding_ownership_invalid: ${ticker} has invalid shares or market value`);
    }
    holdingByTicker.set(ticker, { ...holding, ticker });
  }

  const aggregateLotShares = new Map();
  const ownedByTicker = new Map();
  for (const lot of lots) {
    if (lot?.status !== "OPEN" || Number(lot?.sharesOpen) <= 0) continue;
    const ticker = String(lot?.ticker ?? "").trim().toUpperCase();
    const sharesOpen = Number(lot.sharesOpen);
    if (!ticker || !finiteNonnegative(sharesOpen) || !finiteNonnegative(Number(lot.costPerShare))) {
      throw new Error("holding_ownership_invalid: open lot has malformed ticker, shares, or cost");
    }
    aggregateLotShares.set(ticker, (aggregateLotShares.get(ticker) ?? 0) + sharesOpen);
    if (lot.agentId === agentId) {
      const owned = ownedByTicker.get(ticker) ?? { ticker, shares: 0, costBasis: 0 };
      owned.shares += sharesOpen;
      owned.costBasis += sharesOpen * Number(lot.costPerShare);
      ownedByTicker.set(ticker, owned);
    }
  }

  const allTickers = new Set([...holdingByTicker.keys(), ...aggregateLotShares.keys()]);
  for (const ticker of allTickers) {
    const holding = holdingByTicker.get(ticker);
    const holdingShares = holding?.shares ?? 0;
    const lotShares = aggregateLotShares.get(ticker) ?? 0;
    const shareDelta = Math.abs(holdingShares - lotShares);
    if (shareDelta === 0) continue;
    const price = holding && holdingShares > 0 ? holding.marketValue / holdingShares : null;
    const dollarDelta = Number.isFinite(price) ? shareDelta * price : Infinity;
    const roundingOnly =
      Boolean(holding) &&
      lotShares > 0 &&
      shareDelta <= SHARE_TOLERANCE &&
      dollarDelta <= DOLLAR_TOLERANCE;
    if (!roundingOnly) {
      throw new Error(
        `holding_ownership_mismatch: ${ticker} Holdings shares ${holdingShares} do not match verified open-lot shares ${round(lotShares, 8)}`
      );
    }
  }

  const positions = [...ownedByTicker.values()]
    .sort((a, b) => a.ticker.localeCompare(b.ticker))
    .map((owned) => {
      const aggregate = holdingByTicker.get(owned.ticker);
      const price = aggregate.shares > 0 ? aggregate.marketValue / aggregate.shares : null;
      if (!finiteNonnegative(price)) {
        throw new Error(`holding_ownership_invalid: ${owned.ticker} cannot derive a current price from Holdings`);
      }
      const marketValue = owned.shares * price;
      return {
        ticker: owned.ticker,
        shares: round(owned.shares, 8),
        costBasis: round(owned.costBasis, 2),
        marketValue: round(marketValue, 2),
        returnPct: owned.costBasis > 0 ? round(((marketValue - owned.costBasis) / owned.costBasis) * 100, 4) : null,
      };
    });

  return {
    agentId,
    positions,
    tickers: positions.map((position) => position.ticker),
    positionSharesByTicker: Object.fromEntries(positions.map((position) => [position.ticker, position.shares])),
    positionValueByTicker: Object.fromEntries(positions.map((position) => [position.ticker, position.marketValue])),
    returnPctByTicker: Object.fromEntries(positions.map((position) => [position.ticker, position.returnPct])),
  };
}
