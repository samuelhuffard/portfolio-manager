/**
 * Research-coverage routing for the peer-data substrate.
 *
 * This deliberately sits before any model call: a requested ticker can create a
 * durable coverage request, but it cannot pretend that a one-name Lab slate is a
 * peer cohort. The nightly universe refresh consumes the request and prioritizes
 * the target plus its economic cohort for enrichment.
 */
import { isDataComplete, resolvePeerSet } from "./peer-resolve.js";
import { PEER_RELATIVE_MIN } from "./peer-resolve.js";
import { scoreCandidates } from "./quant-scorer.js";
import { extractPeerQuantVector } from "./mandate-metrics.js";

export const PEER_COVERAGE_REQUEST_LIMIT = 1000;
export const PEER_COVERAGE_MAX_AGE_MS = 20 * 60 * 60 * 1000;
export const PEER_COVERAGE_ACTIVE_REQUEST_MS = 7 * 24 * 60 * 60 * 1000;
export const COVERAGE_CORE_METRICS = Object.freeze(["revGrowth", "peerValuation"]);
export const PEER_COVERAGE_TARGET_NAMES = PEER_RELATIVE_MIN + 1; // target + eight peers
// The existing quant score also includes price momentum, which is not stored in
// the peer cache. These weights deliberately cover only the seven sourced
// fundamentals below and sum to one, so missing momentum cannot manufacture a
// neutral 50 score for a quarter of the result.
export const PEER_FUNDAMENTAL_QUANT_WEIGHTS = Object.freeze({
  revenueGrowth: 0.16,
  earningsGrowth: 0.16,
  profitMargins: 0.16,
  returnOnEquity: 0.1733333333,
  trailingPE: 0.1333333333,
  debtToEquity: 0.1066666667,
  pegRatio: 0.1066666667,
});

function text(value) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

export function normalizeCoverageRequest(input = {}, now = new Date().toISOString()) {
  const ticker = text(input.ticker)?.toUpperCase();
  if (!/^[A-Z]{1,5}(?:[.-][A-Z]{1,2})?$/.test(ticker ?? "")) return null;
  return {
    ticker,
    industry: text(input.industry),
    sector: text(input.sector),
    source: text(input.source) ?? "research",
    firstRequestedAt: text(input.firstRequestedAt) ?? now,
    lastRequestedAt: now,
    requestCount: Math.max(1, Number(input.requestCount) || 1),
  };
}

/** Merge requests by ticker; retaining only a bounded most-recent queue. */
export function mergeCoverageRequests(existing = {}, incoming = [], now = new Date().toISOString()) {
  const merged = { ...(existing && typeof existing === "object" ? existing : {}) };
  for (const raw of incoming) {
    const request = normalizeCoverageRequest(raw, now);
    if (!request) continue;
    const prior = normalizeCoverageRequest(merged[request.ticker], now);
    merged[request.ticker] = {
      ...request,
      industry: request.industry ?? prior?.industry ?? null,
      sector: request.sector ?? prior?.sector ?? null,
      firstRequestedAt: prior?.firstRequestedAt ?? request.firstRequestedAt,
      requestCount: (prior?.requestCount ?? 0) + 1,
    };
  }
  const entries = Object.values(merged)
    .filter(Boolean)
    .sort((a, b) => String(b.lastRequestedAt).localeCompare(String(a.lastRequestedAt)))
    .slice(0, PEER_COVERAGE_REQUEST_LIMIT);
  return Object.fromEntries(entries.map((entry) => [entry.ticker, entry]));
}

/**
 * Requests are priorities, never a new investment universe. Return the target
 * first, then its industry cohort. When that narrow classification cannot
 * yield eight peers, extend collection into its sector so the resolver's
 * documented industry→sector fallback has actual rows to work with.
 */
