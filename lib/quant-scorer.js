/**
 * Cross-sectional metric registry: each metric is read from a candidate
 * (fundamentals + momentum) and normalized 0-100 relative to the rest of
 * the watchlist before being combined by config/weights.json.
 */
export const METRICS = [
  { id: "momentum_3m", higherIsBetter: true, get: (c) => c.momentum3m },
  { id: "momentum_1m", higherIsBetter: true, get: (c) => c.momentum1m },
  { id: "revenueGrowth", higherIsBetter: true, get: (c) => c.raw?.financialData?.revenueGrowth },
  { id: "earningsGrowth", higherIsBetter: true, get: (c) => c.raw?.financialData?.earningsGrowth },
  { id: "profitMargins", higherIsBetter: true, get: (c) => c.raw?.financialData?.profitMargins },
  { id: "returnOnEquity", higherIsBetter: true, get: (c) => c.raw?.financialData?.returnOnEquity },
  { id: "trailingPE", higherIsBetter: false, get: (c) => c.raw?.summaryDetail?.trailingPE },
  { id: "debtToEquity", higherIsBetter: false, get: (c) => c.raw?.financialData?.debtToEquity },
  { id: "pegRatio", higherIsBetter: false, get: (c) => c.raw?.defaultKeyStatistics?.pegRatio },
];

/** Min-max normalize a list of values to 0-100, flipping direction if lower is better. Missing values map to a neutral 50. */
function normalizeStat(values, higherIsBetter = true) {
  const valid = values.filter((v) => v != null && !Number.isNaN(v));
  if (!valid.length) return values.map(() => 50);
  const lo = Math.min(...valid);
  const hi = Math.max(...valid);
  if (hi === lo) return values.map(() => 50);
  return values.map((v) => {
    // Missing data is UNKNOWN, not worst-in-class — mapping it to 0 silently
    // dragged real candidates (e.g. no reported PEG) below actual junk.
    if (v == null || Number.isNaN(v)) return 50;
    const raw = ((v - lo) / (hi - lo)) * 100;
    return higherIsBetter ? raw : 100 - raw;
  });
}

/**
 * Scores candidates (fundamentals + momentum) using cross-sectional normalization
 * and the given weights (config/weights.json's quant_weights). Returns candidates
 * sorted by descending quantScore, each annotated with quantScore + breakdown.
 */
export function scoreCandidates(candidates, weights) {
  const normalized = {};
  for (const c of candidates) normalized[c.ticker] = {};

  for (const m of METRICS) {
    const values = candidates.map((c) => m.get(c));
    const normed = normalizeStat(values, m.higherIsBetter);
    candidates.forEach((c, i) => {
      normalized[c.ticker][m.id] = Math.round(normed[i] * 10) / 10;
    });
  }

  return candidates
    .map((c) => {
      let score = 0;
      for (const [id, weight] of Object.entries(weights)) {
        score += (normalized[c.ticker][id] ?? 50) * weight;
      }
      return {
        ...c,
        quantScore: Math.round(score * 100) / 100,
        breakdown: normalized[c.ticker],
      };
    })
    .sort((a, b) => b.quantScore - a.quantScore);
}
