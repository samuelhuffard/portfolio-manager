/**
 * Consensus-estimate snapshot extraction + derivations (mandate v3 Category A/B).
 *
 * Unblocks the two metrics that no other free source can supply and that the
 * ≥80-point actionability bar mathematically requires (see the point arithmetic in
 * docs/MANDATE-V2-INGESTION.md §7): `revBeat` (Category A) and `estimateRevisions`
 * (Category B). Together they are 22 of Agent 1's 100 points and 22 of Agent 2's;
 * no combination of the remaining unbound metrics reaches 80 without them.
 *
 * MANDATED SOURCE (Agent Four v3 §8 free-data contract): Yahoo's `earningsTrend`
 * quoteSummary module, fetched by the dedicated `fetchConsensusTrend()` in lib/yahoo.js.
 * It is deliberately NOT folded into `FUNDAMENTALS_MODULES`: Yahoo would carry it in the
 * same request for free, but this client keeps schema validation failing closed and
 * validation throws for the whole call, so one drift in `earningsTrend` would break the
 * entire fundamentals fetch. The isolated call costs one extra request per ticker on the
 * gated accumulation path only — never on the live scan. Free source, no paid API, and
 * zero LLM tokens either way.
 *
 * Pure, no I/O. NOT on the live money/scan path — consensus values are research
 * context only and can never upgrade an action downstream.
 *
 * HARD RULE (shared with lib/mandate-evidence.js): never fabricate a named input from
 * a wrong field to fill a rule slot. A quantity we cannot derive stays `null`, and
 * lib/mandate-score.js rescales it out rather than scoring it zero.
 *
 * PROVENANCE NOTE — two kinds of revision history:
 *   Yahoo supplies its OWN trailing revision fields (`epsTrend.30daysAgo`,
 *   `epsRevisions.upLast30days`, ...). Those are vendor-asserted backward-looking
 *   numbers, not values this system observed at the time. ADR 0003 (point-in-time
 *   research record) prefers locally-observed history. This module therefore captures
 *   BOTH: `vendorRevisions` (derivable from a single snapshot, available immediately)
 *   and the raw consensus vector needed to build locally-observed history over time.
 *   Which of the two may SCORE `estimateRevisions` is an open policy question — see
 *   Q-002/Q-004 in docs/RESEARCH-DECISION-REGISTER.md. Capturing both costs nothing
 *   extra and keeps that decision reversible without re-collecting data.
 *
 * Field shapes verified against the installed yahoo-finance2 v3 module interface
 * (`EarningsTrendTrend` / `EarningsEstimate` / `RevenueEstimate` / `EpsTrend` /
 * `EpsRevisions`), not guessed — MANDATE-V2-INGESTION explicitly warns against
 * guessing v3 field shapes.
 */

const finite = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * Derived ratios are rounded at this boundary so IEEE-754 representation noise
 * (0.2/2*100 → 10.000000000000009) cannot propagate into stored evidence and show up
 * later as a phantom score change. lib/score-delta.js classifies observation deltas
 * and Q-005 sets materiality thresholds off them; a "change" that is only float dust
 * would be indistinguishable from a real one.
 */
const PRECISION = 6;
const round = (n) => (n == null ? null : Number(n.toFixed(PRECISION)));

/** Periods Yahoo reports on `earningsTrend.trend[]`; we keep the two that mandates reference. */
export const CURRENT_QUARTER = "0q";
export const CURRENT_YEAR = "0y";

/** Fields a stored snapshot must carry for a later point-in-time comparison to be valid. */
export const SNAPSHOT_FIELDS = Object.freeze([
  "epsAvg",
  "epsAnalysts",
  "revenueAvg",
  "revenueAnalysts",
  "periodEndDate",
]);

function trendFor(earningsTrend, period) {
  const trend = earningsTrend?.trend;
  if (!Array.isArray(trend)) return null;
  return trend.find((t) => t?.period === period) ?? null;
}

