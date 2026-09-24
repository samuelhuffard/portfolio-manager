/**
 * Deterministic "dual red" macro gate every agent's mandate treats as an
 * absolute rule: SPY below its 200-day average, and/or the 10-year Treasury
 * yield having moved more than a threshold over the trailing ~30 trading
 * days. Per data-gates.js's own principle, the AI must not be trusted to
 * self-certify this from raw numbers in a prompt — this module computes it
 * deterministically instead. Pure and side-effect free; callers fetch the
 * inputs (lib/fred.js, lib/yahoo.js) and pass plain numbers in.
 *
 * A red flag is only ever true/false when its input data is actually present.
 * Missing data yields null (unknown), never a guessed true/false — an unknown
 * flag does not count toward redCount/dualRed, matching this codebase's
 * fail-closed-on-the-risky-action-only philosophy: absent macro data means
 * the deterministic gate stays silent rather than fabricating a block or a
 * false-clear.
 */

import { MANDATE_POLICIES } from "../config/agents/mandate-policy.js";

/**
 * @param {object} input
 * @param {number|null} input.spyPrice
 * @param {number|null} input.spySma200
 * @param {number|null} input.treasuryYieldChangeBps  signed change over the trailing window
 * @param {number} [thresholdBps] absolute bps move that counts as "rate pressure red"
 */
export function evaluateMacroRedFlags({ spyPrice, spySma200, treasuryYieldChangeBps }, thresholdBps = 50) {
  const spyRed = Number.isFinite(spyPrice) && Number.isFinite(spySma200) ? spyPrice < spySma200 : null;
  const rateRed = Number.isFinite(treasuryYieldChangeBps) ? Math.abs(treasuryYieldChangeBps) > thresholdBps : null;
  const knownFlags = [spyRed, rateRed].filter((flag) => flag !== null);
  const redCount = knownFlags.filter(Boolean).length;
  return {
    spyRed,
    rateRed,
    redCount,
    dualRed: spyRed === true && rateRed === true,
  };
}

/** Plain-text summary for the AI prompt — a stated fact, not raw numbers to reason over. */
export function formatMacroRedFlags(flags) {
  if (!flags) return null;
  const describe = (label, value) => `${label}: ${value === null ? "unavailable" : value ? "RED" : "green"}`;
  return [describe("SPY below 200-day average", flags.spyRed), describe("10-year rate pressure", flags.rateRed)].join("\n");
}

/**
 * Apply the mandate's single-red macro sizing discipline to an already
 * risk-checked BUY. This is deliberately an upper-bound-only transform: it
 * never creates a BUY or raises a requested size. A known red condition keeps
 * its ceiling even when the other macro feed is unavailable; missing data must
 * not turn an observed risk condition into an uncapped BUY. The target tier and its range come from the canonical
 * specialist policy table rather than a second live sizing table.
 */
export function applySingleRedMacroTierCap(rec, { agentId, macroRedFlags, policies = MANDATE_POLICIES } = {}) {
  if (rec?.action !== "BUY" || !Number.isFinite(rec.targetWeight)) return rec;

  const policy = policies?.[agentId];
  const tierName = policy?.macro?.singleRedTierCap;
  const flags = [macroRedFlags?.spyRed, macroRedFlags?.rateRed];
  // One known red is sufficient for the Tier-2 ceiling. A second known red is
  // handled by the stronger dual-red gate elsewhere; an unavailable second
  // feed must never provide a route around an observed red condition.
  const isSingleRed = flags.filter((flag) => flag === true).length === 1
    && flags.filter((flag) => flag === false || flag === null).length === 1;
  if (!tierName || !isSingleRed) return rec;

  const tier = policy.score?.tiers?.find((candidate) => candidate.name === tierName);
  const upperBoundPct = tier?.targetWeight?.[1];
  if (!Number.isFinite(upperBoundPct)) return rec;
  if (rec.targetWeight <= upperBoundPct) {
    return {
      ...rec,
      overrideNotes: [
        ...(rec.overrideNotes ?? []),
        `macro_single_red_tier_cap: ${tierName} ceiling ${upperBoundPct}% retained ${rec.targetWeight}%`,
      ],
    };
  }

  return {
    ...rec,
    targetWeight: upperBoundPct,
    overrideNotes: [
      ...(rec.overrideNotes ?? []),
      `macro_single_red_tier_cap: ${tierName} capped ${rec.targetWeight}%→${upperBoundPct}%`,
    ],
  };
}