export function coveragePriorityTickers(catalog = {}, requests = {}) {
  const entries = Object.values(catalog ?? {});
  const out = [];
  const seen = new Set();
  const add = (ticker) => {
    if (ticker && !seen.has(ticker)) {
      seen.add(ticker);
      out.push(ticker);
    }
  };
  const orderedRequests = Object.values(requests ?? {})
    .filter(Boolean)
    .sort((a, b) => String(b.lastRequestedAt).localeCompare(String(a.lastRequestedAt)));
  for (const request of orderedRequests) {
    add(request.ticker);
    const target = catalog?.[request.ticker] ?? {};
    const industry = request.industry ?? target.i ?? null;
    const sector = request.sector ?? target.s ?? null;
    const cohort = entries
      .filter((entry) => industry ? entry.i === industry : sector ? entry.s === sector : false)
      .sort((a, b) => (b.mc ?? 0) - (a.mc ?? 0));
    for (const entry of cohort) add(entry.t);
    // Do not stop at a thin Yahoo industry bucket: retain the true peers first,
    // then add same-sector names until a normal peer-relative cohort is viable.
    if (industry && sector && cohort.length < PEER_COVERAGE_TARGET_NAMES) {
      const sectorFallback = entries
        .filter((entry) => entry.s === sector && entry.i !== industry)
        .sort((a, b) => (b.mc ?? 0) - (a.mc ?? 0));
      for (const entry of sectorFallback) add(entry.t);
    }
  }
  return out;
}

/**
 * Return only the uncached rows needed to complete outstanding requested cohorts.
 *
 * Requests intentionally remain durable as demand history, so using the raw request
 * list as a fetch queue would repeatedly download the first satisfied cohort and
 * starve later requests. A row with incomplete core metrics is retried; a complete
 * row is skipped so the collector advances to the missing target/peers instead.
 */
function rowIsFresh(row, nowMs, maxAgeMs) {
  const retrievedAt = Date.parse(row?.retrievedAt ?? row?.ts ?? "");
  return Number.isFinite(retrievedAt) && retrievedAt <= nowMs && nowMs - retrievedAt <= maxAgeMs;
}

export function selectPeerCoverageRefreshTargets(catalog = {}, requests = {}, peerMetrics = {}, {
  limit = Infinity,
  now = new Date(),
  maxAgeMs = PEER_COVERAGE_MAX_AGE_MS,
  activeRequestMs = PEER_COVERAGE_ACTIVE_REQUEST_MS,
} = {}) {
  const nowMs = now.getTime();
  const unresolved = {};
  for (const [ticker, request] of Object.entries(requests ?? {})) {
    const requestedAt = Date.parse(request?.lastRequestedAt ?? "");
    if (Number.isFinite(requestedAt) && nowMs - requestedAt > activeRequestMs) continue;
    const coverage = assessPeerCoverage({
      ticker,
      industry: request?.industry ?? catalog?.[ticker]?.i ?? null,
      sector: request?.sector ?? catalog?.[ticker]?.s ?? null,
      peerMetrics,
    });
    const rows = [peerMetrics?.[ticker], ...coverage.peers];
    if (!coverage.ready || rows.some((row) => !rowIsFresh(row, nowMs, maxAgeMs))) unresolved[ticker] = request;
  }
  const targets = coveragePriorityTickers(catalog, unresolved)
    .filter((ticker) => !isDataComplete(peerMetrics?.[ticker], COVERAGE_CORE_METRICS) || !rowIsFresh(peerMetrics?.[ticker], nowMs, maxAgeMs))
    .slice(0, Math.max(0, limit));
  return { targets, unresolvedRequests: Object.keys(unresolved).length };
}

