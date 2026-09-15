/**
 * Agent 2 short-horizon revenue history (mandate v3 §5).
 *
 * This module deliberately derives only the parts of Agent 2's growth table that
 * the persisted SEC EDGAR revenue series can answer without interpretation:
 * positive YoY growth in the latest four reported quarters, and whether the
 * latest YoY growth rate is non-decelerating versus the preceding quarter.
 *
 * It does NOT turn GAAP EPS into the mandate's "adjusted EPS", infer a
 * "material" deceleration threshold, or define positive multi-quarter
 * persistence. Those inputs remain null in the evidence adapter until their
 * definitions are approved. A gap, malformed period, or insufficient history
 * similarly yields no claimed evidence rather than a stitched series.
 */

import { yoyGrowthSeries } from "./edgar-metrics.js";

const DAY = 86_400_000;
const finite = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);

/** SEC fiscal quarters normally fall roughly 90 days apart; do not bridge a gap. */
const MIN_QUARTER_GAP_DAYS = 70;
const MAX_QUARTER_GAP_DAYS = 120;

function cleanQuarterSeries(series) {
  if (!Array.isArray(series)) return [];
  const cleaned = series
    .map((row) => ({ end: typeof row?.end === "string" ? row.end : null, val: finite(row?.val) }))
    .filter((row) => row.end && row.val != null && Number.isFinite(Date.parse(row.end)))
    .sort((left, right) => Date.parse(left.end) - Date.parse(right.end));
  if (cleaned.length !== series.length) return [];
  if (new Set(cleaned.map((row) => row.end)).size !== cleaned.length) return [];
  for (let index = 1; index < cleaned.length; index++) {
    const gapDays = (Date.parse(cleaned[index].end) - Date.parse(cleaned[index - 1].end)) / DAY;
    if (gapDays < MIN_QUARTER_GAP_DAYS || gapDays > MAX_QUARTER_GAP_DAYS) return [];
  }
  return cleaned;
}

/**
 * Derive only unambiguous Agent 2 revenue-history fields from persisted EDGAR
 * quarters. `positiveQuartersInLatestFour` is null unless all four latest YoY
 * observations are contiguous; this prevents one missing filing from looking
 * like a complete four-quarter trend.
 */
export function deriveAgent2RevenueHistory(revenueQuarterSeries) {
  const quarters = cleanQuarterSeries(revenueQuarterSeries);
  if (!quarters.length) {
    return { quarterlyYoYGrowth: [], positiveQuartersInLatestFour: null, nonDecelerating: null };
  }
  const quarterlyYoYGrowth = yoyGrowthSeries(quarters);
  const latestFour = quarterlyYoYGrowth.slice(-4);
  const latestTwo = quarterlyYoYGrowth.slice(-2);
  return {
    quarterlyYoYGrowth,
    positiveQuartersInLatestFour: latestFour.length === 4 ? latestFour.filter((row) => row.growth > 0).length : null,
    nonDecelerating: latestTwo.length === 2 ? latestTwo[1].growth >= latestTwo[0].growth : null,
  };
}
