import YahooFinance from "yahoo-finance2";

const yahooFinance = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

const FUNDAMENTALS_MODULES = ["price", "summaryDetail", "defaultKeyStatistics", "financialData", "assetProfile"];

/** Fetch fundamentals for a single ticker via Yahoo Finance quoteSummary. */
export async function fetchFundamentals(ticker) {
  const symbol = ticker.trim().toUpperCase();
  try {
    const raw = await yahooFinance.quoteSummary(symbol, { modules: FUNDAMENTALS_MODULES });
    const name = raw.price?.longName || raw.price?.shortName || symbol;
    return {
      ticker: symbol,
      name,
      sector: raw.assetProfile?.sector,
      industry: raw.assetProfile?.industry,
      raw,
    };
  } catch (err) {
    return { ticker: symbol, name: symbol, error: err instanceof Error ? err.message : "Failed to fetch data" };
  }
}

/** Fetch fundamentals for a watchlist, pacing requests gently (unofficial API). */
export async function fetchFundamentalsBatch(tickers) {
  const results = [];
  for (const ticker of tickers) {
    results.push(await fetchFundamentals(ticker));
    await new Promise((r) => setTimeout(r, 250));
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
    console.warn("[Yahoo] fetchQuotes failed:", err.message);
    return {};
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
    console.warn(`[Yahoo] fetchHistoricalCloses(${ticker}) failed:`, err.message);
    return [];
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
