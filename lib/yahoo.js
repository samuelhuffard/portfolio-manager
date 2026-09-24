import YahooFinance from "yahoo-finance2";

// quoteSummary validation remains enabled so malformed provider data still
// fails closed. yahoo-finance2's default validation logger emits a multi-line
// issue template (and an async version-check notice) before throwing; that is
// useful interactively but too noisy for a PM2 worker and its log sentinel.
// Keep the thrown error and all HTTP/auth failures observable to our bounded
// per-symbol warning below.
const yahooFinance = new YahooFinance({
  suppressNotices: ["yahooSurvey"],
  validation: { logErrors: false },
  versionCheck: false,
});

/** Keep provider failures observable without dumping an HTML error page into PM2 logs. */
export function summarizeYahooError(error, maxLength = 240) {
  let raw;
  if (error instanceof Error) {
    raw = error.message;
  } else if (error && typeof error === "object") {
    const seen = new WeakSet();
    try {
      raw = JSON.stringify(error, (_key, value) => {
        if (typeof value === "bigint") return value.toString();
        if (value && typeof value === "object") {
          if (seen.has(value)) return "[Circular]";
          seen.add(value);
        }
        return value;
      });
    } catch {
      raw = null;
    }
  } else {
    raw = error;
  }
  raw = String(raw ?? "Unknown Yahoo error");
  if (/failed yahoo schema validation|did not validate with schema/i.test(raw)) {
    return "Failed Yahoo Schema validation";
  }
  const status = raw.match(/\b(?:HTTP(?: status)?\s*)?(4\d\d|5\d\d)\b/i)?.[1];
  if (/<!doctype\s+html|<html[\s>]/i.test(raw)) {
    return `Yahoo returned an HTML error response${status ? ` (HTTP ${status})` : ""}`;
  }
  const compact = raw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  if (!compact) return "Unknown Yahoo error";
  return compact.length <= maxLength ? compact : `${compact.slice(0, maxLength - 1)}…`;
}

/**
 * Yahoo has exposed market cap under several module/endpoint shapes over time.
 * Prefer the ordinary market cap, then the summary module's non-diluted value,
 * and finally a quote endpoint value supplied by the caller.
 */
export function extractMarketCap(raw, quote = null) {
  const candidates = [
    raw?.price?.marketCap,
    raw?.summaryDetail?.marketCap,
    raw?.summaryDetail?.nonDilutedMarketCap,
    quote?.marketCap,
  ];
  const value = candidates.find((candidate) => Number.isFinite(Number(candidate)));
  return value == null ? null : Number(value);
}

const FUNDAMENTALS_MODULES = [
  "price", "summaryDetail", "defaultKeyStatistics", "financialData", "assetProfile",
  "calendarEvents", "recommendationTrend", "netSharePurchaseActivity",
];

/** Most recent analyst recommendation trend period, summarized as plain text (e.g. "7 strong buy, 23 buy, 15 hold, 1 sell, 2 strong sell"). */
function summarizeAnalystTrend(recommendationTrend) {
  const current = recommendationTrend?.trend?.[0];
  if (!current) return null;
  const parts = [];
  if (current.strongBuy) parts.push(`${current.strongBuy} strong buy`);
  if (current.buy) parts.push(`${current.buy} buy`);
  if (current.hold) parts.push(`${current.hold} hold`);
  if (current.sell) parts.push(`${current.sell} sell`);
  if (current.strongSell) parts.push(`${current.strongSell} strong sell`);
  return parts.length ? parts.join(", ") : null;
}

/** Net insider buying/selling over the reported period, summarized as plain text. */
function summarizeInsiderActivity(activity) {
  if (!activity || activity.netInfoShares == null) return null;
  const direction = activity.netInfoShares > 0 ? "net buying" : activity.netInfoShares < 0 ? "net selling" : "no net change";
  return `${direction} of ${Math.abs(activity.netInfoShares).toLocaleString()} shares over the trailing ${activity.period ?? "period"} (${activity.buyInfoCount ?? 0} buy txns, ${activity.sellInfoCount ?? 0} sell txns)`;
}

