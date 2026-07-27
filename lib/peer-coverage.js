/**
 * Research-coverage routing for the peer-data substrate.
 *
 * This deliberately sits before any model call: a requested ticker can create a
 * durable coverage request, but it cannot pretend that a one-name Lab slate is a
 * peer cohort. The nightly universe refresh consumes the request and prioritizes
 * the target plus its economic cohort for enrichment.
 */
import { resolvePeerSet } from "./peer-resolve.js";

export const PEER_COVERAGE_REQUEST_LIMIT = 1000;
export const COVERAGE_CORE_METRICS = Object.freeze(["revGrowth", "peerValuation"]);

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
 * first, then its industry cohort (or sector only when industry is unavailable).
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
  }
  return out;
}

/** Pure coverage verdict used by Lab before any AI research call. */
export function assessPeerCoverage({ ticker, industry = null, sector = null, peerMetrics = {}, coreMetrics = COVERAGE_CORE_METRICS } = {}) {
  const symbol = text(ticker)?.toUpperCase();
  const rows = Object.entries(peerMetrics ?? {}).map(([rowTicker, row]) => ({
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
    reason: !targetCovered ? "target_peer_metrics_unavailable" : resolved.peerCount < 6 ? "insufficient_peer_coverage" : null,
  };
}

/**
 * A coverage cohort alone is not an actionable score. Lab must consume the
 * immutable/latest mandate snapshot for its own agent or abstain; it may never
 * fall back to the old one-name cross-sectional score of 50.
 */
export function resolveLabMandateScore(snapshot, ticker) {
  const symbol = text(ticker)?.toUpperCase();
  const score = Array.isArray(snapshot?.scores)
    ? snapshot.scores.find((entry) => text(entry?.ticker)?.toUpperCase() === symbol)
    : null;
  if (!score) return { ready: false, reason: "mandate_score_unavailable", score: null };
  if (score.actionable !== true) return { ready: false, reason: "mandate_score_not_actionable", score };
  return { ready: true, reason: null, score };
}
