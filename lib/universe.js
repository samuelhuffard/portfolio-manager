/**
 * Dynamic universe: full US-listed common-stock catalog replacing the static
 * per-agent watchlist as the discovery source (LOOP-DESIGN.md; screener.js was
 * written anticipating exactly this feed).
 *
 * Listing source: Nasdaq Trader symbol directory (free, no auth, pipe-delimited):
 *   nasdaqlisted.txt — NASDAQ-listed issues
 *   otherlisted.txt  — issues listed on other US exchanges (NYSE etc.)
 *
 * The parse/filter/merge/selection functions are pure and tested
 * (tests/universe.test.js); only fetchUsListing() touches the network.
 *
 * Catalog entries use short field names on purpose — the whole catalog is
 * stored in Redis in chunks (lib/redis.js) and several thousand entries have
 * to stay well under Upstash request-size limits:
 *   t=ticker n=name x=exchange s=sector i=industry v=subVertical
 *   mc=marketCap advd=avgDailyDollarVolume p=price c52=fiftyTwoWeekChangePct
 *   qa=lastQuotedAt(YYYY-MM-DD) ea=sectorEnrichedAt(YYYY-MM-DD)
 */

const NASDAQ_LISTED_URL = "https://www.nasdaqtrader.com/dynamic/symdir/nasdaqlisted.txt";
const OTHER_LISTED_URL = "https://www.nasdaqtrader.com/dynamic/symdir/otherlisted.txt";

// otherlisted.txt Exchange codes we accept. The agent mandates permit
// NYSE/NASDAQ only: N = NYSE, A = NYSE American (small caps). ARCA (P, almost
// all ETFs), BATS (Z), and IEX (V) are excluded.
const ALLOWED_OTHER_EXCHANGES = new Set(["N", "A"]);

// Security-name patterns that mark non-common-stock instruments the mandates
// forbid outright (ETFs/ETNs, funds, warrants/rights/units, preferreds, ADRs).
const EXCLUDED_NAME_PATTERN =
  /\b(warrant|right|rights|unit|units|preferred|preference|depositary|depository|ADS|ADR|ETN|exchange traded|closed[- ]end|investment trust|royalty trust|notes? due|acquisition corp(?:oration)?|acquisition company|blank[- ]check|SPAC|business development compan(?:y|ies)|master limited partnership|publicly traded partnership|limited partnership|L\.?P\.?|%)/i;

function isPlainSymbol(symbol) {
  // Letters only: drops preferred/class/warrant suffix forms ($, ., -).
  // Costs a handful of legit class shares (BRK.B style) — acceptable for a
  // discovery universe; holdings are always reviewed regardless of the catalog.
  return /^[A-Z]{1,5}$/.test(symbol);
}

/** Parse nasdaqlisted.txt into { ticker, name, exchange: "NASDAQ" } rows. */
export function parseNasdaqListed(text) {
  const rows = [];
  for (const line of text.split("\n").slice(1)) {
    const cols = line.split("|");
    if (cols.length < 8) continue; // header/footer ("File Creation Time…")
    const [symbol, name, , testIssue, financialStatus, , etf, nextShares] = cols;
    if (testIssue === "Y" || etf === "Y" || nextShares === "Y") continue;
    // Financial Status: D/E/H = deficient/delinquent/halted — not investable.
    if (financialStatus && financialStatus !== "N" && financialStatus !== " ") continue;
    if (!isPlainSymbol(symbol)) continue;
    if (EXCLUDED_NAME_PATTERN.test(name)) continue;
    rows.push({ ticker: symbol, name: name.trim(), exchange: "NASDAQ" });
  }
  return rows;
}

/** Parse otherlisted.txt into { ticker, name, exchange: "NYSE" } rows (NYSE/NYSE American only). */
export function parseOtherListed(text) {
  const rows = [];
  for (const line of text.split("\n").slice(1)) {
    const cols = line.split("|");
    if (cols.length < 8) continue;
    const [actSymbol, name, exchange, , etf, , testIssue] = cols;
    if (testIssue === "Y" || etf === "Y") continue;
    if (!ALLOWED_OTHER_EXCHANGES.has(exchange)) continue;
    if (!isPlainSymbol(actSymbol)) continue;
    if (EXCLUDED_NAME_PATTERN.test(name)) continue;
    rows.push({ ticker: actSymbol, name: name.trim(), exchange: "NYSE" });
  }
  return rows;
}

