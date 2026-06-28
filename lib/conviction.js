/**
 * Agent One conviction scorer — turns the memo's signal-grading + position-sizing tiers
 * into a deterministic conviction tier and a target-weight ceiling. Pure/testable; the
 * research scan assembles signals from a candidate, then this caps how large the AI overlay
 * is allowed to size the name (a Speculative single-signal micro-cap can't be sized like a
 * High-conviction setup).
 *
 * Signal grading (memo):
 *   Strong (need ≥2 aligned to qualify): EPS acceleration, earnings surprise + drift,
 *     margin expansion, revenue growth w/ improving unit economics, post-earnings momentum.
 *   Confirmatory (sizing/timing only): RSI trend, relative strength, MACD, fwd<trailing P/E.
 *   Weak (excluded): sentiment, analyst PTs w/o revisions, generic tailwinds, chartism.
 *
 * Sizing tiers (memo):
 *   High (≥2 strong + imminent catalyst + bullish price confirm) → 10–15%
 *   Medium (strong fundamentals, no near catalyst, confirmatory technicals) → 5–10%
 *   Speculative/early (single strong signal, thin history) → 2–5%
 */

const STRONG_EARNINGS_GROWTH = 0.15; // 15% YoY+ earnings growth = EPS-acceleration proxy
const STRONG_REVENUE_GROWTH = 0.15;
const STRONG_GROSS_MARGIN = 0.5; // healthy software/semis gross margin
const POST_EARNINGS_MOMENTUM = 0.05; // +5% 1-month
const EARNINGS_BEAT_PCT = 5; // ≥5% EPS beat
const CATALYST_WINDOW_DAYS = 14; // earnings within two weeks = imminent catalyst

/**
 * Derive the memo's strong/confirmatory signal booleans from a research-scan candidate.
 * Margin *trend* and earnings *drift* need history we don't yet persist — V1 uses current
 * margin level and 1-month momentum as documented proxies (see AGENT-ONE-PLAN.md gap #5).
 */
export function assembleEntrySignals(c = {}, { now = new Date() } = {}) {
  const fd = c.raw?.financialData ?? {};
  const dks = c.raw?.defaultKeyStatistics ?? {};
  const sd = c.raw?.summaryDetail ?? {};

  const strong = {
    epsAcceleration: typeof fd.earningsGrowth === "number" && fd.earningsGrowth >= STRONG_EARNINGS_GROWTH,
    revenueGrowthQuality:
      typeof fd.revenueGrowth === "number" &&
      fd.revenueGrowth >= STRONG_REVENUE_GROWTH &&
      typeof fd.profitMargins === "number" &&
      fd.profitMargins > 0,
    marginExpansion: typeof fd.grossMargins === "number" && fd.grossMargins >= STRONG_GROSS_MARGIN,
    postEarningsMomentum: typeof c.momentum1m === "number" && c.momentum1m >= POST_EARNINGS_MOMENTUM,
    earningsSurprise: typeof c.epsSurprisePct === "number" && c.epsSurprisePct >= EARNINGS_BEAT_PCT,
  };
  const strongSignals = Object.keys(strong).filter((k) => strong[k]);

  const confirmatory = {
    rsiHealthy: typeof c.rsi === "number" && c.rsi >= 50 && c.rsi <= 70,
    fwdPeBelowTrailing:
      typeof dks.forwardPE === "number" && typeof sd.trailingPE === "number" && dks.forwardPE < sd.trailingPE,
    priceConfirm: typeof c.momentum3m === "number" && c.momentum3m > 0,
  };

  // Catalyst proximity from the next earnings date (calendarEvents).
  let catalystImminent = false;
  const earningsDate = c.nextEarningsDate ? new Date(c.nextEarningsDate) : null;
  if (earningsDate && !Number.isNaN(earningsDate.getTime())) {
    const days = (earningsDate.getTime() - now.getTime()) / 86_400_000;
    catalystImminent = days >= 0 && days <= CATALYST_WINDOW_DAYS;
  }

  return {
    strong,
    strongSignals,
    strongCount: strongSignals.length,
    confirmatory,
    priceConfirm: confirmatory.priceConfirm && confirmatory.rsiHealthy,
    catalystImminent,
  };
}

/**
 * Resolve a conviction tier and the target-weight ceiling the AI overlay must size within.
 *
 * @param {{strongCount:number, catalystImminent:boolean, priceConfirm:boolean}} signals
 * @param {object} [limits] agent risk-limits (maxPositionPct / minPositionPct)
 * @returns {{ tier:string, qualified:boolean, targetWeightPct:number, maxWeightPct:number, range:[number,number], reasons:string[] }}
 */
export function assessConviction(signals = {}, limits = {}) {
  const { strongCount = 0, catalystImminent = false, priceConfirm = false } = signals;
  const maxPos = limits.maxPositionPct ?? 15;
  const minPos = limits.minPositionPct ?? 2;
  const reasons = [];

  // Qualification gate: the memo requires ≥2 aligned strong signals to BUY at full size.
  if (strongCount >= 2 && catalystImminent && priceConfirm) {
    reasons.push(`High: ${strongCount} strong signals + imminent catalyst + price confirmation`);
    return tier("High", true, 12.5, Math.min(maxPos, 15), [10, Math.min(maxPos, 15)], reasons);
  }
  if (strongCount >= 2) {
    reasons.push(`Medium: ${strongCount} strong signals, catalyst/price not both confirmed`);
    return tier("Medium", true, 7.5, 10, [5, 10], reasons);
  }
  if (strongCount === 1) {
    reasons.push("Speculative: single strong signal / thin confirmation");
    return tier("Speculative", true, 3.5, 5, [minPos, 5], reasons);
  }
  reasons.push("Unqualified: fewer than one strong signal — no entry");
  return tier("None", false, 0, 0, [0, 0], reasons);
}

function tier(name, qualified, targetWeightPct, maxWeightPct, range, reasons) {
  return { tier: name, qualified, targetWeightPct, maxWeightPct, range, reasons };
}
