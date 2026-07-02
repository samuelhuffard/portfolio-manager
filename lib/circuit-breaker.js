/**
 * Portfolio drawdown circuit breakers (Agent One memo v5 / LOOP-DESIGN.md §2 step 5).
 *
 * Deterministic, runs BEFORE any agent's research loop. Drawdown is measured
 * against a high-water mark on NAV per unit when available (deposit/withdrawal
 * neutral), falling back to total portfolio value with a warning basis.
 *
 * Tiers only ever restrict — they never authorize anything:
 *   NONE          — no restriction
 *   REDUCE        — ≥8% drawdown: new BUY proposal sizing halved
 *   NO_NEW_BUYS   — ≥12%: no new BUY proposals (SELLs still allowed)
 *   EXITS_ONLY    — ≥15%: only SELL proposals allowed
 *   HALT          — ≥20%: no proposals at all; human attention required
 *   UNKNOWN       — no portfolio measure available: BUYs blocked loudly
 *                   (a breaker that can't see can't wave money through)
 *
 * Pure functions — Redis persistence of the HWM/state lives in lib/redis.js.
 */

const TIERS = [
  { minDrawdownPct: 20, tier: "HALT" },
  { minDrawdownPct: 15, tier: "EXITS_ONLY" },
  { minDrawdownPct: 12, tier: "NO_NEW_BUYS" },
  { minDrawdownPct: 8, tier: "REDUCE" },
];

/**
 * @param current  latest NAV/unit (preferred) or total portfolio value
 * @param highWaterMark  prior HWM on the same basis (null on first run)
 * @returns { tier, drawdownPct, highWaterMark } — highWaterMark is the NEW hwm to persist
 */
export function assessCircuitBreaker({ current, highWaterMark }) {
  if (current == null || !Number.isFinite(current) || current <= 0) {
    return { tier: "UNKNOWN", drawdownPct: null, highWaterMark: highWaterMark ?? null };
  }
  const hwm = Math.max(current, Number.isFinite(highWaterMark) ? highWaterMark : 0) || current;
  const drawdownPct = hwm > 0 ? ((hwm - current) / hwm) * 100 : 0;
  const match = TIERS.find((t) => drawdownPct >= t.minDrawdownPct);
  return {
    tier: match ? match.tier : "NONE",
    drawdownPct: Math.round(drawdownPct * 100) / 100,
    highWaterMark: hwm,
  };
}

/**
 * Applies the active tier to a sized proposal. Restrict-only: the breaker can
 * block or shrink a proposal, never enlarge or unblock one.
 * @returns { allowed, amountDollars, note }
 */
export function applyBreakerToProposal(tier, side, amountDollars) {
  switch (tier) {
    case "NONE":
      return { allowed: true, amountDollars, note: null };
    case "REDUCE":
      if (side === "BUY") {
        const halved = Math.round((amountDollars / 2) * 100) / 100;
        return { allowed: halved > 0, amountDollars: halved, note: `circuit_breaker REDUCE: BUY sizing halved to $${halved}` };
      }
      return { allowed: true, amountDollars, note: null };
    case "NO_NEW_BUYS":
      if (side === "BUY") return { allowed: false, amountDollars: 0, note: "circuit_breaker NO_NEW_BUYS: BUY proposals suspended at ≥12% drawdown" };
      return { allowed: true, amountDollars, note: null };
    case "EXITS_ONLY":
      if (side === "BUY") return { allowed: false, amountDollars: 0, note: "circuit_breaker EXITS_ONLY: BUY proposals suspended at ≥15% drawdown" };
      return { allowed: true, amountDollars, note: "circuit_breaker EXITS_ONLY active" };
    case "HALT":
      return { allowed: false, amountDollars: 0, note: "circuit_breaker HALT: all proposals suspended at ≥20% drawdown — manual review required" };
    case "UNKNOWN":
    default:
      if (side === "BUY") return { allowed: false, amountDollars: 0, note: "circuit_breaker UNKNOWN: no portfolio measure available — BUYs blocked until valuation data returns" };
      return { allowed: true, amountDollars, note: "circuit_breaker UNKNOWN: SELL allowed, valuation data missing" };
  }
}