/** Pure coverage verdict used by Lab before any AI research call. */
export function assessPeerCoverage({ ticker, industry = null, sector = null, peerMetrics = {}, coreMetrics = COVERAGE_CORE_METRICS } = {}) {
  const symbol = text(ticker)?.toUpperCase();
  const rows = Object.entries(peerMetrics ?? {}).map(([rowTicker, row]) => ({
    ...row,
    ticker: rowTicker,
    industry: row?.industry ?? null,
    sector: row?.sector ?? null,
    metrics: row?.metrics ?? {},
  }));
  const candidate = rows.find((row) => row.ticker === symbol) ?? { ticker: symbol, industry, sector, metrics: {} };
  const resolved = resolvePeerSet(candidate, rows, { coreMetrics });
  const targetCovered = rows.some((row) => row.ticker === symbol);
  const ready = targetCovered && resolved.peerCount >= 6;
  return {
    ready,
    targetCovered,
    peerCount: resolved.peerCount,
    fallbackMethod: resolved.mode,
    peerSetUsed: { level: resolved.level, key: resolved.key },
    candidate,
    peers: resolved.peers,
    reason: !targetCovered ? "target_peer_metrics_unavailable" : resolved.peerCount < 6 ? "insufficient_peer_coverage" : null,
  };
}

/**
 * Preserve the normal review priorities, then fill unoccupied review slots from
 * the same already-fetched slate using only candidates with a usable peer cohort.
 * It never expands the model-call budget and it never lets a missing cohort pass.
 */
export function selectPeerReadyCandidates({ primary = [], fallback = [], peerMetrics = {}, limit = primary.length, canUse = () => true } = {}) {
  const selected = [];
  const seen = new Set();
  let deferredPrimary = 0;
  let backfilled = 0;
  const add = (candidate, { isPrimary }) => {
    const ticker = text(candidate?.ticker)?.toUpperCase();
    if (!ticker || seen.has(ticker) || selected.length >= limit) return;
    seen.add(ticker);
    const coverage = assessPeerCoverage({
      ticker,
      industry: candidate.industry ?? null,
      sector: candidate.sector ?? null,
      peerMetrics,
    });
    if (!coverage.ready || !canUse(candidate, coverage)) {
      if (isPrimary) deferredPrimary++;
      return;
    }
    selected.push({ candidate, coverage, source: isPrimary ? "priority" : "peer_ready_backfill" });
    if (!isPrimary) backfilled++;
  };
  for (const candidate of primary) add(candidate, { isPrimary: true });
  for (const candidate of fallback) add(candidate, { isPrimary: false });
  return { selected, deferredPrimary, backfilled };
}

function peerQuantCandidate(row) {
  const q = row?.quant ?? extractPeerQuantVector(row);
  return {
    ticker: row?.ticker,
    raw: {
      financialData: {
        revenueGrowth: q.revenueGrowth,
        earningsGrowth: q.earningsGrowth,
        profitMargins: q.profitMargins,
        returnOnEquity: q.returnOnEquity,
        debtToEquity: q.debtToEquity,
      },
      summaryDetail: { trailingPE: q.trailingPE },
      defaultKeyStatistics: { pegRatio: q.pegRatio },
    },
  };
}

function hasPeerFundamentalData(row) {
  const q = row?.quant ?? extractPeerQuantVector(row);
  return Object.values(q).filter((value) => typeof value === "number" && Number.isFinite(value)).length >= 4;
}

/**
 * Score a Lab target against its resolved stored peer cohort. The returned rank
 * is deliberately labeled partial: it has no price momentum, estimates, or
 * long-horizon mandate evidence and therefore cannot authorize a trade.
 */
export function scorePeerFundamentals({ candidate, peers = [] } = {}) {
  const symbol = text(candidate?.ticker)?.toUpperCase();
  if (!symbol) return null;
  const cohort = [candidate, ...peers]
    .filter((row) => text(row?.ticker))
    .filter((row, index, all) => all.findIndex((entry) => text(entry.ticker)?.toUpperCase() === text(row.ticker)?.toUpperCase()) === index)
    .filter(hasPeerFundamentalData)
    .map(peerQuantCandidate);
  if (cohort.length < 7) return null;
  const scored = scoreCandidates(cohort, PEER_FUNDAMENTAL_QUANT_WEIGHTS);
  return scored.find((row) => text(row.ticker)?.toUpperCase() === symbol) ?? null;
}
