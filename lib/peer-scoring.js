/**
 * Peer-relative conviction scoring engine (Mandate v2).
 *
 * The v2 analyst mandates score every rankable metric by the candidate's
 * PERCENTILE RANK WITHIN ITS INDUSTRY PEER SET — never against the daily slate
 * (that is what lib/quant-scorer.js does, and it is the wrong reference set for
 * these mandates). This module is the deterministic replacement.
 *
 * Division of labor (preserves ONBOARDING invariant #4): this pure code computes
 * the peer-relative sub-scores from an industry distribution; the analyst LLM
 * never ranks peers — it consumes these numbers and may only downgrade toward
 * HOLD. LLMs cannot reliably percentile-rank hundreds of names.
 *
 * NOT wired into the live pipeline. Gated behind PEER_SCORING (default off) until
 * Phase A is verified — see docs/MANDATE-V2-INGESTION.md. Peer data source is the
 * Yahoo-industry key via lib/peer-source.js; swap to GICS later without touching
 * this file.
 */

/**
 * Mandate scoring bands (identical across all three analyst mandates, Section 5):
 * top decile → full points · top quartile → ~75% · top third → ~50% ·
 * middle → minimal · bottom half → 0.
 */
export const BANDS = Object.freeze([
  { minPercentile: 0.9, fraction: 1.0 }, // top decile
  { minPercentile: 0.75, fraction: 0.75 }, // top quartile
  { minPercentile: 0.6667, fraction: 0.5 }, // top third
  { minPercentile: 0.5, fraction: 0.25 }, // middle → minimal
  { minPercentile: 0.0, fraction: 0.0 }, // bottom half
]);

/** Default minimum comparables before a peer set is trusted (mandate: "~6–8"). */
export const THIN_PEER_MIN = 7;

/** Map a percentile in [0,1] to its band point-fraction. */
export function bandFraction(percentile) {
  if (percentile == null || Number.isNaN(percentile)) return null;
  for (const band of BANDS) {
    if (percentile >= band.minPercentile) return band.fraction;
  }
  return 0;
}

/**
 * Percentile rank of `value` within `peerValues`, in [0,1].
 * Fraction of peers the candidate is strictly better than, plus half-credit for
 * ties (standard mid-rank). `higherIsBetter=false` flips direction (e.g. P/E).
 * The candidate's own value, if present in peerValues, is excluded once.
 * Returns null if value is missing or there are no valid peers.
 */
export function percentileRank(value, peerValues, higherIsBetter = true) {
  if (value == null || Number.isNaN(value)) return null;
  const valid = peerValues.filter((v) => v != null && !Number.isNaN(v));
  if (!valid.length) return null;

  let better = 0;
  let equal = 0;
  for (const v of valid) {
    const cmp = higherIsBetter ? value - v : v - value;
    if (cmp > 0) better += 1;
    else if (cmp === 0) equal += 1;
  }
  // Exclude one self-match from the ties (the candidate compared to itself).
  if (equal > 0) equal -= 1;
  const n = valid.length - 1; // exclude self from the denominator
  if (n <= 0) return null; // no true peers besides self
  return (better + 0.5 * equal) / n;
}

/**
 * Score one metric peer-relative.
 * @returns {{ points, maxPoints, percentile, fraction, thinPeerSet, missing }}
 *   - missing:true      → value absent (feeds vendor-lag rescale by the caller)
 *   - thinPeerSet:true  → too few comparables; caller applies the absolute-threshold
 *                         fallback and flags the proposal thin_peer_set:true. points
 *                         is null here (the engine does not invent absolutes).
 */
export function scoreMetricPeerRelative(value, peerValues, spec, thinPeerMin = THIN_PEER_MIN) {
  const maxPoints = spec.points;
  const higherIsBetter = spec.higherIsBetter !== false;

  if (value == null || Number.isNaN(value)) {
    return { points: 0, maxPoints, percentile: null, fraction: null, thinPeerSet: false, missing: true };
  }
  const valid = peerValues.filter((v) => v != null && !Number.isNaN(v));
  if (valid.length < thinPeerMin) {
    return { points: null, maxPoints, percentile: null, fraction: null, thinPeerSet: true, missing: false };
  }
  const percentile = percentileRank(value, valid, higherIsBetter);
  if (percentile == null) {
    return { points: null, maxPoints, percentile: null, fraction: null, thinPeerSet: true, missing: false };
  }
  const fraction = bandFraction(percentile);
  return {
    points: Math.round(fraction * maxPoints * 100) / 100,
    maxPoints,
    percentile,
    fraction,
    thinPeerSet: false,
    missing: false,
  };
}

