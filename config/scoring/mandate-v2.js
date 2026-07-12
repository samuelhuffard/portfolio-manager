/**
 * Per-agent peer-relative scoring configuration, transcribed from the **v2.1**
 * launch-candidate mandates (agent_mandates/Agent_{One,Two,Three}_Mandate_v2_1.md
 * Section 5).
 *
 * v2.1 replaced v2.0's five-category table with FOUR categories and removed several
 * metrics entirely:
 *   A — Revenue Quality ............ 25
 *   B — Earnings Momentum & Est. Rev. 30
 *   C — Profitability, Valuation, BS  30
 *   D — Institutional Ownership/13F   15
 * REMOVED (score zero, must not appear): short interest, days to cover, insider
 * BUYING, analyst price-target levels and changes. Insider SELLING is a deterministic
 * trigger OUTSIDE the score (caps conviction one tier). Estimate revisions activate
 * only after ≥3 local snapshots spanning ≥30 days (else estimate_revision_status:
 * "insufficient_history").
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
  "instOwnershipDir", // D: institutional ownership direction
  "thirteenF", // D: latest 13F accumulation (delayed, labeled)
]);

/** Metrics explicitly removed from scoring in v2.1 (must never contribute points). */
export const REMOVED_SIGNALS = Object.freeze([
  "shortInterestTrend",
  "daysToCover",
  "insiderBuying",
  "analystPT",
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
  maxPoints: 25,
  metrics: {
    revBeat: { points: revBeat, higherIsBetter: true },
    revGrowth: { points: revGrowth, higherIsBetter: true, def: revGrowthDef },
  },
});
const catB = (eps, est, epsDef) => ({
  label: "Earnings Momentum & Estimate Revisions",
  maxPoints: 30,
  metrics: {
    epsTrajectory: { points: eps, higherIsBetter: true, def: epsDef },
    estimateRevisions: { points: est, higherIsBetter: true, note: "activation-gated: ≥3 snapshots / ≥30d, else insufficient_history" },
  },
});
const catC = (margin, val, bs) => ({
  label: "Profitability, Valuation & Balance Sheet",
  maxPoints: 30,
  metrics: {
    marginTrend: { points: margin, higherIsBetter: true, note: "trend only — absolute level ignored" },
    peerValuation: { points: val, higherIsBetter: false, note: "cheaper vs peers is better" },
    balanceSheet: { points: bs, higherIsBetter: true, note: "strength + cash-runway quality" },
  },
});
const catD = (inst, thirteenF) => ({
  label: "Institutional Ownership & 13F Activity",
  maxPoints: 15,
  metrics: {
    instOwnershipDir: { points: inst, higherIsBetter: true },
    thirteenF: { points: thirteenF, higherIsBetter: true, note: "delayed ownership confirmation; record quarter + filing date" },
  },
});

export const AGENT_SCORING = Object.freeze({
  "agent-1": {
    mandateId: "agent_one",
    thinPeerMin: 7,
    categories: {
      A: catA(10, 15, "acceleration of the YoY growth rate quarter-over-quarter; deceleration scores 0"),
      B: catB(18, 12, "EPS acceleration on a short-term clock"),
      C: catC(12, 8, 10),
      D: catD(9, 6),
    },
  },
  "agent-2": {
    mandateId: "agent_two",
    thinPeerMin: 7,
    categories: {
      A: { label: "Revenue Quality", maxPoints: 25, metrics: { revBeat: { points: 8, higherIsBetter: true, def: "revenue-beat consistency across recent quarters" }, revGrowth: { points: 17, higherIsBetter: true, def: "peer-relative YoY revenue growth, emphasize persistence" } } },
      B: catB(16, 14, "multi-quarter EPS trajectory (≥2 quarters of evidence)"),
      C: catC(10, 8, 12),
      D: catD(10, 5),
    },
  },
  "agent-3": {
    mandateId: "agent_three",
    thinPeerMin: 7,
    categories: {
      A: { label: "Revenue Quality", maxPoints: 25, metrics: { revBeat: { points: 5, higherIsBetter: true, def: "latest revenue quality / beat" }, revGrowth: { points: 20, higherIsBetter: true, def: "durable peer-leading growth sustained ~3yr with low variance; erratic scores poorly" } } },
      B: catB(12, 18, "normalized multi-year EPS trajectory (normalize cyclical / one-time)"),
      C: catC(8, 10, 12),
      D: catD(7, 8),
    },
  },
});

/** Conviction tier → target-weight band (% of total NAV), per agent (Section 6). */
export const TIER_SIZING = Object.freeze({
  "agent-1": { t1: [10, 15], t2: [5, 10], t3: [2, 5], noTradeBelow: 45, maxSingle: 15, minCashPct: 5, maxSectorPct: 75 },
  "agent-2": { t1: [8, 12], t2: [4, 8], t3: [2, 4], noTradeBelow: 45, maxSingle: 12, minCashPct: 5, minMarketCap: 300e6 },
  "agent-3": { entry: [5, 15], noTradeBelow: 65, maxSingle: 15, driftTrimAbove: 25, targetHoldings: [8, 15], noSpeculativeTier: true, hardValuationGate: true },
});
