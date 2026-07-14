/**
 * Agent One universe screener — enforces the memo's investable universe before a name is
 * ever scored or sent to the AI overlay. Pure/testable: it takes candidates already
 * annotated with sector/industry, marketCap, and avgDollarVolume (from the research scan's
 * fundamentals + indicators pass) and partitions them into passed / rejected.
 *
 * Universe (Agent One v5 memo):
 *   - Sub-vertical: Software/SaaS, Semiconductors, Tech Infrastructure, Tech Hardware,
 *     or Tech-Adjacent High-Growth.
 *   - Market cap: no hard cap ceiling; micro-cap <$300M only if ADDV ≥ floor.
 *   - US equities only (instrument filtering happens upstream at the watchlist/source level).
 *
 * This is the first increment of "replace the static watchlist with a dynamic hunt": today
 * it filters whatever candidate list it's handed; a periodically-refreshed NASDAQ/NYSE tech
 * source list can feed the same filter later without changing this logic.
 */

import { classifySubVertical } from "./indicators.js";

const MICROCAP_CEILING = 300_000_000; // <$300M = micro-cap, subject to the liquidity floor

/**
 * @param {object[]} candidates  each: { ticker, sector, industry, marketCap, avgDollarVolume }
 * @param {object} [limits]      agent risk-limits (microCapMinAvgDollarVolume)
 * @returns {{ passed: object[], rejected: {ticker:string, reason:string}[] }}
 */
export function screenUniverse(candidates = [], limits = {}) {
  const floor = limits.microCapMinAvgDollarVolume ?? 3_000_000;
  const allowed = new Set(
    limits.allowedSubVerticals ?? [
      "Software/SaaS",
      "Semiconductors",
      "Tech Infrastructure",
      "Tech Hardware",
      "Tech-Adjacent High-Growth",
    ]
  );
  const passed = [];
  const rejected = [];

  for (const c of candidates) {
    const subVertical = c.subVertical ?? classifySubVertical(c);
    if (!subVertical || !allowed.has(subVertical)) {
      rejected.push({ ticker: c.ticker, reasonCode: "outside_approved_subvertical", reason: "outside Agent One v5 approved tech sub-verticals" });
      continue;
    }

    const cap = c.marketCap;
    if (cap == null) {
      rejected.push({ ticker: c.ticker, reasonCode: "market_cap_unavailable", reason: "market cap unavailable — cannot verify universe band" });
      continue;
    }
    if (cap < MICROCAP_CEILING) {
      const addv = c.avgDollarVolume;
      if (addv == null) {
        rejected.push({ ticker: c.ticker, reasonCode: "microcap_addv_unavailable", reason: "micro-cap with no ADDV — liquidity unverifiable (NO_TRADE)" });
        continue;
      }
      if (addv < floor) {
        rejected.push({ ticker: c.ticker, reasonCode: "microcap_addv_below_floor", reason: `micro-cap ADDV $${human(addv)} below $${human(floor)} floor` });
        continue;
      }
    }

    passed.push({ ...c, subVertical });
  }

  return { passed, rejected };
}

function human(n) {
  return Math.round(n).toLocaleString();
}