function isoOrNull(value) {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * Extract the point-in-time consensus vector for one ticker from a fetchFundamentals
 * result. Returns null when the module is absent so callers can record explicit
 * unavailability instead of storing an empty row that looks like real coverage.
 *
 * @param {object} fundamentals as returned by lib/yahoo.js fetchFundamentals
 * @param {{ period?: string }} [options] which reported period to snapshot
 */
export function extractConsensusSnapshot(fundamentals, { period = CURRENT_QUARTER } = {}) {
  const earningsTrend = fundamentals?.raw?.earningsTrend;
  const entry = trendFor(earningsTrend, period);
  if (!entry) return null;

  const eps = entry.earningsEstimate ?? {};
  const revenue = entry.revenueEstimate ?? {};
  const epsAvg = finite(eps.avg);
  const revenueAvg = finite(revenue.avg);
  // A consensus row with neither estimate carries no information. Recording it would
  // inflate apparent coverage and, worse, could later be differenced against a real
  // snapshot as though it were an observation.
  if (epsAvg == null && revenueAvg == null) return null;

  return {
    period,
    periodEndDate: isoOrNull(entry.endDate),
    epsAvg,
    epsAnalysts: finite(eps.numberOfAnalysts),
    epsYearAgo: finite(eps.yearAgoEps),
    revenueAvg,
    revenueAnalysts: finite(revenue.numberOfAnalysts),
    revenueYearAgo: finite(revenue.yearAgoRevenue),
    // Vendor-asserted trailing history — retained verbatim for provenance, never
    // silently merged with locally-observed history.
    vendorEpsTrend: {
      current: finite(entry.epsTrend?.current),
      days7: finite(entry.epsTrend?.["7daysAgo"]),
      days30: finite(entry.epsTrend?.["30daysAgo"]),
      days60: finite(entry.epsTrend?.["60daysAgo"]),
      days90: finite(entry.epsTrend?.["90daysAgo"]),
    },
    vendorEpsRevisions: {
      up7: finite(entry.epsRevisions?.upLast7days),
      up30: finite(entry.epsRevisions?.upLast30days),
      down7: finite(entry.epsRevisions?.downLast7Days),
      down30: finite(entry.epsRevisions?.downLast30days),
    },
    methodology: earningsTrend?.defaultMethodology ?? null,
    source: "yahoo_earnings_trend",
  };
}

/** Build a stored snapshot row, stamped with a full zoned ISO retrieval instant. */
export function consensusSnapshotRow(fundamentals, { now = () => new Date(), period = CURRENT_QUARTER } = {}) {
  const snapshot = extractConsensusSnapshot(fundamentals, { period });
  if (!snapshot) return null;
  // A date-only stamp cannot establish point-in-time provenance (same rule as
  // lib/mandate-metrics.js peerMetricsRow).
  const retrievedAt = now().toISOString();
  return { ticker: fundamentals?.ticker ?? null, retrievedAt, ...snapshot };
}

/**
 * Percent change in consensus between two locally-observed snapshots.
 * Ordered oldest → newest by the CALLER; this returns null rather than guessing
 * when either side is missing or the base is zero.
 */
export function consensusChangePct(previous, current, field = "epsAvg") {
  const from = finite(previous?.[field]);
  const to = finite(current?.[field]);
  if (from == null || to == null || from === 0) return null;
  return round(((to - from) / Math.abs(from)) * 100);
}

/**
 * Breadth of positive revisions, as a 0–1 fraction of analysts moving up.
 * `window` selects the vendor revision window ("30" default, or "7").
 * Returns null when no analyst moved either way — zero activity is not zero breadth.
 */
export function positiveRevisionBreadth(snapshot, { window = "30" } = {}) {
  const up = finite(snapshot?.vendorEpsRevisions?.[`up${window}`]);
  const down = finite(snapshot?.vendorEpsRevisions?.[`down${window}`]);
  if (up == null && down == null) return null;
  const ups = up ?? 0;
  const downs = down ?? 0;
  const total = ups + downs;
  if (total <= 0) return null;
  return round(ups / total);
}

/**
 * Revenue beat percent: EDGAR-reported ACTUAL revenue vs the consensus captured
 * BEFORE the report. `snapshot` must pre-date the filing — the caller is responsible
 * for selecting it; scoring a beat against a post-report snapshot is leakage, which is
 * exactly what Phase 3's leakage-resistant validation exists to catch.
 *
 * @param {number} actualRevenue EDGAR actual for the period
 * @param {object} snapshot a consensus snapshot retrieved before the report date
 */
export function revenueBeatPct(actualRevenue, snapshot) {
  const actual = finite(actualRevenue);
  const estimate = finite(snapshot?.revenueAvg);
  if (actual == null || estimate == null || estimate === 0) return null;
  return round(((actual - estimate) / Math.abs(estimate)) * 100);
}

/**
 * Assemble the named absolute-threshold inputs that lib/mandate-score.js consumes for
 * `revBeat` and `estimateRevisions` (config/scoring/mandate-v2.js
 * §ABSOLUTE_TABLE_REQUIREMENTS). Any input we cannot derive stays null and is recorded
 * as a reason, so the scorer rescales it out rather than scoring it zero.
 *
 * `history` is the locally-observed snapshot list for this ticker, oldest → newest.
 * The mandate's activation gate for estimate revisions is ≥3 snapshots spanning ≥30
 * days; below that this reports `insufficient_history` exactly as §5 requires.
 */
export function assembleConsensusEvidence({
  snapshot,
  history = [],
  actualRevenue = null,
  minSnapshots = 3,
  minSpanDays = 30,
} = {}) {
  const evidence = {};
  const reasons = {};
  const bound = [];

  const beatPct = revenueBeatPct(actualRevenue, snapshot);
  if (beatPct == null) {
    reasons.revBeat = actualRevenue == null ? "no_edgar_actual_for_period" : "no_revenue_consensus";
  } else {
    evidence.revBeat = { beatPct };
    bound.push("revBeat");
  }

  const ordered = history.filter((row) => row?.retrievedAt);
  const oldest = ordered[0];
  const newest = ordered[ordered.length - 1];
  const spanDays =
    oldest && newest ? (Date.parse(newest.retrievedAt) - Date.parse(oldest.retrievedAt)) / 86_400_000 : 0;

  if (ordered.length < minSnapshots || spanDays < minSpanDays) {
    reasons.estimateRevisions = "insufficient_history";
    return { evidence, reasons, boundMetrics: bound, estimateRevisionStatus: "insufficient_history" };
  }

  const changePct = consensusChangePct(oldest, newest, "epsAvg");
  const breadth = positiveRevisionBreadth(newest);
  if (changePct == null && breadth == null) {
    reasons.estimateRevisions = "no_revision_signal";
    return { evidence, reasons, boundMetrics: bound, estimateRevisionStatus: "no_revision_signal" };
  }

  // The rule tables in config/scoring/absolute-thresholds.js read SPECIFIC field names,
  // and lib/absolute-rules.js reports the whole metric `missing` the moment a rule hits an
  // absent input. Emitting only `consensusChangePct` + `positiveRevisionBreadth` therefore
  // left estimateRevisions permanently unscored for every agent: Agent 1's top band reads
  // `positiveNegativeRatio`, and all three read `positiveBreadthPct`. The derived values
  // below bind those names from the same observed data.
  const up30 = finite(newest?.vendorEpsRevisions?.up30) ?? 0;
  const down30 = finite(newest?.vendorEpsRevisions?.down30) ?? 0;
  // Mirrors the interestCoverage sentinel in lib/edgar-metrics.js: upward revisions with
  // no downward ones is an unbounded ratio, recorded as a large finite value rather than
  // Infinity so it survives JSON round-tripping.
  const positiveNegativeRatio = up30 + down30 === 0 ? null : down30 === 0 ? 999 : round(up30 / down30);

  // Agent 3's table asks for a 90-day consensus move. It is taken from LOCALLY-OBSERVED
  // history only — `vendorEpsTrend.days90` is vendor-asserted trailing data that this
  // module deliberately never merges with observed snapshots. Below a 90-day span this
  // stays null, so Agent 3's estimateRevisions rescales out until the history matures.
  // Each agent reads its own horizon of the same observed move: Agent 1 the full window,
  // Agent 2 sixty days, Agent 3 ninety. Each binds only once the observed history is at
  // least that long, so a short window is never presented as a longer one.
  const ninetyDayChangePct = spanDays >= 90 ? changePct : null;
  const sixtyDayChangePct = spanDays >= 60 ? changePct : null;

  // A reversal is the most recent leg contradicting the full observed move: revisions
  // rising over the window but falling in the last 30 days is not a positive trend.
  const recentCutoff = Date.parse(newest.retrievedAt) - 30 * 86_400_000;
  const thirtyDayBase = ordered.filter((row) => Date.parse(row.retrievedAt) <= recentCutoff).at(-1) ?? null;
  const recentChangePct = thirtyDayBase ? consensusChangePct(thirtyDayBase, newest, "epsAvg") : null;
  const net30dReversal = changePct == null || recentChangePct == null
    ? null
    : (changePct > 0 && recentChangePct < 0) || (changePct < 0 && recentChangePct > 0);

  evidence.estimateRevisions = {
    consensusChangePct: changePct,
    ...(ninetyDayChangePct == null ? {} : { consensusChangePct90d: ninetyDayChangePct }),
    ...(sixtyDayChangePct == null ? {} : { consensusChangePct60d: sixtyDayChangePct }),
    positiveRevisionBreadth: breadth,
    ...(breadth == null ? {} : { positiveBreadthPct: round(breadth * 100) }),
    ...(positiveNegativeRatio == null ? {} : { positiveNegativeRatio }),
    ...(net30dReversal == null ? {} : { net30dReversal }),
    observedSnapshots: ordered.length,
    observedSpanDays: Math.round(spanDays),
  };
  bound.push("estimateRevisions");
  return { evidence, reasons, boundMetrics: bound, estimateRevisionStatus: "active" };
}
