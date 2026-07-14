/**
 * Mandate-metrics ADAPTER (mandate v3 §5) — the deliberately-deferred binding that
 * config/scoring/mandate-v2.js §ABSOLUTE_TABLE_REQUIREMENTS calls out: it maps the
 * EDGAR-derived fundamentals bundle (lib/edgar-metrics.js `deriveFundamentalMetrics`,
 * persisted per name as `derived` on the peer-metrics row) into the named
 * absolute-threshold inputs that lib/mandate-score.js consumes.
 *
 * Pure, no I/O. Feeds the nightly whole-market scoring pass (jobs/mandate-scoring.js);
 * NOT on the live money/scan path — its scores are research context only and can never
 * upgrade an action downstream.
 *
 * HARD RULE (repeated from the config header): NEVER fabricate a named input from a
 * wrong field to fill a rule slot. A quantity we cannot derive from available data
 * stays `null`, and lib/mandate-score.js rescales it out (never scores it zero). This
 * yields a correct partial score (`complete: false`) rather than a confidently-wrong one.
 *
 * SCOPE (2026-07-13, first binding): agent-1 STANDARD sectors only. The inputs that
 * EDGAR genuinely provides are bound; the rest are left null with the reason recorded:
 *   - revGrowth.accelerationPoints needs ≥5 quarters of revenue (two YoY points).
 *   - balanceSheet is Q-001 gated. Numeric legacy balance-sheet/interest-coverage
 *     values are masked until the mandate authors specify the approved definitions.
 *   - revBeat, estimateRevisions, instOwnershipDir, thirteenF need consensus snapshots
 *     and 13F ingestion (DEFERRED_METRICS) — omitted.
 * Agents 2/3 (multi-quarter persistence, 3yr CAGR) and special sectors need their own
 * bindings and are reported `supported: false` so the scoring pass skips them cleanly.
 */

const pct = (fraction) => (fraction == null || Number.isNaN(fraction) ? null : fraction * 100);
const bps = (fraction) => (fraction == null || Number.isNaN(fraction) ? null : fraction * 10000);
const finite = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Metrics whose absolute-threshold inputs this adapter can currently derive from EDGAR. */
export const BOUND_METRICS = Object.freeze(["revGrowth", "epsTrajectory", "marginTrend", "peerValuation"]);

/** Named inputs still pending consensus-snapshot / 13F ingestion (never invented here). */
export const UNBOUND_METRICS = Object.freeze(["revBeat", "estimateRevisions", "balanceSheet", "instOwnershipDir", "thirteenF"]);

/**
 * Build the absolute-threshold evidence + valuation evidence for one candidate.
 *
 * @param {object} args
 * @param {string} args.agentId    e.g. "agent-1"
 * @param {object} args.metrics    the stored scalar metric vector (peerMetricsRow.metrics)
 * @param {object} args.derived    the EDGAR `_derived` bundle (peerMetricsRow.derived); may be null
 * @param {string|null} args.sector
 * @returns {{ supported: boolean, unsupportedReason: string|null, metricVector: object,
 *            absoluteEvidence: object, valuationEvidence: object|null, boundMetrics: string[] }}
 */
export function assembleMandateInputs({ agentId, metrics = {}, derived = null, sector = null }) {
  const metricVector = { ...metrics, balanceSheet: null };
  const base = {
    metricVector,
    absoluteEvidence: {},
    valuationEvidence: metrics.peerValuation != null ? { value: finite(metrics.peerValuation) } : null,
    boundMetrics: [],
  };

  // Special sectors and non-agent-1 mandates need their own adapters (banks/insurers/reits
  // fields, agent-2 persistence, agent-3 multi-year CAGR). Fail closed rather than guess.
  if (agentId !== "agent-1") {
    return { ...base, supported: false, unsupportedReason: `no evidence adapter for ${agentId} yet` };
  }
  if (sector) {
    return { ...base, supported: false, unsupportedReason: `no evidence adapter for special sector "${sector}" yet` };
  }
  if (!derived) {
    return { ...base, supported: false, unsupportedReason: "no EDGAR-derived bundle (enable PEER_METRICS_EDGAR)" };
  }

  const d = derived;
  const absoluteEvidence = {};
  const bound = [];

  // revGrowth (agent-1 §5): currentGrowthPct + accelerationPoints (both required by every band).
  if (finite(d.revYoY) != null) {
    absoluteEvidence.revGrowth = { currentGrowthPct: pct(d.revYoY), accelerationPoints: pct(finite(d.revAccel)) };
    bound.push("revGrowth");
  }

  // epsTrajectory: epsGrowthPct + accelerationPoints.
  if (finite(d.epsYoY) != null) {
    absoluteEvidence.epsTrajectory = { epsGrowthPct: pct(d.epsYoY), accelerationPoints: pct(finite(d.epsAccel)) };
    bound.push("epsTrajectory");
  }

  // marginTrend: marginChangeBps (+ documentedInvestmentExplanation defaults false —
  // only the 0-band consults it, and only alongside a ≤-100bps move).
  if (finite(d.grossMarginTrendYoY) != null) {
    absoluteEvidence.marginTrend = { marginChangeBps: bps(d.grossMarginTrendYoY), documentedInvestmentExplanation: false };
    bound.push("marginTrend");
  }

  // balanceSheet is intentionally not emitted. Q-001 must define the source
  // hierarchy and economics for profitability, net cash, EBITDA, zero debt,
  // and missing/negative EBITDA before any legacy numeric field can score.

  if (base.valuationEvidence) bound.push("peerValuation");

  return {
    supported: true,
    unsupportedReason: null,
    metricVector,
    absoluteEvidence,
    valuationEvidence: base.valuationEvidence,
    boundMetrics: bound,
  };
}