/** Fetch fundamentals for a single ticker via Yahoo Finance quoteSummary. */
export async function fetchFundamentals(ticker) {
  const symbol = ticker.trim().toUpperCase();
  try {
    const raw = await yahooFinance.quoteSummary(symbol, { modules: FUNDAMENTALS_MODULES });
    const name = raw.price?.longName || raw.price?.shortName || symbol;
    const earningsDate = raw.calendarEvents?.earnings?.earningsDate?.[0];
    return {
      ticker: symbol,
      name,
      sector: raw.assetProfile?.sector,
      industry: raw.assetProfile?.industry,
      nextEarningsDate: earningsDate ? new Date(earningsDate).toISOString().slice(0, 10) : null,
      analystTrend: summarizeAnalystTrend(raw.recommendationTrend),
      insiderActivity: summarizeInsiderActivity(raw.netSharePurchaseActivity),
      marketCap: extractMarketCap(raw),
      raw,
    };
  } catch (err) {
    const message = summarizeYahooError(err);
    console.warn(`[Yahoo] fetchFundamentals(${symbol}) failed:`, message);
    return { ticker: symbol, name: symbol, error: message };
  }
}

/**
 * Fetch the consensus estimate/revision module for one ticker, ISOLATED from
 * `fetchFundamentals` on purpose.
 *
 * quoteSummary accepts a module list in one request, so folding `earningsTrend` into
 * FUNDAMENTALS_MODULES would have been free in request terms — and that is exactly what
 * makes it dangerous here. This client keeps provider schema validation FAILING CLOSED
 * (see the constructor above), and validation throws for the whole call. Adding a module
 * to the shared list means a single schema drift in `earningsTrend` would take out price,
 * fundamentals and technicals for every ticker, not just consensus.
 *
 * Consensus is research-grade evidence for `revBeat` / `estimateRevisions`
 * (lib/consensus-snapshot.js). Losing it must degrade those metrics to `missing` — where
 * lib/mandate-score.js rescales them out — never break the money-adjacent scan path.
 * The cost is one extra request per ticker, paid only on the gated nightly/weekly
 * accumulation path, never on the live scan.
 *
 * Returns null on any failure. Never throws.
 */
export async function fetchConsensusTrend(ticker) {
  const symbol = ticker.trim().toUpperCase();
  try {
    const raw = await yahooFinance.quoteSummary(symbol, { modules: ["earningsTrend"] });
    return raw?.earningsTrend ? { ticker: symbol, raw } : null;
  } catch (err) {
    console.warn(`[Yahoo] fetchConsensusTrend(${symbol}) failed:`, summarizeYahooError(err));
    return null;
  }
}

/** Fetch fundamentals for a watchlist, pacing requests gently (unofficial API). */
export async function fetchFundamentalsBatch(tickers) {
  const results = [];
  for (const ticker of tickers) {
    results.push(await fetchFundamentals(ticker));
    await new Promise((r) => setTimeout(r, 250));
  }
  const missingMarketCap = results.filter((result) => !result.error && result.marketCap == null).map((result) => result.ticker);
  if (missingMarketCap.length) {
    const quotes = await fetchQuotes(missingMarketCap);
    for (const result of results) {
      if (!result.error && result.marketCap == null) result.marketCap = extractMarketCap(result.raw, quotes[result.ticker]);
    }
  }
  return results;
}

/** Fetch current quotes (price etc.) for one or more tickers. Returns a map keyed by symbol. */
export async function fetchQuotes(tickers) {
  if (!tickers.length) return {};
  try {
    const quotes = await yahooFinance.quote(tickers);
    const list = Array.isArray(quotes) ? quotes : [quotes];
    return Object.fromEntries(list.map((q) => [q.symbol, q]));
  } catch (err) {
    console.warn("[Yahoo] fetchQuotes failed:", summarizeYahooError(err));
    return {};
  }
}

