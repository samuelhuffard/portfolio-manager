/**
 * Agent 3 long-horizon evidence (mandate v3 §5, Agent Three rule tables).
 *
 * Agent 3 could reach only 10 of 100 available points because the shared EDGAR bundle
 * carries short-window scalars and its rule tables ask multi-year questions. Rather than
 * substitute Agent 1/2's values — which lib/mandate-evidence.js explicitly forbids —
 * this module derives the multi-year quantities the rules actually name.
 *
 * Pure, no I/O. Every quantity is either derived from filings or left null; a null is
 * rescaled out by lib/absolute-rules.js, never scored zero.
 *
 * DECISIONS BOUND HERE (owner sign-off 2026-08-02, recorded in the decision register):
 *
 *  - Period basis is ROLLING TTM from quarterly facts, in NON-OVERLAPPING 4-quarter
 *    windows (lib/edgar-metrics.js `ttmWindows`). Note this is a STRICTER bar than the
 *    3-years-public eligibility gate: a 3-year comparison across non-overlapping windows
 *    needs 4 windows = 16 clean quarters ≈ 4 years of filings. TTM is the binding
 *    constraint, and that is deliberate — see docs/CHANGE_MAP.md.
 *  - "Normalized" EPS is OPERATING INCOME PER DILUTED SHARE, matching the Q-001 decision
 *    that profitability is judged on operating income. A one-time tax, litigation or
 *    impairment item cannot manufacture or destroy a multi-year trend. The CAGR is
 *    endpoint-to-endpoint (a trimmed/regression trend was considered and NOT adopted),
 *    so a depressed base window can still flatter the result — the volatility fields
 *    below are what surface that, and the scorer sees both.
 *  - marginChangeBps3y uses GROSS margin, matching Agents 1 and 2.
 *  - Q-001's balance-sheet economics extend unchanged to the multi-year medians, applied
 *    PER WINDOW BEFORE the median. Negative or zero EBITDA yields null for that window,
 *    which then drops out of the median rather than sorting as excellent.
 *  - The five "material" booleans the rule tables read have no threshold in the mandate.
 *    They are all derived from the single number the mandate does state —
 *    maxAnnualGrowthSpreadPoints <= 15 for full credit — via VOLATILE_YEAR_SPREAD_POINTS
 *    below, rather than five new invented constants.
 */
import {
  CONCEPTS,
  quarterlySeries,
  instantSeries,
} from "./edgar-facts.js";
import {
  ttmWindows,
  ttmWindowMeans,
  alignWindows,
  windowGrowthSeries,
} from "./edgar-metrics.js";

const DAY = 86400000;
const finite = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const pct = (fraction) => (fraction == null ? null : fraction * 100);

/**
 * The mandate's only stated consistency number: full revGrowth credit requires
 * maxAnnualGrowthSpreadPoints <= 15. Every "material"/"erratic"/"volatile" judgment
 * below is derived from it so the whole family traces to one reviewable threshold.
 */
export const VOLATILE_YEAR_SPREAD_POINTS = 15;
/** Two consecutive bad years is the mandate's shape for "persistent" (v3 §5). */
export const PERSISTENCE_RUN = 2;

/** Windows needed for three year-over-year comparisons. */
export const REQUIRED_WINDOWS = 4;

/**
 * Endpoint CAGR across a non-overlapping window series, using elapsed time between the
 * first and last window ends.
 *
 * `cagrFromSeries` is NOT reusable here: it searches for a point at-or-before
 * `end - years`, and four non-overlapping windows span almost exactly three years, so
 * the oldest window lands a fraction of a day on the wrong side of that target and the
 * result would be null on nearly every company. Elapsed time is measured from the filed
 * period ends, so an irregular calendar cannot manufacture a three-year result.
 */
export function windowCagr(windows = []) {
  if (windows.length < 2) return null;
  const start = windows[0];
  const end = windows[windows.length - 1];
  if (!(start.val > 0) || !(end.val > 0)) return null;
  const elapsedYears = (Date.parse(end.end) - Date.parse(start.end)) / (365.25 * DAY);
  if (!Number.isFinite(elapsedYears) || elapsedYears <= 0) return null;
  return (end.val / start.val) ** (1 / elapsedYears) - 1;
}

const median = (values) => {
  const clean = values.filter((v) => finite(v) != null).sort((a, b) => a - b);
  if (!clean.length) return null;
  const mid = clean.length / 2;
  return clean.length % 2 ? clean[Math.floor(mid)] : (clean[mid - 1] + clean[mid]) / 2;
};

/** True when `predicate` holds on `run` consecutive entries anywhere in the series. */
function hasConsecutiveRun(values, predicate, run = PERSISTENCE_RUN) {
  let streak = 0;
  for (const value of values) {
    streak = predicate(value) ? streak + 1 : 0;
    if (streak >= run) return true;
  }
  return false;
}