/** Download + parse both symbol directory files. Throws on any fetch failure — callers treat a refresh failure as loud but non-blocking. */
export async function fetchUsListing() {
  const [nasdaqText, otherText] = await Promise.all(
    [NASDAQ_LISTED_URL, OTHER_LISTED_URL].map(async (url) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Symbol directory fetch failed (${res.status}) for ${url}`);
      return res.text();
    })
  );
  const listing = [...parseNasdaqListed(nasdaqText), ...parseOtherListed(otherText)];
  const seen = new Set();
  return listing.filter((r) => (seen.has(r.ticker) ? false : seen.add(r.ticker)));
}

/**
 * Merge a fresh listing into the existing catalog: new tickers are added bare,
 * still-listed tickers KEEP their quote/sector enrichment, delisted tickers drop.
 */
export function mergeCatalog(existing = {}, listing = []) {
  const merged = {};
  for (const row of listing) {
    const prior = existing[row.ticker];
    merged[row.ticker] = prior
      ? { ...prior, n: row.name.slice(0, 60), x: row.exchange }
      : { t: row.ticker, n: row.name.slice(0, 60), x: row.exchange };
  }
  return merged;
}

/** Fold a bulk-quote pass into catalog entries (marketCap, avg daily DOLLAR volume, price, 52w change). */
export function applyQuotes(catalog, quotesBySymbol, today = new Date().toISOString().slice(0, 10)) {
  for (const [symbol, q] of Object.entries(quotesBySymbol)) {
    const entry = catalog[symbol];
    if (!entry || !q) continue;
    const price = q.regularMarketPrice ?? null;
    const avgShares = q.averageDailyVolume3Month ?? q.averageDailyVolume10Day ?? null;
    entry.p = price;
    entry.mc = q.marketCap ?? entry.mc ?? null;
    entry.advd = price != null && avgShares != null ? Math.round(price * avgShares) : entry.advd ?? null;
    entry.c52 = q.fiftyTwoWeekChangePercent ?? entry.c52 ?? null;
    // First trade date — Agent Three's multi-year-record eligibility gate reads this
    // (lib/mandate-catalog-screen.js). Sticky: a quote pass that omits it must not erase
    // a date we already know, or the gate would start failing closed on known names.
    entry.ftd = q.firstTradeDateMilliseconds ?? entry.ftd ?? null;
    entry.qa = today;
  }
  return catalog;
}

// Junk floor: names too small AND too illiquid for ANY agent mandate (micro-caps
// need ≥$3M ADDV even for agent-1). Dropping them keeps the catalog compact.
const JUNK_MARKET_CAP = 50_000_000;
const JUNK_ADVD = 1_000_000;

/** Remove quoted entries that no mandate could ever buy. Unquoted entries are kept (not yet judged). */
export function dropJunk(catalog) {
  const kept = {};
  for (const [ticker, e] of Object.entries(catalog)) {
    if (e.qa && e.mc != null && e.advd != null && e.mc < JUNK_MARKET_CAP && e.advd < JUNK_ADVD) continue;
    kept[ticker] = e;
  }
  return kept;
}

/**
 * Pick which tickers get a (paced, expensive) quoteSummary sector-enrichment
 * call tonight: never-enriched first — largest liquid names first so useful
 * candidates classify earliest — then stale entries (enrichedAt > staleDays).
 */
export function selectEnrichmentBatch(catalog, { perRun = 250, staleDays = 30, now = new Date(), priorityTickers = [] } = {}) {
  const entries = Object.values(catalog);
  const cutoff = new Date(now.getTime() - staleDays * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const never = entries.filter((e) => !e.ea).sort((a, b) => (b.mc ?? 0) - (a.mc ?? 0));
  const stale = entries.filter((e) => e.ea && e.ea < cutoff).sort((a, b) => (a.ea < b.ea ? -1 : 1));
  const priority = priorityTickers.filter((ticker) => catalog[ticker]);
  const ordered = [...priority, ...never.map((e) => e.t), ...stale.map((e) => e.t)];
  return [...new Set(ordered)].slice(0, perRun);
}

/**
 * The bulk quote endpoint does not reliably carry a first-trade date, but
 * Agent Three's mandate must verify a multi-year public record. Refresh this
 * separate, paced fact from chart metadata without allowing missing data to
 * become an eligibility pass. An attempted-but-unavailable date is retried on
 * the normal stale cadence instead of starving the rest of the catalog.
 */
export function selectFirstTradeDateRefreshBatch(catalog, { perRun = 250, staleDays = 30, now = new Date() } = {}) {
  const cutoff = new Date(now.getTime() - staleDays * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const missing = Object.values(catalog)
    .filter((entry) => !entry.fda)
    .sort((a, b) => (b.mc ?? 0) - (a.mc ?? 0));
  const stale = Object.values(catalog)
    .filter((entry) => !Number.isFinite(entry.ftd) && entry.fda && entry.fda < cutoff)
    .sort((a, b) => (a.fda < b.fda ? -1 : 1));
  return [...new Set([...missing, ...stale].map((entry) => entry.t))].slice(0, perRun);
}

/**
 * Adapt every catalog entry into the shared candidate-bus fact shape. Sector
 * enrichment is optional because all three live v3 discovery mandates are
 * sector-agnostic; classification remains useful downstream evidence.
 */
export function toScreenerCandidates(catalog) {
  return Object.values(catalog)
    .map((e) => ({
      ticker: e.t,
      name: e.n,
      exchange: e.x ?? null,
      sector: e.s ?? null,
      industry: e.i ?? null,
      subVertical: e.v ?? null,
      marketCap: e.mc ?? null,
      avgDollarVolume: e.advd ?? null,
      price: e.p ?? null,
      fiftyTwoWeekChangePct: e.c52 ?? null,
      firstTradeDate: e.ftd ?? null,
      firstTradeDateAsOf: e.fda ?? null,
      quoteAsOf: e.qa ?? null,
      classificationAsOf: e.ea ?? null,
    }));
}

export function buildCatalogCensus(catalog = {}) {
  const entries = Object.values(catalog);
  return {
    listed: entries.length,
    quoted: entries.filter((entry) => Boolean(entry.qa) && Number.isFinite(entry.p)).length,
    classified: entries.filter((entry) => Boolean(entry.ea) && Boolean(entry.s || entry.i || entry.v)).length,
    marketCapCovered: entries.filter((entry) => Number.isFinite(entry.mc)).length,
    liquidityCovered: entries.filter((entry) => Number.isFinite(entry.advd)).length,
    quoteAndLiquidityCovered: entries.filter(
      (entry) => Boolean(entry.qa) && Number.isFinite(entry.p) && Number.isFinite(entry.mc) && Number.isFinite(entry.advd)
    ).length,
    firstTradeDateCovered: entries.filter((entry) => Number.isFinite(entry.ftd)).length,
  };
}
