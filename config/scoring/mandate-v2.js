/**
 * Per-agent peer-relative scoring configuration, transcribed from the **v2.1**
 * launch-candidate mandates (agent_mandates/Agent_{One,Two,Three}_Mandate_v2_1.md
 * Section 5).
 *
 * v2.1 replaced v2.0's five-category table with FOUR categories and removed several
 * metrics entirely. Category D was then retired (2026-08-22) and its 15 points spread
 * evenly across the survivors, leaving THREE categories:
 *   A — Revenue Quality ............ 30  (was 25)
 *   B — Earnings Momentum & Est. Rev. 35  (was 30)
 *   C — Profitability, Valuation, BS  35  (was 30)
 * REMOVED (score zero, must not appear): short interest, days to cover, insider
 * BUYING, analyst price-target levels and changes, and — since 2026-08-22 —
 * institutional ownership direction + 13F accumulation (old Category D). Insider
 * SELLING is a deterministic trigger OUTSIDE the score (caps conviction one tier).
 * Estimate revisions activate only after ≥3 local snapshots spanning ≥30 days (else
 * estimate_revision_status: "insufficient_history").
 *
 * The 13F INGESTION PIPELINE IS DELIBERATELY RETAINED, unbound: `lib/thirteen-f.js`,
 * `lib/thirteen-f-dataset.js`, `lib/cusip-map.js` and `tests/thirteen-f.test.js` still
 * build and test the evidence, nothing consumes it. See todo/TODO.md to re-bind.
 * Within each category the redistribution was proportional to the prior weights, so
 * every agent's relative emphasis is preserved and each category lands on an integer.
 *
 * Every analyst shares this 4-category frame and the same peer-relative bands, thin-
 * peer fallback, and special-sector substitution map; they differ in the point split
 * within each category and in the horizon-specific DEFINITION of each metric (encoded
 * as `def` notes — the peer-ranking math is identical; the deterministic backend
 * computes the agent-appropriate value before ranking). Consumed by lib/peer-scoring.js.
 * NOT wired live (PEER_SCORING / PEER_METRICS_ENABLED off).
 */

/** Mandate `agent_id` (underscore) ↔ internal agent id (hyphen). */
export const AGENT_ID_MAP = Object.freeze({
  agent_one: "agent-1",
  agent_two: "agent-2",
  agent_three: "agent-3",
  agent_four: "agent-4",
});
export const toInternalAgentId = (mandateId) => AGENT_ID_MAP[mandateId] ?? mandateId;

/** All rankable metric ids the engine needs industry distributions for (v2.1). */
export const METRIC_IDS = Object.freeze([
  "revBeat", // A: revenue beat vs consensus (definition/points vary by agent)
  "revGrowth", // A: peer-relative revenue growth (accel / YoY / multi-year consistency)
  "epsTrajectory", // B: EPS acceleration / multi-quarter / normalized multi-year
  "estimateRevisions", // B: from local consensus snapshots (activation-gated)
  "marginTrend", // C: margin trend (level ignored)
  "peerValuation", // C: peer-relative forward valuation (lower is better)
  "balanceSheet", // C: balance-sheet strength & cash-runway quality (higher is better)
]);

/** Metrics explicitly removed from scoring (must never contribute points). */
export const REMOVED_SIGNALS = Object.freeze([
  "shortInterestTrend",
  "daysToCover",
  "insiderBuying",
  "analystPT",
  // Retired 2026-08-22 with Category D. The derivation code is still present and
  // tested (lib/thirteen-f.js) but is bound to nothing; re-binding means restoring a
  // category here, not just re-adding an id.
  "instOwnershipDir",
  "thirteenF",
]);

/** Special-sector economic substitutions (Section 5 map) — applied deterministically. */
export const SPECIAL_SECTOR_SUBSTITUTIONS = Object.freeze({
  banks: { revGrowth: "net interest income + fee-income growth", epsTrajectory: "adjusted EPS + TBVPS trajectory", marginTrend: "net interest margin / efficiency ratio / ROA-ROE", balanceSheet: "CET1 / NPAs / charge-offs / deposit funding", peerValuation: "price/tangible book + peer P/E" },
  insurers: { revGrowth: "net premiums earned / premium growth", epsTrajectory: "adjusted EPS + BVPS trajectory", marginTrend: "combined ratio / underwriting margin / reserve development", balanceSheet: "risk-based capital / reserve adequacy / leverage / liquidity", peerValuation: "price/book + peer P/E" },
  reits: { revGrowth: "same-store NOI + FFO/AFFO growth", epsTrajectory: "FFO/AFFO-per-share trajectory", marginTrend: "same-store NOI margin / occupancy / leasing spread", balanceSheet: "net debt/EBITDA / fixed-charge coverage / debt maturities", peerValuation: "price/AFFO or price/FFO + discount/premium to NAV" },
});