/** Instant fact at (or just before) a window end. Balance-sheet instants land on period ends. */
function instantAtEnd(series = [], end, toleranceDays = 10) {
  const target = Date.parse(end);
  if (!Number.isFinite(target)) return null;
  let best = null;
  for (const fact of series) {
    const at = Date.parse(fact.end);
    if (!Number.isFinite(at) || at > target + toleranceDays * DAY) continue;
    if (target - at > toleranceDays * DAY) continue;
    if (!best || Math.abs(at - target) < Math.abs(Date.parse(best.end) - target)) best = fact;
  }
  return finite(best?.val ?? null);
}

/**
 * Per-window balance-sheet economics under the Q-001 definitions.
 * Returns oldest→newest [{ end, netDebtEbitda, interestCoverage }] with nulls preserved.
 */
export function balanceSheetWindows(companyfacts) {
  const opIncWindows = ttmWindows(quarterlySeries(companyfacts, CONCEPTS.operatingIncome), REQUIRED_WINDOWS);
  const daWindows = ttmWindows(quarterlySeries(companyfacts, CONCEPTS.depreciationAmortization), REQUIRED_WINDOWS);
  const intExpWindows = ttmWindows(quarterlySeries(companyfacts, CONCEPTS.interestExpense), REQUIRED_WINDOWS);
  const daByEnd = new Map(daWindows.map((w) => [w.end, w.val]));
  const intByEnd = new Map(intExpWindows.map((w) => [w.end, w.val]));

  const unrestrictedCash = instantSeries(companyfacts, CONCEPTS.unrestrictedCash);
  const shortTermInvestments = instantSeries(companyfacts, CONCEPTS.shortTermInvestments);
  const longTermDebt = instantSeries(companyfacts, CONCEPTS.longTermDebt);
  const currentDebt = instantSeries(companyfacts, CONCEPTS.currentDebt);

  return opIncWindows.map((window) => {
    const ttmOpInc = window.val;
    const ttmDA = daByEnd.has(window.end) ? daByEnd.get(window.end) : null;
    const ttmIntExp = intByEnd.has(window.end) ? intByEnd.get(window.end) : null;

    // Q-001 D3: never approximate EBITDA from operating income alone; a missing D&A
    // concept yields null. Negative/zero EBITDA yields null, never a number.
    const ebitda = ttmDA != null ? ttmOpInc + ttmDA : null;

    const ltd = instantAtEnd(longTermDebt, window.end);
    const cd = instantAtEnd(currentDebt, window.end);
    const anyDebtReported = ltd != null || cd != null;
    const totalDebt = anyDebtReported ? (ltd ?? 0) + (cd ?? 0) : null;

    const cash = instantAtEnd(unrestrictedCash, window.end);
    const sti = instantAtEnd(shortTermInvestments, window.end);
    const liquidAssets = cash == null && sti == null ? null : (cash ?? 0) + (sti ?? 0);

    const netDebtEbitda = ebitda != null && ebitda > 0 && totalDebt != null && liquidAssets != null
      ? (totalDebt - liquidAssets) / ebitda
      : null;

    const interestCoverage = ttmIntExp == null || ttmIntExp === 0 ? 999 : ttmOpInc / Math.abs(ttmIntExp);

    return { end: window.end, netDebtEbitda, interestCoverage: finite(interestCoverage) };
  });
}

/**
 * Build every named input Agent 3's rule tables read, except revBeat/estimateRevisions
 * (consensus-sourced — bound by lib/mandate-evidence.js from lib/consensus-snapshot.js).
 *
 * @returns {{ windows:number, complete:boolean, revGrowth:object|null, epsTrajectory:object|null,
 *             marginTrend:object|null, balanceSheet:object|null }}
 */