/**
 * Score a full metric vector against a per-industry distribution set using a
 * per-agent scoring config (see config/scoring/mandate-v2.js).
 *
 * @param metricVector  { [metricId]: number|null } current values for the candidate
 * @param distributions { [metricId]: number[] } peer values for the candidate's industry
 * @param config        one agent entry from AGENT_SCORING (categories → metrics → spec)
 * @param opts          { thinPeerMin, substitutions } — substitutions: { [metricId]: metricId }
 *                      states an explicit sector substitution (mandate Section 5); the
 *                      substitute's distribution/value is used and recorded.
 * @returns {{
 *   total,               // 0–100 (rescaled if vendor-lag missing fields, per mandate)
 *   rawTotal,            // points earned before rescale
 *   maxAvailable,        // max points on fields that were scorable
 *   basis,              // 'full' | 'rescaled_available_fields'
 *   thinPeerSet,         // true if ANY scored metric fell back to absolutes
 *   missingMetrics,      // metricIds with no value (vendor-lag candidates)
 *   thinMetrics,         // metricIds that hit the thin-peer fallback
 *   substitutionsUsed,   // [{ metric, substitute }]
 *   categories,          // { [cat]: { earned, max } }
 *   perMetric,           // { [metricId]: scoreMetricPeerRelative result }
 * }}
 *
 * Vendor-lag rescale (mandate Section 9): a missing field is NOT scored zero; the
 * total is rescaled as (points earned ÷ max points on scorable fields) × 100 and
 * the basis is flagged 'rescaled_available_fields'. Thin-peer metrics are excluded
 * from both numerator and denominator here (they need the absolute fallback, which
 * is supplied per-metric in a later pass — this engine reports them, not guesses).
 */
export function scoreCategoriesPeerRelative(metricVector, distributions, config, opts = {}) {
  const thinPeerMin = opts.thinPeerMin ?? config.thinPeerMin ?? THIN_PEER_MIN;
  const substitutions = opts.substitutions ?? {};

  const perMetric = {};
  const categories = {};
  const missingMetrics = [];
  const thinMetrics = [];
  const substitutionsUsed = [];

  let earned = 0;
  let maxAvailable = 0;

  for (const [cat, catSpec] of Object.entries(config.categories)) {
    categories[cat] = { earned: 0, max: catSpec.maxPoints ?? 0 };
    for (const [metricId, spec] of Object.entries(catSpec.metrics)) {
      const source = substitutions[metricId] ?? metricId;
      if (source !== metricId) substitutionsUsed.push({ metric: metricId, substitute: source });

      const value = metricVector[source];
      const peers = distributions[source] ?? [];
      const result = scoreMetricPeerRelative(value, peers, spec, thinPeerMin);
      perMetric[metricId] = result;

      if (result.missing) {
        missingMetrics.push(metricId);
        continue; // excluded from numerator AND denominator (rescale)
      }
      if (result.thinPeerSet) {
        thinMetrics.push(metricId);
        continue; // needs absolute fallback; not scored here
      }
      earned += result.points;
      maxAvailable += result.maxPoints;
      categories[cat].earned += result.points;
    }
  }

  const basis = missingMetrics.length ? "rescaled_available_fields" : "full";
  const total = maxAvailable > 0 ? Math.round((earned / maxAvailable) * 100 * 100) / 100 : 0;

  return {
    total,
    rawTotal: Math.round(earned * 100) / 100,
    maxAvailable,
    basis,
    thinPeerSet: thinMetrics.length > 0,
    missingMetrics,
    thinMetrics,
    substitutionsUsed,
    categories,
    perMetric,
  };
}
