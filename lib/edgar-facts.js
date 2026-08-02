/**
 * Pure parser for SEC EDGAR XBRL `companyfacts` JSON (Mandate v2.1 §8: EDGAR/XBRL is
 * the primary, free fundamentals source). Turns the raw fact soup into tidy quarterly
 * / annual / instant series the metric derivations (lib/edgar-metrics.js) consume.
 *
 * Grounded against live SEC data (AAPL, 2026-07). Key facts about the shape:
 *  - facts live at `companyfacts.facts["us-gaap"][Concept].units[unit]` (unit "USD"
 *    for money, "USD/shares" for EPS).
 *  - each fact: { start?, end, val, accn, fy, fp, form, filed, frame? }.
 *  - FLOW concepts (revenue, EPS, income) have start+end. A 10-Q reports BOTH the
 *    3-month quarter AND the 6-/9-month year-to-date for the same filing, so we
 *    isolate the clean quarter by DURATION (~90 days). 10-K adds the 12-month annual.
 *  - INSTANT concepts (Assets, Cash, Equity) have no `start` (balance-sheet snapshots).
 *  - the same period can be restated across filings → dedup by period, keep latest `filed`.
 *
 * Pure and NOT wired live. See docs/MANDATE-V2-INGESTION.md.
 */

/** us-gaap concept fallback chains (first chain with data wins). */
export const CONCEPTS = Object.freeze({
  revenue: ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet"],
  grossProfit: ["GrossProfit"],
  costOfRevenue: ["CostOfRevenue", "CostOfGoodsAndServicesSold", "CostOfGoodsSold"],
  operatingIncome: ["OperatingIncomeLoss"],
  netIncome: ["NetIncomeLoss"],
  epsDiluted: ["EarningsPerShareDiluted"],
  operatingCashFlow: ["NetCashProvidedByUsedInOperatingActivities", "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations"],
  interestExpense: ["InterestExpense", "InterestExpenseNonoperating"],
  assets: ["Assets"],
  liabilities: ["Liabilities"],
  equity: ["StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"],
  cash: ["CashAndCashEquivalentsAtCarryingValue", "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents"],
  // --- Q-001 balance-sheet concepts (see docs/human-inputs/Q-001-...md) ---
  // Deliberately EXCLUDES RestrictedCash*: cash a company cannot deploy must not
  // offset debt. Note the `cash` chain above falls back to a restricted-inclusive
  // tag, so netCash uses `unrestrictedCash` below rather than reusing it.
  unrestrictedCash: ["CashAndCashEquivalentsAtCarryingValue"],
  shortTermInvestments: ["ShortTermInvestments", "MarketableSecuritiesCurrent", "AvailableForSaleSecuritiesDebtSecuritiesCurrent"],
  longTermDebt: ["LongTermDebtNoncurrent", "LongTermDebt"],
  currentDebt: ["LongTermDebtCurrent", "DebtCurrent", "ShortTermBorrowings"],
  // Operating leases are intentionally NOT part of the debt chain — see Q-001 D2.
  depreciationAmortization: [
    "DepreciationDepletionAndAmortization",
    "DepreciationAmortizationAndAccretionNet",
    "DepreciationAndAmortization",
    "Depreciation",
  ],
  // --- 13F denominator (unit "shares", INSTANT) ---
  // Period-END share count, so the ratio lands on the same date as the 13F holdings.
  // dei:EntityCommonStockSharesOutstanding is deliberately NOT in this chain: it is a
  // cover-page figure measured at FILING date, and that few-week skew against the 13F
  // period end makes a buyback read as institutional accumulation.
  sharesOutstanding: ["CommonStockSharesOutstanding"],
  // --- Agent 3 normalized EPS denominator (unit "shares", DURATION) ---
  dilutedShares: ["WeightedAverageNumberOfDilutedSharesOutstanding"],
});

const DAY = 86400000;
const durationDays = (f) => (f.start && f.end ? Math.round((Date.parse(f.end) - Date.parse(f.start)) / DAY) : null);
const isQuarter = (f) => { const d = durationDays(f); return d != null && d >= 80 && d <= 100; };
const isAnnual = (f) => { const d = durationDays(f); return d != null && d >= 350 && d <= 380; };
const isInstant = (f) => !f.start && !!f.end;

