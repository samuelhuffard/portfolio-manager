/** Pure, decimal-return metrics for the frozen backtest methodology. */

function finitePositive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function timestamp(value, path) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new TypeError(`${path} requires an ISO timestamp`);
  return parsed;
}

function returnValue(record) {
  return finitePositive(record?.totalReturnIndex) ?? finitePositive(record?.price);
}

function rounded(value) {
  return value == null ? null : Number(value.toFixed(12));
}

/** Uses supplied total-return indices when available, otherwise split-adjusted prices. */
export function totalReturn(entry, exit) {
  const start = returnValue(entry);
  const end = returnValue(exit);
  return start == null || end == null ? null : rounded((end / start) - 1);
}

export function maximumExcursions({ entry, path = [] } = {}) {
  const start = returnValue(entry);
  if (start == null) return { maxAdverseExcursion: null, maxFavorableExcursion: null };
  const returns = path.map(returnValue).filter((value) => value != null).map((value) => (value / start) - 1);
  if (!returns.length) return { maxAdverseExcursion: null, maxFavorableExcursion: null };
  return {
    maxAdverseExcursion: rounded(Math.min(0, ...returns)),
    maxFavorableExcursion: rounded(Math.max(0, ...returns)),
  };
}

export function maximumDrawdown({ entry, path = [] } = {}) {
  const values = [returnValue(entry), ...path.map(returnValue)].filter((value) => value != null);
  if (!values.length) return null;
  let peak = values[0];
  let drawdown = 0;
  for (const value of values) {
    peak = Math.max(peak, value);
    drawdown = Math.min(drawdown, (value / peak) - 1);
  }
  return rounded(drawdown);
}

export function holdingPeriodDays({ entryAt, exitAt } = {}) {
  if (!entryAt || !exitAt) return null;
  return rounded((timestamp(exitAt, "exitAt") - timestamp(entryAt, "entryAt")) / 86400000);
}

export function computeForwardMetrics({ securityEntry, securityExit, benchmarkEntry = null, benchmarkExit = null, pricePath = [] } = {}) {
  const forwardTotalReturn = totalReturn(securityEntry, securityExit);
  const benchmarkTotalReturn = totalReturn(benchmarkEntry, benchmarkExit);
  const excursions = maximumExcursions({ entry: securityEntry, path: pricePath });
  return {
    forwardTotalReturn,
    benchmarkTotalReturn,
    forwardExcessReturn: forwardTotalReturn == null || benchmarkTotalReturn == null ? null : rounded(forwardTotalReturn - benchmarkTotalReturn),
    ...excursions,
    maxDrawdown: maximumDrawdown({ entry: securityEntry, path: pricePath }),
    holdingPeriodDays: holdingPeriodDays({ entryAt: securityEntry?.executableAt ?? securityEntry?.completedAt, exitAt: securityExit?.completedAt }),
  };
}

/** Applies explicit entry/exit fractional costs; no default cost assumption exists. */
export function applyTransactionCosts({ grossReturn, entryCostRate, exitCostRate } = {}) {
  if (!Number.isFinite(grossReturn)) return null;
  if (![entryCostRate, exitCostRate].every((value) => Number.isFinite(value) && value >= 0 && value < 1)) {
    throw new TypeError("Transaction cost rates must be finite decimal fractions in [0, 1)");
  }
  return rounded(((1 - entryCostRate) * (1 + grossReturn) * (1 - exitCostRate)) - 1);
}

export function turnover({ trades = [], averageCapital = null } = {}) {
  const tradedNotional = trades.reduce((sum, trade) => sum + (finitePositive(trade?.notional) ?? 0), 0);
  const capital = finitePositive(averageCapital);
  return {
    tradedNotional: rounded(tradedNotional),
    turnover: capital == null ? null : rounded(tradedNotional / capital),
  };
}

export function wilsonInterval(successes, sampleSize, z = 1.96) {
  if (!Number.isInteger(successes) || !Number.isInteger(sampleSize) || successes < 0 || sampleSize <= 0 || successes > sampleSize) return null;
  const p = successes / sampleSize;
  const denominator = 1 + (z ** 2 / sampleSize);
  const center = (p + (z ** 2 / (2 * sampleSize))) / denominator;
  const margin = z * Math.sqrt((p * (1 - p) / sampleSize) + (z ** 2 / (4 * sampleSize ** 2))) / denominator;
  return { lower: rounded(center - margin), upper: rounded(center + margin) };
}

/**
 * Caller supplies the hit definition. Without one, hit metrics intentionally
 * stay null rather than silently adopting the weekly-review convention.
 */
export function summarizeSamples({ outcomes = [], hitDefinition = null } = {}) {
  const rows = Array.isArray(outcomes) ? outcomes : [];
  const matured = rows.filter((row) => row.status === "matured");
  const immature = rows.filter((row) => row.status === "immature");
  const unavailable = rows.filter((row) => row.status === "unavailable");
  const excluded = rows.filter((row) => row.status === "excluded");
  const hitRows = typeof hitDefinition === "function" ? matured.map((row) => Boolean(hitDefinition(row))) : [];
  const hits = hitRows.filter(Boolean).length;
  const returns = matured.map((row) => row.metrics?.forwardTotalReturn).filter(Number.isFinite);
  const excessReturns = matured.map((row) => row.metrics?.forwardExcessReturn).filter(Number.isFinite);
  return {
    total: rows.length,
    matured: matured.length,
    immature: immature.length,
    unavailable: unavailable.length,
    excluded: excluded.length,
    missing: unavailable.length,
    hits: typeof hitDefinition === "function" ? hits : null,
    hitRate: typeof hitDefinition === "function" && matured.length ? rounded(hits / matured.length) : null,
    confidenceInterval95: typeof hitDefinition === "function" ? wilsonInterval(hits, matured.length) : null,
    averageForwardTotalReturn: returns.length ? rounded(returns.reduce((sum, value) => sum + value, 0) / returns.length) : null,
    averageForwardExcessReturn: excessReturns.length ? rounded(excessReturns.reduce((sum, value) => sum + value, 0) / excessReturns.length) : null,
  };
}

export default computeForwardMetrics;
