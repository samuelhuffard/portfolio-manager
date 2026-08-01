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
 * SCOPE: standard-sector adapters for Agents 1–3. The inputs that EDGAR genuinely
 * provides are bound; the rest are left null with the reason recorded:
 *   - revGrowth.accelerationPoints needs ≥5 quarters of revenue (two YoY points).
 *   - balanceSheet binds the Q-001 definitions (profitability on TTM operating income,
 *     netCash excluding restricted cash and operating leases, EBITDA fallback order,
 *     null on negative/zero EBITDA). Owner sign-off assumed 2026-08-01 and PENDING
 *     FORMAL PARTNER REVIEW — see todo/TODO.md and the Q-001 draft.
 *   - revBeat + estimateRevisions bind when the caller supplies `consensus`
 *     (lib/consensus-snapshot.js); absent it they stay unbound as before.
 *   - instOwnershipDir, thirteenF still need 13F ingestion — omitted. Per the accepted
 *     Q-004 decision 13F is optional, not thesis-critical.
 * Agent 2's current growth/acceleration and Agent 3's current valuation can be
 * carried now. Unsupported persistence/multi-year fields stay null, so the shared
 * scorer records partial, non-actionable coverage. Special sectors still require
 * their approved economic adapters and fail closed.
 */

import { assembleConsensusEvidence } from "./consensus-snapshot.js";

const pct = (fraction) => (fraction == null || Number.isNaN(fraction) ? null : fraction * 100);
const bps = (fraction) => (fraction == null || Number.isNaN(fraction) ? null : fraction * 10000);
const finite = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Metrics whose absolute-threshold inputs this adapter can currently derive from EDGAR. */
export const BOUND_METRICS = Object.freeze(["revGrowth", "epsTrajectory", "marginTrend", "peerValuation", "balanceSheet"]);