function normalizeSeriesOptions(unitOrOptions = "USD", options = {}) {
  const asOf = unitOrOptions && typeof unitOrOptions === "object" ? unitOrOptions.asOf ?? null : options?.asOf ?? null;
  if (asOf != null && (typeof asOf !== "string" || !Number.isFinite(Date.parse(asOf)))) throw new RangeError(`Invalid asOf cutoff: ${String(asOf)}`);
  return unitOrOptions && typeof unitOrOptions === "object"
    ? { unit: unitOrOptions.unit ?? "USD", asOf }
    : { unit: unitOrOptions, asOf };
}

function filedOnOrBefore(fact, asOf) {
  if (!asOf) return true;
  const cutoff = Date.parse(asOf);
  const filed = Date.parse(fact.filed);
  return Number.isFinite(cutoff) && Number.isFinite(filed) && filed <= cutoff;
}

/** Raw facts array for the first concept in a chain that has data under `unit`. */
export function rawFacts(companyfacts, conceptChain, unit = "USD", options = {}) {
  const { unit: normalizedUnit, asOf } = normalizeSeriesOptions(unit, options);
  const g = companyfacts?.facts?.["us-gaap"] ?? {};
  for (const name of conceptChain) {
    const arr = g[name]?.units?.[normalizedUnit];
    if (Array.isArray(arr) && arr.length) {
      const available = arr.filter((fact) => filedOnOrBefore(fact, asOf));
      if (available.length) return { concept: name, facts: available };
    }
  }
  return { concept: null, facts: [] };
}

/** Dedup facts sharing a period key, keeping the latest-`filed`; sorted ascending by `end`. */
function dedupByPeriod(facts, keyFn) {
  const best = new Map();
  for (const f of facts) {
    const k = keyFn(f);
    const prev = best.get(k);
    if (!prev || Date.parse(f.filed) > Date.parse(prev.filed)) best.set(k, f);
  }
  return [...best.values()].sort((a, b) => Date.parse(a.end) - Date.parse(b.end));
}

const tidy = (f, concept) => ({ end: f.end, start: f.start ?? null, val: f.val, fy: f.fy, fp: f.fp, form: f.form, filed: f.filed, frame: f.frame ?? null, concept });

/** Clean single-quarter series (3-month flows), deduped by end date, oldest→newest. */
export function quarterlySeries(companyfacts, conceptChain, unit = "USD", options = {}) {
  const { concept, facts } = rawFacts(companyfacts, conceptChain, unit, options);
  return dedupByPeriod(facts.filter(isQuarter), (f) => f.end).map((f) => tidy(f, concept));
}

/** Annual (12-month flow) series, deduped by end date, oldest→newest. */
export function annualSeries(companyfacts, conceptChain, unit = "USD", options = {}) {
  const { concept, facts } = rawFacts(companyfacts, conceptChain, unit, options);
  return dedupByPeriod(facts.filter(isAnnual), (f) => f.end).map((f) => tidy(f, concept));
}

/** Instant (balance-sheet) series, deduped by end date, oldest→newest. */
export function instantSeries(companyfacts, conceptChain, unit = "USD", options = {}) {
  const { concept, facts } = rawFacts(companyfacts, conceptChain, unit, options);
  return dedupByPeriod(facts.filter(isInstant), (f) => f.end).map((f) => tidy(f, concept));
}

/** Most recent instant value (e.g. latest total assets), or null. */
export function latestInstant(companyfacts, conceptChain, unit = "USD", options = {}) {
  const s = instantSeries(companyfacts, conceptChain, unit, options);
  return s.length ? s[s.length - 1] : null;
}

/**
 * Return the chronology-safe series available at a historical observation time.
 * `asOf` filters on filing date, not period end, so later restatements cannot
 * leak into a point-in-time observation.
 */
export function seriesAsOf(companyfacts, conceptChain, { unit = "USD", kind = "quarterly", asOf = null } = {}) {
  if (kind === "annual") return annualSeries(companyfacts, conceptChain, unit, { asOf });
  if (kind === "instant") return instantSeries(companyfacts, conceptChain, unit, { asOf });
  return quarterlySeries(companyfacts, conceptChain, unit, { asOf });
}

/** entityName/cik convenience. */
export const companyMeta = (companyfacts) => ({ cik: companyfacts?.cik ?? null, name: companyfacts?.entityName ?? null });
