/**
 * Shared normalization for "Market Scans" rows, used by both the manual
 * Mac-companion path (scripts/sync-market-scans-from-mcp.js) and the
 * automated Robinhood-sourced path (lib/market-scan-sync.js).
 *
 * Accepted input shapes:
 * {
 *   "syncedAt": "2026-06-30T15:00:00.000Z",
 *   "scans": [
 *     { "scanName": "Momentum + Volume", "results": [{ "ticker": "NVDA", ... }] }
 *   ]
 * }
 *
 * Also accepts { "results": [...] } for already-flattened rows.
 */

function asNumber(value) {
  if (value == null || value === "") return null;
  const n = Number(String(value).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function asTicker(value) {
  return String(value ?? "").trim().toUpperCase();
}

function normalizeResult(row, scanName, syncedAt) {
  const ticker = asTicker(row.ticker ?? row.symbol);
  if (!ticker) return null;
  return {
    syncedAt,
    scanName: String(row.scanName ?? row.scan ?? scanName ?? "Robinhood").trim(),
    ticker,
    name: String(row.name ?? row.company ?? row.simpleName ?? row.description ?? "").trim(),
    price: asNumber(row.price ?? row.currentPrice ?? row.lastPrice ?? row.last_trade_price),
    changePct: asNumber(row.changePct ?? row.percentChange ?? row.changePercent ?? row.priceChangePct),
    volume: asNumber(row.volume),
    avgVolume: asNumber(row.avgVolume ?? row.averageVolume),
    marketCap: asNumber(row.marketCap),
    signal: String(row.signal ?? row.reason ?? row.scanReason ?? "").trim(),
    score: asNumber(row.score ?? row.rank),
    agentHint: String(row.agentHint ?? row.agentId ?? "").trim(),
    notes: String(row.notes ?? row.note ?? "").trim(),
  };
}

export function normalizeMarketScanRows(input) {
  const syncedAt = input.syncedAt ?? new Date().toISOString();
  const rows = [];

  if (Array.isArray(input.results)) {
    for (const row of input.results) rows.push(normalizeResult(row, row.scanName, syncedAt));
  }

  if (Array.isArray(input.scans)) {
    for (const scan of input.scans) {
      const scanName = scan.scanName ?? scan.name ?? scan.title ?? "Robinhood";
      const results = scan.results ?? scan.candidates ?? scan.rows ?? [];
      if (Array.isArray(results)) {
        for (const row of results) rows.push(normalizeResult(row, scanName, syncedAt));
      }
    }
  }

  const seen = new Set();
  return rows
    .filter(Boolean)
    .filter((row) => {
      const key = `${row.scanName}:${row.ticker}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => {
      const scoreA = a.score ?? -Infinity;
      const scoreB = b.score ?? -Infinity;
      if (scoreA !== scoreB) return scoreB - scoreA;
      return a.ticker.localeCompare(b.ticker);
    })
    .slice(0, 250);
}
