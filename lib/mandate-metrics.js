/**
 * Maps available fundamentals to the **v2.1** Mandate metric vector that
 * lib/peer-scoring.js ranks peer-relative (config/scoring/mandate-v2.js → METRIC_IDS).
 * Pure. NOT wired live (PEER_SCORING / PEER_METRICS_ENABLED off).
 *
 * MANDATED DATA SOURCE (Agent Four v2.1 §8 free-data contract): the PRIMARY source is
 * **SEC EDGAR / XBRL company-facts** (multi-quarter/multi-year series → revenue
 * growth/acceleration, EPS trajectory, margin trend, balance-sheet strength), via
 * lib/edgar.js + lib/edgar-metrics.js. **yfinance** supplies only the valuation
 * multiple here; consensus (revBeat) and estimate-revision history come from cached
 * snapshots and are not wired yet. No paid API. 13F/institutional direction is no
 * longer a metric here — Category D was retired 2026-08-22.
 *
 * Pass `companyfacts` (from lib/edgar.js fetchCompanyFacts) to populate the EDGAR
 * metrics; omit it to get the yfinance-only interim (valuation + a rough revGrowth).
 * Missing metrics stay `null` — the engine's vendor-lag rescale excludes nulls (never
 * scores them zero). Never fabricate a value from a wrong field to fill a slot.
 *
 * `peerMetricsRow` ALSO derives and caches Agent 3's long-horizon bundle
 * (lib/agent3-history.js `deriveAgent3History`) from the same `companyfacts` payload —
 * no second EDGAR fetch. `jobs/mandate-scoring.js` reads it back out per candidate via
 * `lib/mandate-observation.js` `buildAgentOneUniverseSnapshot` and threads it into
 * `assembleMandateInputs` as the `history` bundle. Wired 2026-08-22; `SCORED_AGENTS`
 * in jobs/mandate-scoring.js must still be widened past `["agent-1"]` before this
 * bundle actually reaches a scoring pass — see todo/TODO.md.
 */
import { edgarMetricSubset } from "./edgar-metrics.js";
import { deriveAgent3History } from "./agent3-history.js";

/** Populated when EDGAR companyfacts are supplied. */
export const POPULATED_METRICS = Object.freeze([
  "revGrowth", // EDGAR quarterly YoY (per-agent accel/consistency binds later)
  "epsTrajectory", // EDGAR quarterly EPS YoY
  "marginTrend", // EDGAR gross-margin YoY change
  "balanceSheet", // EDGAR interest coverage (+ runway/equity in _derived)
  "peerValuation", // yfinance forward P/E (lower is better)
]);

/**
 * Still null pending consensus snapshots. The 13F pair that used to sit here left with
 * Category D (2026-08-22) — they are no longer metric ids at all, so they cannot be
 * "deferred"; lib/thirteen-f.js still derives that evidence for a future re-bind.
 */
export const DEFERRED_METRICS = Object.freeze([
  "revBeat", // revenue actual (EDGAR) vs cached consensus snapshot (yfinance) — needs the snapshot store
  "estimateRevisions", // local SQLite consensus-snapshot history (activation-gated)
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
  };

  if (companyfacts) {
    const { _derived, ...edgar } = edgarMetricSubset(companyfacts);
    for (const [k, v] of Object.entries(edgar)) if (num(v) != null) vector[k] = v;
  }
  return vector;
}

/**
 * Yahoo's immediately available fundamentals used for Lab's peer-cohort
 * research context.  This is intentionally separate from the Agent Three
 * mandate vector: it is a transparent, partial relative screen, not a
 * substitute for the mandate's long-horizon evidence requirements.
 */
export function extractPeerQuantVector(fundamentals) {
  const raw = fundamentals?.raw ?? {};
  const fd = raw.financialData ?? {};
  const sd = raw.summaryDetail ?? {};
  const dks = raw.defaultKeyStatistics ?? {};
  return {
    revenueGrowth: num(fd.revenueGrowth),
    earningsGrowth: num(fd.earningsGrowth),
    profitMargins: num(fd.profitMargins),
    returnOnEquity: num(fd.returnOnEquity),
    trailingPE: num(sd.trailingPE),
    debtToEquity: num(fd.debtToEquity),
    pegRatio: num(dks.pegRatio),
  };
}

/** Build a peer-metrics store row for one enriched name (companyfacts optional). */
export function peerMetricsRow(fundamentals, companyfacts = null, { now = () => new Date() } = {}) {
  // Persist the richer EDGAR-derived bundle (acceleration, cash runway, interest
  // coverage, ...) alongside the scalar vector: the nightly whole-market scoring pass
  // (jobs/mandate-scoring.js via lib/mandate-evidence.js) needs it to build the
  // absolute-threshold inputs, and it isn't recoverable from the scalar metrics alone.
  const { _derived: derived = null } = companyfacts ? edgarMetricSubset(companyfacts) : {};
  // Agent 3's long-horizon evidence (lib/agent3-history.js) reads the SAME companyfacts
  // payload this call already fetched — no extra EDGAR request. Deriving and caching it
  // here (rather than only at scoring time) means a candidate with too little filing
  // history is judged that way consistently, not by whether scoring happened to re-fetch
  // companyfacts that day. Pure CPU work; deriveAgent3History always returns an object
  // (never null) with per-metric nulls when fewer than 4 TTM windows exist.
  const history = companyfacts ? deriveAgent3History(companyfacts) : null;
  const retrievedAt = now().toISOString();
  return {
    industry: fundamentals?.industry ?? null,
    sector: fundamentals?.sector ?? null, // hierarchy for peer-set widening (industry → sector)
    metrics: extractMetricVector(fundamentals, companyfacts),
    quant: extractPeerQuantVector(fundamentals),
    derived,
    history,
    // A date-only cache row cannot establish point-in-time provenance. Keep the
    // legacy key for readers, but make every newly written retrieval timestamp
    // a full zoned ISO instant. Scoring rejects legacy date-only rows.
    ts: retrievedAt,
    retrievedAt,
    src: companyfacts ? "edgar+yfinance" : "yfinance",
  };
}