export function deriveAgent3History(companyfacts) {
  const revenueWindows = ttmWindows(quarterlySeries(companyfacts, CONCEPTS.revenue), REQUIRED_WINDOWS);
  const empty = { windows: revenueWindows.length, complete: false, revGrowth: null, epsTrajectory: null, marginTrend: null, balanceSheet: null };

  // Three year-over-year comparisons need four non-overlapping windows. Fewer means the
  // rules cannot be answered, and a shorter history is NOT substituted — the metric
  // reports missing and rescales out.
  if (revenueWindows.length < REQUIRED_WINDOWS) return empty;

  // ---- revGrowth ----
  const revenueGrowth = windowGrowthSeries(revenueWindows).map((g) => g.growth);
  const revGrowth = revenueGrowth.length
    ? (() => {
        const growthPoints = revenueGrowth.map((g) => g * 100);
        // A year is volatile when its growth rate SWINGS more than the mandate's own 15pp
        // consistency tolerance away from the year before it. Deviation-from-median was
        // considered and rejected: a +60/-25/+60 path is plainly erratic, yet only one of
        // its three years deviates from the median, so it would score as consistent.
        // Measuring the swing between consecutive years catches the path, which is what
        // "durable, low-variance growth" is actually asking about.
        const volatileYears = growthPoints
          .slice(1)
          .filter((g, i) => Math.abs(g - growthPoints[i]) > VOLATILE_YEAR_SPREAD_POINTS).length;
        return {
          revenueCagr3yPct: pct(windowCagr(revenueWindows)),
          positiveGrowthYears: growthPoints.filter((g) => g > 0).length,
          negativeGrowthYears: growthPoints.filter((g) => g < 0).length,
          minimumAnnualGrowthPct: Math.min(...growthPoints),
          maxAnnualGrowthSpreadPoints: Math.max(...growthPoints) - Math.min(...growthPoints),
          volatileYears,
          materiallyErraticGrowth: volatileYears >= PERSISTENCE_RUN,
        };
      })()
    : null;

  // ---- epsTrajectory: operating income per diluted share ----
  const opIncWindows = ttmWindows(quarterlySeries(companyfacts, CONCEPTS.operatingIncome), REQUIRED_WINDOWS);
  const dilutedShareWindows = ttmWindowMeans(quarterlySeries(companyfacts, CONCEPTS.dilutedShares, "shares"), REQUIRED_WINDOWS);
  const normalizedEpsWindows = alignWindows(opIncWindows, dilutedShareWindows)
    .filter((row) => row.b > 0)
    .map((row) => ({ end: row.end, val: row.a / row.b }));

  let epsTrajectory = null;
  if (normalizedEpsWindows.length >= REQUIRED_WINDOWS) {
    const epsGrowth = windowGrowthSeries(normalizedEpsWindows).map((g) => g.growth * 100);
    const values = normalizedEpsWindows.map((w) => w.val);
    epsTrajectory = {
      normalizedEpsCagr3yPct: pct(windowCagr(normalizedEpsWindows)),
      positiveEpsYears: epsGrowth.filter((g) => g > 0).length,
      worstAnnualDeclinePct: epsGrowth.length ? Math.min(...epsGrowth) : null,
      positiveCumulativeTrajectory: values[values.length - 1] > values[0],
      persistentTwoYearDecline: hasConsecutiveRun(epsGrowth, (g) => g < 0),
      persistentDeterioration: hasConsecutiveRun(epsGrowth, (g) => g < 0),
    };
  }

  // ---- marginTrend: gross margin, matching Agents 1 and 2 ----
  const grossProfitWindows = ttmWindows(quarterlySeries(companyfacts, CONCEPTS.grossProfit), REQUIRED_WINDOWS);
  const marginWindows = alignWindows(grossProfitWindows, revenueWindows)
    .filter((row) => row.b !== 0)
    .map((row) => ({ end: row.end, val: row.a / row.b }));

  let marginTrend = null;
  if (marginWindows.length >= REQUIRED_WINDOWS) {
    const margins = marginWindows.map((w) => w.val);
    const changes = margins.slice(1).map((m, i) => m - margins[i]);
    marginTrend = {
      marginChangeBps3y: (margins[margins.length - 1] - margins[0]) * 10000,
      twoYearContractionSequence: hasConsecutiveRun(changes, (c) => c < 0),
      // Only the zero band consults this, and only alongside a <= -100bps move. An
      // explanation is a human judgment this module cannot source, so it stays false.
      documentedStructuralInvestmentExplanation: false,
    };
  }

  // ---- balanceSheet: Q-001 economics, per window, then median ----
  const bsWindows = balanceSheetWindows(companyfacts);
  let balanceSheet = null;
  if (bsWindows.length >= REQUIRED_WINDOWS) {
    const latest = bsWindows[bsWindows.length - 1];
    const netDebt = bsWindows.map((w) => w.netDebtEbitda);
    const coverage = bsWindows.map((w) => w.interestCoverage);
    // "Below the next band" = worse than the 0.75 band's floor (netDebt/EBITDA <= 2 and
    // coverage > 5). Any single year breaching that disqualifies the top band, which is
    // what the full-credit rule is asking.
    const anyYearBelowNextBand = bsWindows.some((w) =>
      (w.netDebtEbitda != null && w.netDebtEbitda > 2) || (w.interestCoverage != null && w.interestCoverage <= 5));
    const netDebtChanges = netDebt.slice(1).map((v, i) => (v != null && netDebt[i] != null ? v - netDebt[i] : null));
    const coverageChanges = coverage.slice(1).map((v, i) => (v != null && coverage[i] != null ? v - coverage[i] : null));
    balanceSheet = {
      latestNetDebtEbitda: latest.netDebtEbitda,
      medianNetDebtEbitda3y: median(netDebt),
      latestInterestCoverage: latest.interestCoverage,
      medianInterestCoverage3y: median(coverage),
      anyYearBelowNextBand,
      // Same persistence shape as everywhere else: two consecutive worsening years.
      materialMultiYearDeterioration:
        hasConsecutiveRun(netDebtChanges, (c) => c != null && c > 0) ||
        hasConsecutiveRun(coverageChanges, (c) => c != null && c < 0),
    };
  }

  return {
    windows: revenueWindows.length,
    complete: Boolean(revGrowth && epsTrajectory && marginTrend && balanceSheet),
    revGrowth,
    epsTrajectory,
    marginTrend,
    balanceSheet,
  };
}
