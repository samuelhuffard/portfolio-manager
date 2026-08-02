/**
 * ticker → CUSIP resolution via OpenFIGI.
 *
 * 13F information tables identify holdings by CUSIP, not ticker, and the CUSIP master
 * file is licensed rather than public. That only blocks the *full* universe direction
 * (every CUSIP in the file → a ticker). We need the reverse and much smaller mapping:
 * our own candidate universe → CUSIP, which is then used to FILTER the quarterly data
 * set. A few hundred tickers, resolved once.
 *
 * CUSIPs are stable for the life of a security, so a resolved mapping is cached
 * indefinitely. `resolveCusips` takes the cache as a plain object and returns the
 * merged result, leaving persistence (Redis) to the caller.
 *
 * FAILS CLOSED: any transport or provider error leaves the affected tickers unmapped
 * (null) rather than guessing. An unmapped ticker contributes no 13F rows, so
 * lib/absolute-rules.js reports the metric missing and rescales it out — never zero.
 *
 * NOT VERIFIED FROM THIS ENVIRONMENT: outbound access to api.openfigi.com is blocked by
 * the build sandbox's network policy, so the request/response shape below follows
 * OpenFIGI's published v3 mapping contract but has not been exercised live. Confirm
 * reachability from the Jetson before enabling the ingest job.
 */

const OPENFIGI_URL = "https://api.openfigi.com/v3/mapping";
/** OpenFIGI accepts at most 100 mapping jobs per request. */
export const MAX_JOBS_PER_REQUEST = 100;

const isCusip = (value) => typeof value === "string" && /^[0-9A-Z]{9}$/.test(value.toUpperCase());

export function chunk(items, size = MAX_JOBS_PER_REQUEST) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * @param {string[]} tickers
 * @param {object} [options]
 * @param {Record<string,string|null>} [options.cache]  previously resolved { TICKER: CUSIP }
 * @param {typeof fetch} [options.fetchImpl]
 * @param {string|null} [options.apiKey]  raises the rate limit; unauthenticated works
 * @param {string} [options.exchCode]
 * @returns {Promise<{ cusipByTicker: Record<string,string|null>, resolved: number,
 *                     unresolved: string[], errors: string[] }>}
 */
export async function resolveCusips(tickers = [], { cache = {}, fetchImpl = fetch, apiKey = null, exchCode = "US" } = {}) {
  const cusipByTicker = { ...cache };
  const errors = [];

  const pending = [...new Set(tickers.map((t) => String(t).trim().toUpperCase()).filter(Boolean))]
    .filter((ticker) => !isCusip(cusipByTicker[ticker]));

  for (const batch of chunk(pending)) {
    const jobs = batch.map((ticker) => ({ idType: "TICKER", idValue: ticker, exchCode }));
    let payload;
    try {
      const response = await fetchImpl(OPENFIGI_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(apiKey ? { "X-OPENFIGI-APIKEY": apiKey.trim() } : {}),
        },
        body: JSON.stringify(jobs),
      });
      if (!response.ok) throw new Error(`OpenFIGI HTTP ${response.status}`);
      payload = await response.json();
    } catch (error) {
      // Leave this batch unmapped and keep going; a provider outage must degrade
      // coverage, not abort the whole universe.
      errors.push(`${batch[0]}..${batch[batch.length - 1]}: ${error.message}`);
      for (const ticker of batch) if (!(ticker in cusipByTicker)) cusipByTicker[ticker] = null;
      continue;
    }

    if (!Array.isArray(payload) || payload.length !== jobs.length) {
      // Positional response contract broken — we cannot tell which result belongs to
      // which ticker, and a misaligned CUSIP would attribute another company's
      // ownership to this one. Discard the whole batch.
      errors.push(`OpenFIGI returned ${Array.isArray(payload) ? payload.length : "non-array"} results for ${jobs.length} jobs`);
      for (const ticker of batch) if (!(ticker in cusipByTicker)) cusipByTicker[ticker] = null;
      continue;
    }

    batch.forEach((ticker, i) => {
      const data = payload[i]?.data;
      const candidate = Array.isArray(data) ? data.find((d) => isCusip(d?.cusip))?.cusip : null;
      cusipByTicker[ticker] = candidate ? candidate.toUpperCase() : null;
    });
  }

  const unresolved = Object.entries(cusipByTicker).filter(([, cusip]) => !isCusip(cusip)).map(([ticker]) => ticker);
  return {
    cusipByTicker,
    resolved: Object.values(cusipByTicker).filter((c) => isCusip(c)).length,
    unresolved,
    errors,
  };
}
