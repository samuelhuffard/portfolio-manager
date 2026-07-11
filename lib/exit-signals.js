/**
 * Agent One held-position exit logic (the memo's T1/T2/T3 framework + combined-logic table).
 *
 * Pure and side-effect-free so the decision rules are unit-testable in isolation.
 * jobs/monitor-positions.js assembles the raw inputs (daily bars, benchmark closes, the
 * latest fundamental event) and calls evaluateExitSignals() → resolveExitAction(). The
 * resolver ONLY ever produces a proposal (SELL/TRIM/HOLD/NO_TRADE) — nothing here places a
 * trade. lib/risk-engine.js + the /approvals queue remain the hard boundary downstream.
 *
 * Triggers (from config/agents/agent-1/AGENT-ONE-PLAN.md):
 *   T1 Volatility-adjusted weekly decline — price drop alone NEVER auto-sells; must cross-ref T2/T3.
 *   T2 Momentum reversal — RSI<40 & falling, MACD bearish crossover 2 sessions, RS vs benchmark
 *      declining 3+ weeks. Momentum alone → partial exit (reduce 30–50%).
 *   T3 Fundamental deterioration — highest weight, alone sufficient for a full exit.
 */

import {
  rsi,
  macd,
  volAdjustedDeclineTriggered,
  relativeStrength,
} from "./indicators.js";

/**
 * Compute the three exit-trigger booleans (plus supporting detail) for one held position.
 *
 * @param {object} input
 * @param {number[]} input.closes            daily closes for the name (oldest→newest)
 * @param {number[]} [input.benchmarkCloses] daily closes for the sub-vertical benchmark (IGV/SOXX)
 * @param {object}   [input.fundamental]     latest fundamental read used for T3
 * @param {number}   [input.fundamental.epsSurprisePct]   actual-vs-estimate EPS surprise, % (neg = miss)
 * @param {number}   [input.fundamental.revSurprisePct]   actual-vs-estimate revenue surprise, %
 * @param {boolean}  [input.fundamental.guidanceCut]
 * @param {boolean}  [input.fundamental.marginCompression]
 * @param {boolean}  [input.fundamental.credibilityEvent] restatement / surprise CFO exit / material adverse filing
 * @param {object}   [input.partialData]     available-data state for existing holdings
 * @param {number}   [input.partialData.availableDataScore] 0-100 score from lib/data-gates.js
 * @param {string[]} [input.partialData.missing] missing critical fields
 * @param {number}   [input.partialData.consecutiveMissingCriticalReviews]
 * @param {object}   [opts]
 * @param {number}   [opts.t1Multiple]   vol multiple for T1 (default 1.75, midpoint of 1.5–2.0)
 * @param {number}   [opts.missThresholdPct]  EPS/rev miss magnitude that counts as T3 (default 5)
 * @returns {{
 *   t1: boolean, t2: boolean, t3: boolean,
 *   dataUnavailable: boolean,
 *   detail: object,
 *   reasons: string[]
 * }}
 */