/**
 * Yahoo's chart metadata carries the provider's first trade date even when the
 * bulk quote endpoint omits it. This is discovery eligibility evidence only;
 * a missing or malformed value stays null and therefore fails Agent Three's
 * multi-year-record gate.
 */
export async function fetchFirstTradeDate(ticker) {
  try {
    const result = await yahooFinance.chart(ticker, { period1: new Date(Date.now() - 7 * 24 * 3600 * 1000), interval: "1d" });
    const value = result?.meta?.firstTradeDate;
    const milliseconds = value instanceof Date ? value.getTime() : null;
    return Number.isFinite(milliseconds) && milliseconds <= Date.now() ? milliseconds : null;
  } catch (err) {
    console.warn(`[Yahoo] fetchFirstTradeDate(${ticker}) failed:`, summarizeYahooError(err));
    return null;
  }
}

/** Fetch daily close prices for a ticker between two dates. */
export async function fetchHistoricalCloses(ticker, { period1, period2 = new Date(), interval = "1d" } = {}) {
  try {
    const result = await yahooFinance.chart(ticker, { period1, period2, interval });
    return (result.quotes || [])
      .map((q) => ({ date: q.date, close: q.close }))
      .filter((q) => q.close != null);
  } catch (err) {
    console.warn(`[Yahoo] fetchHistoricalCloses(${ticker}) failed:`, summarizeYahooError(err));
    return [];
  }
}

/**
 * Fetch full daily OHLCV bars for a ticker. Unlike fetchHistoricalCloses (close-only,
 * used by the momentum metrics), this returns high/low/volume too so lib/indicators.js
 * can compute ATR, average daily dollar volume, RSI, MACD, and relative strength.
 */
export async function fetchDailyBars(ticker, { period1, period2 = new Date(), interval = "1d" } = {}) {
  try {
    const result = await yahooFinance.chart(ticker, { period1, period2, interval });
    return (result.quotes || [])
      .map((q) => ({
        date: q.date,
        open: q.open,
        high: q.high,
        low: q.low,
        close: q.close,
        volume: q.volume,
      }))
      .filter((q) => q.close != null);
  } catch (err) {
    console.warn(`[Yahoo] fetchDailyBars(${ticker}) failed:`, summarizeYahooError(err));
    return [];
  }
}

/**
 * Latest-quarter earnings surprise for T3 fundamental-deterioration detection.
 * Returns { epsActual, epsEstimate, epsSurprisePct } from the most recent reported quarter,
 * or null if Yahoo has no earnings history. epsSurprisePct is negative on a miss — the
 * exit monitor treats < -5% as a T3 trigger.
 */
export async function fetchEarningsSurprise(ticker) {
  const symbol = ticker.toUpperCase();
  try {
    const raw = await yahooFinance.quoteSummary(symbol, { modules: ["earningsHistory"] });
    const quarters = raw?.earningsHistory?.history || [];
    // Most recent reported quarter (those with a real actual EPS), by quarter date.
    const reported = quarters
      .filter((q) => q.epsActual != null && q.epsEstimate != null)
      .sort((a, b) => new Date(b.quarter) - new Date(a.quarter));
    const latest = reported[0];
    if (!latest || !latest.epsEstimate) return null;
    const epsSurprisePct = ((latest.epsActual - latest.epsEstimate) / Math.abs(latest.epsEstimate)) * 100;
    return { epsActual: latest.epsActual, epsEstimate: latest.epsEstimate, epsSurprisePct };
  } catch (err) {
    console.warn(`[Yahoo] fetchEarningsSurprise(${symbol}) failed:`, summarizeYahooError(err));
    return null;
  }
}

/** Percent change from the first to last close in a series, or null if insufficient data. */
export function percentChange(closes) {
  if (closes.length < 2) return null;
  const first = closes[0].close;
  const last = closes[closes.length - 1].close;
  if (!first) return null;
  return (last - first) / first;
}
