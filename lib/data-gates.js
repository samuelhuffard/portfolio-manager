/**
 * Backend-enforced data-availability gates for Agent One. Per the memo, the agent must
 * NOT be trusted to self-certify that its inputs are present and fresh — the backend
 * checks, and any stale/missing required field forces NO_TRADE before the (expensive) AI
 * overlay ever runs. This is the primary gate; lib/risk-engine.js#applyRiskChecks has a
 * second `dataStale` backstop on the way out.
 *
 * Pure and side-effect-free so it's unit-testable. Caller assembles `input` from
 * lib/yahoo.js fundamentals + lib/indicators.js outputs.
 */

const MICROCAP_CEILING = 300_000_000; // <$300M = micro-cap, subject to the liquidity floor.

/**
 * @param {object} input
 * @param {number|null} input.price            current/last price
 * @param {number|null} input.trailingEps
 * @param {number|null} input.forwardEps
 * @param {number|null} input.grossMargins
 * @param {number|null} input.profitMargins
 * @param {number|null} input.rsi              latest RSI(14), or null if uncomputable
 * @param {Date|null}   input.lastBarDate      date of the most recent daily bar
 * @param {number|null} input.marketCap
 * @param {number|null} input.avgDollarVolume  ADDV from lib/indicators.js
 * @param {object} limits  agent risk-limits.json (microCapMinAvgDollarVolume)
 * @param {object} [opts]
 * @param {Date}   [opts.now]
 * @param {number} [opts.maxBarAgeDays]  bars older than this (calendar days) are stale
 * @returns {{ ok: boolean, stale: boolean, missing: string[], reasons: string[] }}
 */
export function evaluateDataGates(input, limits = {}, { now = new Date(), maxBarAgeDays = 4 } = {}) {
  const missing = [];
  const reasons = [];
  let stale = false;

  const requirePresent = (value, field) => {
    if (value == null || (typeof value === "number" && Number.isNaN(value))) missing.push(field);
  };

  requirePresent(input.price, "price");
  requirePresent(input.trailingEps, "trailingEps");
  requirePresent(input.forwardEps, "forwardEps");
  // Margin trend over the prior four quarters is ideal; we gate on at least a current
  // margin reading being present (4-quarter history is a later enhancement).
  if (input.grossMargins == null && input.profitMargins == null) missing.push("marginTrend");
  requirePresent(input.rsi, "rsi");

  // Price/RSI must be current within roughly the last trading session.
  if (!input.lastBarDate) {
    missing.push("recentBars");
  } else {
    const ageDays = (now.getTime() - new Date(input.lastBarDate).getTime()) / 86_400_000;
    if (ageDays > maxBarAgeDays) {
      stale = true;
      reasons.push(`price data is ${ageDays.toFixed(1)} days old (> ${maxBarAgeDays}d)`);
    }
  }

  // Micro-cap liquidity floor: if we can't verify the cap band or ADDV, that itself is a
  // NO_TRADE (the memo: "If liquidity data is unavailable, NO_TRADE").
  if (input.marketCap == null) {
    missing.push("marketCap");
  } else if (input.marketCap < MICROCAP_CEILING) {
    const floor = limits.microCapMinAvgDollarVolume ?? 3_000_000;
    if (input.avgDollarVolume == null) {
      missing.push("avgDollarVolume");
    } else if (input.avgDollarVolume < floor) {
      reasons.push(
        `micro-cap ADDV $${Math.round(input.avgDollarVolume).toLocaleString()} below $${floor.toLocaleString()} floor`
      );
    }
  }

  if (missing.length) reasons.unshift(`missing required data: ${missing.join(", ")}`);

  return {
    ok: missing.length === 0 && !stale && reasons.length === 0,
    stale: stale || missing.length > 0,
    missing,
    reasons,
  };
}
