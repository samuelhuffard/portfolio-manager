/**
 * Agent One universe screener — enforces the memo's investable universe before a name is
 * ever scored or sent to the AI overlay. Pure/testable: it takes candidates already
 * annotated with sector/industry, marketCap, and avgDollarVolume (from the research scan's
 * fundamentals + indicators pass) and partitions them into passed / rejected.
 *
 * Universe (memo):
 *   - Sub-vertical: Software/SaaS or Semiconductors only (consumer/retail excluded).
 *   - Market cap: large-cap >$10B excluded; micro-cap <$300M only if ADDV ≥ floor.
 *   - US equities only (instrument filtering happens upstream at the watchlist/source level).
 *
 * This is the first increment of "replace the static watchlist with a dynamic hunt": today
 * it filters whatever candidate list it's handed; a periodically-refreshed NASDAQ/NYSE tech
 * source list can feed the same filter later without changing this logic.
 */

import { classifySubVertical } from "./indicators.js";

const LARGE_CAP_CEILING = 10_000_000_000; // >$10B = large-cap, excluded
const MICROCAP_CEILING = 300_000_000; // <$300M = micro-cap, subject to the liquidity floor

/**
 * @param {object[]} candidates  each: { ticker, sector, industry, marketCap, avgDollarVolume }
 * @param {object} [limits]      agent risk-limits (microCapMinAvgDollarVolume)
 * @returns {{ passed: object[], rejected: {ticker:string, reason:string}[] }}
 */
export function screenUniverse(candidates = [], limits = {}) {
  const floor = limits.microCapMinAvgDollarVolume ?? 3_000_000;
  const passed = [];
  const rejected = [];

  for (const c of candidates) {
    const subVertical = c.subVertical ?? classifySubVertical(c);
    if (!subVertical) {
      rejected.push({ ticker: c.ticker, reason: "outside sub-verticals (not Software/SaaS or Semiconductors)" });
      continue;
    }

    const cap = c.marketCap;
    if (cap == null) {
      rejected.push({ ticker: c.ticker, reason: "market cap unavailable — cannot verify universe band" });
      continue;
    }
    if (cap > LARGE_CAP_CEILING) {
      rejected.push({ ticker: c.ticker, reason: `large-cap $${human(cap)} > $10B ceiling` });
      continue;
    }
    if (cap < MICROCAP_CEILING) {
      const addv = c.avgDollarVolume;
      if (addv == null) {
        rejected.push({ ticker: c.ticker, reason: "micro-cap with no ADDV — liquidity unverifiable (NO_TRADE)" });
        continue;
      }
      if (addv < floor) {
        rejected.push({ ticker: c.ticker, reason: `micro-cap ADDV $${human(addv)} below $${human(floor)} floor` });
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
