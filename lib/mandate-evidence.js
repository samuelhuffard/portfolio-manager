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
 *   - instOwnershipDir + thirteenF NO LONGER EXIST as scored metrics. Category D was
 *     retired 2026-08-22 and its 15 points redistributed across A/B/C. This supersedes
 *     the Q-004 completeness policy, which governed a category that is now gone.
 *     `lib/thirteen-f.js` still derives the evidence and is still tested; nothing
 *     consumes it. Re-binding means restoring the category first — see todo/TODO.md.
 * Agent 2's current growth/acceleration and Agent 3's current valuation can be
 * carried now. Unsupported persistence/multi-year fields stay null, so the shared
 * scorer records partial, non-actionable coverage. Special sectors still require
 * their approved economic adapters and fail closed.
 */

import { assembleConsensusEvidence } from "./consensus-snapshot.js";
import { deriveAgent3History } from "./agent3-history.js";

const pct = (fraction) => (fraction == null || Number.isNaN(fraction) ? null : fraction * 100);
const bps = (fraction) => (fraction == null || Number.isNaN(fraction) ? null : fraction * 10000);
const finite = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * Metrics bound from the EDGAR `derived` bundle ALONE. These describe the base path and
 * are deliberately unchanged: binding is per-call and additive, so a caller that passes
 * only `derived` gets exactly what it got before the optional bundles existed.
 * `OPTIONAL_BUNDLE_METRICS` below records what each extra bundle adds on top.
 */
export const BOUND_METRICS = Object.freeze(["revGrowth", "epsTrajectory", "marginTrend", "peerValuation", "balanceSheet"]);

/**
 * Not derivable from `derived` alone — each needs the bundle named in
 * OPTIONAL_BUNDLE_METRICS. Empty for agents 1 and 2 since Category D was retired:
 * every metric they score is now reachable from the base path plus `consensus`.
 */
export const UNBOUND_METRICS = Object.freeze([]);
export const BOUND_METRICS_BY_AGENT = Object.freeze({
  "agent-1": BOUND_METRICS,
  "agent-2": Object.freeze(["revGrowth", "epsTrajectory", "marginTrend", "peerValuation", "balanceSheet"]),
  // Agent 3's rule tables ask multi-year questions the scalar bundle cannot answer;
  // its long-horizon metrics arrive via the `history` bundle instead.
  "agent-3": Object.freeze(["peerValuation"]),
});
export const UNBOUND_METRICS_BY_AGENT = Object.freeze({
  "agent-1": UNBOUND_METRICS,
  "agent-2": Object.freeze([]),
  "agent-3": Object.freeze(["revBeat", "revGrowth", "epsTrajectory", "estimateRevisions", "marginTrend", "balanceSheet"]),
});

/**
 * What each optional bundle adds when supplied. Together with the base path these cover
 * all seven surviving v3 metric ids, so no metric is structurally unbindable any more —
 * but every one of them still yields null (rescaled out, never zero) on thin evidence.
 */
export const OPTIONAL_BUNDLE_METRICS = Object.freeze({
  consensus: Object.freeze(["revBeat", "estimateRevisions"]),
  history: Object.freeze(["revGrowth", "epsTrajectory", "marginTrend", "balanceSheet"]), // agent 3 only
});

/**
 * Evidence that binds identically for every agent: consensus-sourced revBeat and
 * estimateRevisions. Mutates the caller's accumulators.
 *
 * The bundle is optional. Omitting it leaves exactly its own metrics unbound, which is
 * what keeps a name with no snapshot history scoring precisely as it did before the
 * source existed.
 */
function applySharedEvidence({ absoluteEvidence, metricVector, bound, consensus }) {
  const bind = (metricId) => { if (!bound.includes(metricId)) bound.push(metricId); };

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
    for (const metricId of consensusBound) bind(metricId);
    if (consensusEvidence.estimateRevisions) {
      metricVector.estimateRevisions = consensusEvidence.estimateRevisions.consensusChangePct;
    }
    if (consensusEvidence.revBeat) metricVector.revBeat = consensusEvidence.revBeat.beatPct;
  }
}

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
export function assembleMandateInputs({
  agentId,
  metrics = {},
  derived = null,
  sector = null,
  consensus = null,
  companyfacts = null,
  history = null,
}) {
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
    // Agent Three requires three-year persistence and normalized EPS history. Agent
    // One/Two's short-window scalars are still never substituted — the long-horizon
    // quantities come from lib/agent3-history.js, which derives them from the filing
    // history directly. A caller may pass a precomputed `history` bundle, or
    // `companyfacts` to derive it here; with neither, every long-horizon metric stays
    // null exactly as it did before.
    const longHorizon = history ?? (companyfacts ? deriveAgent3History(companyfacts) : null);
    const longHorizonMetricVector = {
      ...metricVector,
      revGrowth: null,
      epsTrajectory: null,
      marginTrend: null,
      balanceSheet: null,
    };
    if (longHorizon) {
      if (longHorizon.revGrowth) {
        absoluteEvidence.revGrowth = longHorizon.revGrowth;
        longHorizonMetricVector.revGrowth = finite(longHorizon.revGrowth.revenueCagr3yPct);
        bound.push("revGrowth");
      }
      if (longHorizon.epsTrajectory) {
        absoluteEvidence.epsTrajectory = longHorizon.epsTrajectory;
        longHorizonMetricVector.epsTrajectory = finite(longHorizon.epsTrajectory.normalizedEpsCagr3yPct);
        bound.push("epsTrajectory");
      }
      if (longHorizon.marginTrend) {
        absoluteEvidence.marginTrend = longHorizon.marginTrend;
        longHorizonMetricVector.marginTrend = finite(longHorizon.marginTrend.marginChangeBps3y);
        bound.push("marginTrend");
      }
      if (longHorizon.balanceSheet) {
        absoluteEvidence.balanceSheet = longHorizon.balanceSheet;
        longHorizonMetricVector.balanceSheet = finite(longHorizon.balanceSheet.latestInterestCoverage);
        bound.push("balanceSheet");
      }
    }
    if (base.valuationEvidence) bound.push("peerValuation");
    applySharedEvidence({ absoluteEvidence, metricVector: longHorizonMetricVector, bound, consensus });
    return {
      supported: true,
      unsupportedReason: null,
      metricVector: longHorizonMetricVector,
      absoluteEvidence,
      valuationEvidence: base.valuationEvidence,
      boundMetrics: bound,
      longHorizonWindows: longHorizon?.windows ?? 0,
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

  applySharedEvidence({ absoluteEvidence, metricVector, bound, consensus });

  return {
    supported: true,
    unsupportedReason: null,
    metricVector,
    absoluteEvidence,
    valuationEvidence: base.valuationEvidence,
    boundMetrics: bound,
  };
}
