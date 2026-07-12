/**
 * Maps available fundamentals to the **v2.1** Mandate metric vector that
 * lib/peer-scoring.js ranks peer-relative (config/scoring/mandate-v2.js → METRIC_IDS).
 * Pure. NOT wired live (PEER_SCORING / PEER_METRICS_ENABLED off).
 *
 * MANDATED DATA SOURCE (Agent Four v2.1 §8 free-data contract): the PRIMARY source is
 * **SEC EDGAR / XBRL company-facts** (multi-quarter/multi-year series → revenue
 * growth/acceleration, EPS trajectory, margin trend, balance-sheet strength), via
 * lib/edgar.js + lib/edgar-metrics.js. **yfinance** supplies only the valuation
 * multiple here; consensus (revBeat), estimate-revision history, and 13F/institutional
 * direction come from cached snapshots / EDGAR 13F and are not wired yet. No paid API.
 *
 * Pass `companyfacts` (from lib/edgar.js fetchCompanyFacts) to populate the EDGAR
 * metrics; omit it to get the yfinance-only interim (valuation + a rough revGrowth).
 * Missing metrics stay `null` — the engine's vendor-lag rescale excludes nulls (never
 * scores them zero). Never fabricate a value from a wrong field to fill a slot.
 */
import { edgarMetricSubset } from "./edgar-metrics.js";

/** Populated when EDGAR companyfacts are supplied. */
export const POPULATED_METRICS = Object.freeze([
  "revGrowth", // EDGAR quarterly YoY (per-agent accel/consistency binds later)
  "epsTrajectory", // EDGAR quarterly EPS YoY
  "marginTrend", // EDGAR gross-margin YoY change
  "balanceSheet", // EDGAR interest coverage (+ runway/equity in _derived)
  "peerValuation", // yfinance forward P/E (lower is better)
]);

/** Still null pending consensus snapshots / 13F ingestion. */
export const DEFERRED_METRICS = Object.freeze([
  "revBeat", // revenue actual (EDGAR) vs cached consensus snapshot (yfinance) — needs the snapshot store
  "estimateRevisions", // local SQLite consensus-snapshot history (activation-gated)
  "instOwnershipDir", // EDGAR 13F direction over time
  "thirteenF", // EDGAR latest 13F accumulation
]);

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * Extract the v2.1 peer-scoring metric vector.
 * @param fundamentals { raw, ... } as returned by lib/yahoo.js fetchFundamentals
 * @param companyfacts optional SEC EDGAR companyfacts JSON (lib/edgar.js). When given,
 *        the EDGAR-sourced metrics are populated and override the yfinance interim.
 * @returns { [metricId]: number|null } aligned to METRIC_IDS (v2.1)
 */
export function extractMetricVector(fundamentals, companyfacts = null) {
  const raw = fundamentals?.raw ?? {};
  const fd = raw.financialData ?? {};
  const sd = raw.summaryDetail ?? {};
  const dks = raw.defaultKeyStatistics ?? {};

  const forwardPE = num(sd.forwardPE) ?? num(dks.forwardPE);
  const trailingPE = num(sd.trailingPE);

  const vector = {
    revBeat: null,
    revGrowth: num(fd.revenueGrowth), // yfinance interim; overridden by EDGAR below
    epsTrajectory: null,
    estimateRevisions: null,
    marginTrend: null,
    peerValuation: forwardPE ?? trailingPE, // lower is better (engine flips)
    balanceSheet: null,
    instOwnershipDir: null,
    thirteenF: null,
  };

  if (companyfacts) {
    const { _derived, ...edgar } = edgarMetricSubset(companyfacts);
    for (const [k, v] of Object.entries(edgar)) if (num(v) != null) vector[k] = v;
  }
  return vector;
}

/** Build a peer-metrics store row for one enriched name (companyfacts optional). */
export function peerMetricsRow(fundamentals, companyfacts = null) {
  return {
    industry: fundamentals?.industry ?? null,
    sector: fundamentals?.sector ?? null, // hierarchy for peer-set widening (industry → sector)
    metrics: extractMetricVector(fundamentals, companyfacts),
    ts: new Date().toISOString().slice(0, 10),
    src: companyfacts ? "edgar+yfinance" : "yfinance",
  };
}