/** Named inputs still pending consensus-snapshot / 13F ingestion (never invented here). */
export const UNBOUND_METRICS = Object.freeze(["instOwnershipDir", "thirteenF"]);
export const BOUND_METRICS_BY_AGENT = Object.freeze({
  "agent-1": BOUND_METRICS,
  "agent-2": Object.freeze(["revGrowth", "epsTrajectory", "marginTrend", "peerValuation", "balanceSheet"]),
  "agent-3": Object.freeze(["peerValuation"]),
});
export const UNBOUND_METRICS_BY_AGENT = Object.freeze({
  "agent-1": UNBOUND_METRICS,
  "agent-2": Object.freeze(["instOwnershipDir", "thirteenF"]),
  "agent-3": Object.freeze(["revBeat", "revGrowth", "epsTrajectory", "estimateRevisions", "marginTrend", "balanceSheet", "instOwnershipDir", "thirteenF"]),
});

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
export function assembleMandateInputs({ agentId, metrics = {}, derived = null, sector = null, consensus = null }) {
  const metricVector = { ...metrics, balanceSheet: null };
  const base = {
    metricVector,
    absoluteEvidence: {},
    valuationEvidence: metrics.peerValuation != null ? { value: finite(metrics.peerValuation) } : null,
    boundMetrics: [],
  };

  if (!BOUND_METRICS_BY_AGENT[agentId]) {
    return { ...base, supported: false, unsupportedReason: `unknown mandate agent ${agentId}` };
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

  if (agentId === "agent-3") {
    // Agent Three requires three-year persistence and normalized EPS history.
    // The current scalar EDGAR bundle does not contain those approved inputs.
    // Do not substitute Agent One/Two's short-window values.
    const longHorizonMetricVector = {
      ...metricVector,
      revGrowth: null,
      epsTrajectory: null,
      marginTrend: null,
      balanceSheet: null,
    };
    if (base.valuationEvidence) bound.push("peerValuation");
    return {
      supported: true,
      unsupportedReason: null,
      metricVector: longHorizonMetricVector,
      absoluteEvidence,
      valuationEvidence: base.valuationEvidence,
      boundMetrics: bound,
    };
  }

  // Agent 1 consumes acceleration directly. Agent 2 also carries the sourced
  // current/acceleration values, while unsupported four-quarter persistence stays
  // null so an absolute score cannot be manufactured from a shorter history.
  if (finite(d.revYoY) != null) {
    absoluteEvidence.revGrowth = agentId === "agent-1"
      ? { currentGrowthPct: pct(d.revYoY), accelerationPoints: pct(finite(d.revAccel)) }
      : {
          currentGrowthPct: pct(d.revYoY),
          positiveQuartersInLatestFour: null,
          positiveMultiQuarterPersistence: null,
          nonDecelerating: finite(d.revAccel) == null ? null : d.revAccel >= 0,
          consecutiveMaterialDecelerations: null,
        };
    bound.push("revGrowth");
  }

  // Same distinction for EPS: Agent Two's two-quarter persistence is never
  // inferred from one current acceleration scalar.
  if (finite(d.epsYoY) != null) {
    absoluteEvidence.epsTrajectory = agentId === "agent-1"
      ? { epsGrowthPct: pct(d.epsYoY), accelerationPoints: pct(finite(d.epsAccel)) }
      : {
          epsGrowthPct: pct(d.epsYoY),
          consecutiveQualifyingQuarters: null,
          nonDecelerating: finite(d.epsAccel) == null ? null : d.epsAccel >= 0,
          consecutiveDeterioratingQuarters: null,
        };
    bound.push("epsTrajectory");
  }

  // marginTrend: marginChangeBps (+ documentedInvestmentExplanation defaults false —
  // only the 0-band consults it, and only alongside a ≤-100bps move).
  if (finite(d.grossMarginTrendYoY) != null) {
    absoluteEvidence.marginTrend = { marginChangeBps: bps(d.grossMarginTrendYoY), documentedInvestmentExplanation: false };
    bound.push("marginTrend");
  }

  // balanceSheet — Q-001 definitions accepted (owner sign-off assumed 2026-08-01,
  // pending formal partner review; see todo/TODO.md). The named inputs below are the
  // exact fields config/scoring/absolute-thresholds.js `balanceSheet` reads. Any input
  // we cannot derive stays absent, and lib/absolute-rules.js then reports the metric
  // `missing` and rescales it out rather than awarding a weaker band from an
  // incomplete record.
  const balanceSheetEvidence = {};
  if (d.isProfitable != null) {
    balanceSheetEvidence.isProfitable = d.isProfitable;
    balanceSheetEvidence.isPreProfit = !d.isProfitable;
  }
  if (finite(d.netCash) != null || typeof d.netCash === "boolean") balanceSheetEvidence.netCash = d.netCash;
  if (finite(d.netDebtEbitda) != null) balanceSheetEvidence.netDebtEbitda = d.netDebtEbitda;
  if (finite(d.interestCoverage) != null) balanceSheetEvidence.interestCoverage = d.interestCoverage;
  if (finite(d.cashRunwayQuarters) != null) balanceSheetEvidence.cashRunwayQuarters = d.cashRunwayQuarters;
  if (balanceSheetEvidence.isProfitable != null) {
    absoluteEvidence.balanceSheet = balanceSheetEvidence;
    metricVector.balanceSheet = finite(d.interestCoverage);
    bound.push("balanceSheet");
  }

  if (base.valuationEvidence) bound.push("peerValuation");

  // revBeat + estimateRevisions from the consensus snapshot store
  // (lib/consensus-snapshot.js). Absent consensus leaves both unbound exactly as
  // before, so a name with no snapshot history scores the same as it does today.
  if (consensus) {
    const { evidence: consensusEvidence, boundMetrics: consensusBound } = assembleConsensusEvidence({
      snapshot: consensus.snapshot ?? null,
      history: consensus.history ?? [],
      // Revenue actual comes from EDGAR for the SAME period the snapshot targets;
      // the caller supplies it, because matching a filing to a pre-report snapshot is
      // a point-in-time decision this pure function must not guess at.
      actualRevenue: consensus.actualRevenue ?? null,
    });
    Object.assign(absoluteEvidence, consensusEvidence);
    for (const metricId of consensusBound) {
      if (!bound.includes(metricId)) bound.push(metricId);
    }
    if (consensusEvidence.estimateRevisions) {
      metricVector.estimateRevisions = consensusEvidence.estimateRevisions.consensusChangePct;
    }
    if (consensusEvidence.revBeat) metricVector.revBeat = consensusEvidence.revBeat.beatPct;
  }

  return {
    supported: true,
    unsupportedReason: null,
    metricVector,
    absoluteEvidence,
    valuationEvidence: base.valuationEvidence,
    boundMetrics: bound,
  };
}