export function evaluateExitSignals(input, opts = {}) {
  const { closes = [], benchmarkCloses = null, fundamental = null, partialData = null } = input;
  const { t1Multiple = 1.75, missThresholdPct = 5 } = opts;

  const reasons = [];
  const detail = {};

  // --- Data sufficiency: T1/T2 need enough price history. ---
  // volAdjustedDeclineTriggered + rsi/macd return null when there isn't enough data.
  const decline = volAdjustedDeclineTriggered(closes, { multiple: t1Multiple });
  const rsiNow = rsi(closes, 14);
  const rsiPrev = rsi(closes.slice(0, -1), 14);
  const macdRes = macd(closes);

  const priceDataMissing = decline == null || rsiNow == null || macdRes == null;

  // --- T1: volatility-adjusted weekly decline ---
  let t1 = false;
  if (decline) {
    t1 = decline.triggered;
    detail.t1 = decline;
    if (t1) {
      reasons.push(
        `T1: weekly return ${(decline.weekReturn * 100).toFixed(1)}% breached the ` +
          `${(decline.thresholdReturn * 100).toFixed(1)}% vol-adjusted threshold`
      );
    }
  }

  // --- T2: momentum reversal (RSI<40 & falling, MACD bearish 2 sessions, RS declining 3+ wks) ---
  let t2 = false;
  if (!priceDataMissing) {
    const rsiFalling = rsiPrev != null && rsiNow < rsiPrev;
    const rsiWeak = rsiNow < 40 && rsiFalling;
    const macdBearish = macdRes.bearishCrossoverConfirmed === true;

    let rsWeak = false;
    if (benchmarkCloses && benchmarkCloses.length) {
      const rs = relativeStrength(closes, benchmarkCloses);
      detail.relativeStrength = rs;
      rsWeak = rs != null && rs.consecutiveDecliningWeeks >= 3;
    }

    detail.t2 = { rsiNow, rsiPrev, rsiWeak, macdBearish, rsWeak };
    // Memo lists three momentum signals; any holding both an oscillator break (RSI or MACD)
    // is the core reversal tell. Treat RSI-weak OR confirmed MACD bearish as the momentum
    // break, with declining relative strength reinforcing it.
    t2 = (rsiWeak || macdBearish) && (rsiWeak ? true : rsWeak || macdBearish);
    if (t2) {
      const bits = [];
      if (rsiWeak) bits.push(`RSI ${rsiNow.toFixed(0)} <40 & falling`);
      if (macdBearish) bits.push("MACD bearish crossover (2 sessions)");
      if (rsWeak) bits.push(`relative strength declining ${detail.relativeStrength.consecutiveDecliningWeeks} wks`);
      reasons.push(`T2: momentum reversal — ${bits.join(", ")}`);
    }
  }

  // --- T3: fundamental deterioration (input-driven; the job assembles it) ---
  let t3 = false;
  if (fundamental) {
    const epsMiss = typeof fundamental.epsSurprisePct === "number" && fundamental.epsSurprisePct < -missThresholdPct;
    const revMiss = typeof fundamental.revSurprisePct === "number" && fundamental.revSurprisePct < -missThresholdPct;
    const flags = [];
    if (epsMiss) flags.push(`EPS miss ${fundamental.epsSurprisePct.toFixed(1)}%`);
    if (revMiss) flags.push(`revenue miss ${fundamental.revSurprisePct.toFixed(1)}%`);
    if (fundamental.guidanceCut) flags.push("guidance cut");
    if (fundamental.marginCompression) flags.push("margin compression");
    if (fundamental.credibilityEvent) flags.push("credibility event");
    t3 = flags.length > 0;
    detail.t3 = { flags };
    if (t3) reasons.push(`T3: fundamental deterioration — ${flags.join(", ")}`);
  }

  let partialDataExit = null;
  const availableDataScore =
    partialData && Number.isFinite(Number(partialData.availableDataScore))
      ? Number(partialData.availableDataScore)
      : null;
  const missingFields = Array.isArray(partialData?.missing) ? partialData.missing.filter(Boolean) : [];
  const consecutiveMissingCriticalReviews = Number(partialData?.consecutiveMissingCriticalReviews ?? 0);
  if (availableDataScore != null) {
    detail.partialData = { availableDataScore, missing: missingFields, consecutiveMissingCriticalReviews };
    if (availableDataScore < 35) {
      partialDataExit = {
        action: "SELL",
        reducePct: 100,
        reason: `partial-data defensive rule: available data score ${availableDataScore} < 35${missingFields.length ? ` (missing ${missingFields.join(", ")})` : ""}`,
      };
      reasons.push(partialDataExit.reason);
    } else if (availableDataScore <= 50) {
      partialDataExit = {
        action: "TRIM",
        reducePct: 40,
        reason: `partial-data defensive rule: available data score ${availableDataScore} in 35-50 trim band${missingFields.length ? ` (missing ${missingFields.join(", ")})` : ""}`,
      };
      reasons.push(partialDataExit.reason);
    } else if (consecutiveMissingCriticalReviews >= 2 && missingFields.length) {
      partialDataExit = {
        action: "TRIM",
        reducePct: 50,
        reason: `partial-data defensive rule: ${consecutiveMissingCriticalReviews} consecutive reviews missing critical data (${missingFields.join(", ")})`,
      };
      reasons.push(partialDataExit.reason);
    }
  }

  // Data is "unavailable" for an actionable call only when the price-based triggers can't be
  // computed AND we also have no fundamental read to act on.
  const dataUnavailable = priceDataMissing && !t3 && !partialDataExit;

  return { t1, t2, t3, partialDataExit, dataUnavailable, detail, reasons };
}

/**
 * Resolve the combined-logic table to a single proposal action.
 *
 * @param {{t1:boolean,t2:boolean,t3:boolean,dataUnavailable:boolean,reasons?:string[]}} signals
 * @param {object} [opts]
 * @param {number} [opts.trimPct]  partial-exit reduction for momentum-only (default 40, mid of 30–50)
 * @returns {{ action: "SELL"|"TRIM"|"HOLD"|"NO_TRADE", reducePct: number, speed: string, reasons: string[] }}
 */
export function resolveExitAction(signals, opts = {}) {
  const { t1, t2, t3, partialDataExit, dataUnavailable } = signals;
  const { trimPct = 40 } = opts;
  const reasons = signals.reasons ? [...signals.reasons] : [];

  if (dataUnavailable) {
    return { action: "NO_TRADE", reducePct: 0, speed: "do not act", reasons: ["data unavailable / stale — flag, do not act"] };
  }

  // T3 alone is sufficient for a full exit; with all three it's immediate/same-session.
  if (t3) {
    const speed = t1 && t2 ? "same session if liquid" : "1–2 sessions";
    return { action: "SELL", reducePct: 100, speed, reasons };
  }

  if (partialDataExit?.action === "SELL") {
    return { action: "SELL", reducePct: 100, speed: "1-2 sessions", reasons };
  }

  if (partialDataExit?.action === "TRIM") {
    return { action: "TRIM", reducePct: partialDataExit.reducePct ?? trimPct, speed: "re-eval next review", reasons };
  }

  // Price drop + momentum reversal (no fundamental break) → full exit.
  if (t1 && t2) {
    return { action: "SELL", reducePct: 100, speed: "1–2 sessions", reasons };
  }

  // Momentum reversal only → partial exit (reduce 30–50%), re-eval weekly.
  if (t2) {
    return { action: "TRIM", reducePct: trimPct, speed: "re-eval weekly", reasons };
  }

  // Price drop only (T1 alone) → hold + flag; price alone never auto-sells.
  if (t1) {
    return { action: "HOLD", reducePct: 0, speed: "monitor daily", reasons: [...reasons, "T1 alone — flag for review, no auto-sell"] };
  }

  return { action: "HOLD", reducePct: 0, speed: "monitor daily", reasons: ["no exit trigger active"] };
}
