/**
 * Pure derivations of the v2.1 EDGAR-sourced metrics from parsed XBRL series
 * (lib/edgar-facts.js). No I/O. See docs/MANDATE-V2-INGESTION.md.
 *
 * These compute the raw quantities; peer-relative ranking happens later in
 * lib/peer-scoring.js against the industry distribution. First-cut definitions are
 * marked; the per-agent metric definitions (Agent One = acceleration, Two = YoY,
 * Three = multi-year consistency) bind to these via config in a follow-up — this
 * module exposes all variants so that binding needs no recompute.
 */
import {
  CONCEPTS,
  quarterlySeries,
  annualSeries,
  latestInstant,
} from "./edgar-facts.js";

const DAY = 86400000;
const finite = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Trailing-twelve-month sum of the last 4 quarterly values, or null if <4. */
export function ttm(series) {
  if (!series || series.length < 4) return null;
  return series.slice(-4).reduce((s, f) => s + f.val, 0);
}

/**
 * Year-over-year growth for each quarter that has a match ~365 days earlier.
 * @returns [{ end, growth }] oldest→newest (growth as a fraction, e.g. 0.25)
 */
export function yoyGrowthSeries(quarters) {
  const out = [];
  for (const q of quarters) {
    const target = Date.parse(q.end) - 365 * DAY;
    const prior = quarters.find((p) => Math.abs(Date.parse(p.end) - target) <= 20 * DAY);
    if (prior && prior.val !== 0) out.push({ end: q.end, growth: (q.val - prior.val) / Math.abs(prior.val) });
  }
  return out;
}

const last = (a) => (a.length ? a[a.length - 1] : null);
const prev = (a) => (a.length >= 2 ? a[a.length - 2] : null);

/** Align two quarterly series by end date → [{ end, a, b }]. */
function alignByEnd(seriesA, seriesB) {
  const bByEnd = new Map(seriesB.map((f) => [f.end, f.val]));
  return seriesA.filter((f) => bByEnd.has(f.end)).map((f) => ({ end: f.end, a: f.val, b: bByEnd.get(f.end) }));
}

/**
 * Compute the full EDGAR-derived fundamentals bundle for one company.
 * All fields are numbers or null. Nulls flow to the scoring engine's vendor-lag
 * rescale (never scored zero).
 */
export function deriveFundamentalMetrics(companyfacts) {
  const revQ = quarterlySeries(companyfacts, CONCEPTS.revenue);
  const revA = annualSeries(companyfacts, CONCEPTS.revenue);
  const gpQ = quarterlySeries(companyfacts, CONCEPTS.grossProfit);
  const epsQ = quarterlySeries(companyfacts, CONCEPTS.epsDiluted, "USD/shares");
  const opIncQ = quarterlySeries(companyfacts, CONCEPTS.operatingIncome);
  const intExpQ = quarterlySeries(companyfacts, CONCEPTS.interestExpense);
  const ocfQ = quarterlySeries(companyfacts, CONCEPTS.operatingCashFlow);

  // --- Revenue growth / acceleration (quarterly YoY) ---
  const revYoYSeries = yoyGrowthSeries(revQ);
  const revYoY = finite(last(revYoYSeries)?.growth ?? null);
  const revPrevYoY = finite(prev(revYoYSeries)?.growth ?? null);
  const revAccel = revYoY != null && revPrevYoY != null ? revYoY - revPrevYoY : null;

  // --- Multi-year revenue consistency (annual YoY, mean penalized by variance) ---
  let rev3yrConsistency = null;
  if (revA.length >= 4) {
    const g = [];
    for (let i = 1; i < revA.length; i++) if (revA[i - 1].val !== 0) g.push((revA[i].val - revA[i - 1].val) / Math.abs(revA[i - 1].val));
    const recent = g.slice(-3);
    if (recent.length >= 2) {
      const mean = recent.reduce((s, x) => s + x, 0) / recent.length;
      const variance = recent.reduce((s, x) => s + (x - mean) ** 2, 0) / recent.length;
      rev3yrConsistency = mean - Math.sqrt(variance); // high & steady growth ranks best
    }
  }

  // --- EPS trajectory (quarterly YoY of diluted EPS) ---
  const epsYoYSeries = yoyGrowthSeries(epsQ);
  const epsYoY = finite(last(epsYoYSeries)?.growth ?? null);
  const epsPrevYoY = finite(prev(epsYoYSeries)?.growth ?? null);
  const epsAccel = epsYoY != null && epsPrevYoY != null ? epsYoY - epsPrevYoY : null;

  // --- Gross-margin trend (YoY change in quarterly gross margin, in pp) ---
  let grossMarginTrendYoY = null;
  const marginQ = alignByEnd(gpQ, revQ).map((r) => ({ end: r.end, margin: r.b !== 0 ? r.a / r.b : null })).filter((r) => r.margin != null);
  if (marginQ.length) {
    const cur = last(marginQ);
    const target = Date.parse(cur.end) - 365 * DAY;
    const yearAgo = marginQ.find((m) => Math.abs(Date.parse(m.end) - target) <= 20 * DAY);
    if (yearAgo) grossMarginTrendYoY = cur.margin - yearAgo.margin;
  }

  // --- Balance-sheet strength (interest coverage; zero-debt = strong sentinel) ---
  const ttmOpInc = ttm(opIncQ);
  const ttmIntExp = ttm(intExpQ);
  const ttmOcf = ttm(ocfQ);
  let interestCoverage = null;
  if (ttmOpInc != null) {
    if (ttmIntExp == null || ttmIntExp === 0) interestCoverage = 999; // effectively no interest burden
    else interestCoverage = ttmOpInc / Math.abs(ttmIntExp);
  }

  // --- Cash runway (quarters) — only meaningful when burning cash ---
  const cash = finite(latestInstant(companyfacts, CONCEPTS.cash)?.val ?? null);
  let cashRunwayQuarters = null;
  if (cash != null && ttmOcf != null) cashRunwayQuarters = ttmOcf >= 0 ? 999 : cash / (Math.abs(ttmOcf) / 4);

  const assets = finite(latestInstant(companyfacts, CONCEPTS.assets)?.val ?? null);
  const equity = finite(latestInstant(companyfacts, CONCEPTS.equity)?.val ?? null);
  const equityRatio = assets && equity != null ? equity / assets : null;

  return {
    revYoY,
    revAccel,
    rev3yrConsistency,
    epsYoY,
    epsAccel,
    grossMarginTrendYoY,
    interestCoverage,
    cashRunwayQuarters,
    equityRatio,
    // provenance for audit (Agent Four §8 requires source + timestamp on every field)
    _asOf: last(revQ)?.end ?? null,
    _revenueQuarters: revQ.length,
  };
}

/**
 * Map the EDGAR bundle into the current config METRIC_IDS (first-cut, YoY defaults
 * shared across agents). Per-agent definitions (accel / YoY / multi-year) bind here
 * later. Returns only the EDGAR-sourced subset; other ids stay the caller's concern.
 */
export function edgarMetricSubset(companyfacts) {
  const m = deriveFundamentalMetrics(companyfacts);
  return {
    revGrowth: m.revYoY,
    epsTrajectory: m.epsYoY,
    marginTrend: m.grossMarginTrendYoY,
    balanceSheet: m.interestCoverage,
    _derived: m,
  };
}