// Category skeletons differ per agent (point splits + metric definitions).
const catA = (revBeat, revGrowth, revGrowthDef) => ({
  label: "Revenue Quality",
  maxPoints: 30,
  metrics: {
    revBeat: { points: revBeat, higherIsBetter: true },
    revGrowth: { points: revGrowth, higherIsBetter: true, def: revGrowthDef },
  },
});
const catB = (eps, est, epsDef) => ({
  label: "Earnings Momentum & Estimate Revisions",
  maxPoints: 35,
  metrics: {
    epsTrajectory: { points: eps, higherIsBetter: true, def: epsDef },
    estimateRevisions: { points: est, higherIsBetter: true, note: "activation-gated: ≥3 snapshots / ≥30d, else insufficient_history" },
  },
});
const catC = (margin, val, bs) => ({
  label: "Profitability, Valuation & Balance Sheet",
  maxPoints: 35,
  metrics: {
    marginTrend: { points: margin, higherIsBetter: true, note: "trend only — absolute level ignored" },
    peerValuation: { points: val, higherIsBetter: false, note: "cheaper vs peers is better" },
    balanceSheet: { points: bs, higherIsBetter: true, note: "strength + cash-runway quality" },
  },
});
export const AGENT_SCORING = Object.freeze({
  "agent-1": {
    mandateId: "agent_one",
    thinPeerMin: 7,
    categories: {
      A: catA(12, 18, "acceleration of the YoY growth rate quarter-over-quarter; deceleration scores 0"),
      B: catB(21, 14, "EPS acceleration on a short-term clock"),
      C: catC(14, 9, 12),
    },
  },
  "agent-2": {
    mandateId: "agent_two",
    thinPeerMin: 7,
    categories: {
      A: { label: "Revenue Quality", maxPoints: 30, metrics: { revBeat: { points: 10, higherIsBetter: true, def: "revenue-beat consistency across recent quarters" }, revGrowth: { points: 20, higherIsBetter: true, def: "peer-relative YoY revenue growth, emphasize persistence" } } },
      B: catB(19, 16, "multi-quarter EPS trajectory (≥2 quarters of evidence)"),
      C: catC(12, 9, 14),
    },
  },
  "agent-3": {
    mandateId: "agent_three",
    thinPeerMin: 7,
    categories: {
      A: { label: "Revenue Quality", maxPoints: 30, metrics: { revBeat: { points: 6, higherIsBetter: true, def: "latest revenue quality / beat" }, revGrowth: { points: 24, higherIsBetter: true, def: "durable peer-leading growth sustained ~3yr with low variance; erratic scores poorly" } } },
      B: catB(14, 21, "normalized multi-year EPS trajectory (normalize cyclical / one-time)"),
      C: catC(9, 12, 14),
    },
  },
});

/** Conviction tier → target-weight band (% of total NAV), per agent (Section 6). */
export const TIER_SIZING = Object.freeze({
  "agent-1": { t1: [10, 15], t2: [5, 10], t3: [2, 5], noTradeBelow: 45, maxSingle: 15, minCashPct: 5, maxSectorPct: 75 },
  "agent-2": { t1: [8, 12], t2: [4, 8], t3: [2, 4], noTradeBelow: 45, maxSingle: 12, minCashPct: 5, minMarketCap: 300e6 },
  "agent-3": { entry: [5, 15], noTradeBelow: 65, maxSingle: 15, driftTrimAbove: 25, targetHoldings: [8, 15], noSpeculativeTier: true, hardValuationGate: true },
});

/**
 * Machine-readable, scalar portions of mandate v3 §5. Complex table rows (for
 * example revenue acceleration plus a persistence requirement) are deliberately
 * not collapsed into a single number here: their named inputs must be supplied by
 * the mandate-metrics adapter before they can be scored. This keeps an absent
 * observation unscored instead of silently weakening a rule.
 */
const band = (threshold, fraction) => ({ threshold, fraction });
export const ABSOLUTE_VALUATION_TABLES = Object.freeze({
  universal: Object.freeze({
    forwardPE: { higherIsBetter: false, bands: [band(15, 1), band(20, 0.75), band(25, 0.5)] },
    forwardEvEbitda: { higherIsBetter: false, bands: [band(10, 1), band(13, 0.75), band(16, 0.5)] },
    fcfYield: { higherIsBetter: true, bands: [band(0.08, 1), band(0.06, 0.75), band(0.04, 0.5)] },
    forwardPS: { higherIsBetter: false, bands: [band(2, 1), band(4, 0.75), band(6, 0.5)] },
  }),
  banks: Object.freeze({ priceToTangibleBook: { higherIsBetter: false, bands: [band(1.2, 1), band(1.6, 0.75), band(2, 0.5)] } }),
  insurers: Object.freeze({ priceToBook: { higherIsBetter: false, bands: [band(1.2, 1), band(1.6, 0.75), band(2, 0.5)] } }),
  reits: Object.freeze({ priceToAffoOrFfo: { higherIsBetter: false, bands: [band(12, 1), band(16, 0.75), band(20, 0.5)] } }),
});

/** Exact §5 source labels for the non-scalar portions to be bound by the next metrics-adapter pass. */
export const ABSOLUTE_TABLE_REQUIREMENTS = Object.freeze({
  "agent-1": Object.freeze({
    revBeat: "beatPct", revGrowth: "yoyGrowthPct + accelerationPoints", epsTrajectory: "epsGrowthPct + accelerationPoints",
    estimateRevisions: "consensusChangePct + positiveRevisionBreadth", marginTrend: "marginChangeBps",
    balanceSheet: "leverage + interestCoverage OR cashRunwayQuarters",
  }),
  "agent-2": Object.freeze({
    revBeat: "threeQuarterBeatHistory", revGrowth: "yoyGrowthPct + growthPersistence", epsTrajectory: "epsGrowthPct + epsPersistence",
    estimateRevisions: "60dConsensusChangePct + positiveRevisionBreadth + no30dReversal", marginTrend: "marginChangeBps",
    balanceSheet: "leverage + interestCoverage OR cashRunwayQuarters",
  }),
  "agent-3": Object.freeze({
    revBeat: "latestBeatPct + yoyGrowthNonDecelerating", revGrowth: "threeYearRevenueCagr + annualGrowthHistory", epsTrajectory: "threeYearNormalizedEpsCagr + annualEpsHistory",
    estimateRevisions: "90dConsensusChangePct + positiveRevisionBreadth + no30dReversal", marginTrend: "threeYearMarginChangeBps + contractionHistory",
    balanceSheet: "threeYearLeverageAndCoverageHistory",
  }),
});
