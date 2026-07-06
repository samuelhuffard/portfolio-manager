import { getRedis } from "./redis.js";

/**
 * Research ledger — per-agent memory of every name the agent has actually
 * researched (AI overlay or data-gate NO_TRADE), so the candidate slate can
 * rotate coverage instead of re-reviewing the same tickers, and the overlay
 * prompt can remind the agent of its own prior conclusion.
 *
 * Advisory memory only: losing it degrades rotation quality, never money paths.
 * Pure merge/format functions are tested in tests/research-ledger.test.js.
 */

const MAX_ENTRIES = 500; // evict oldest lastResearchedAt beyond this
const THESIS_SNIPPET_MAX = 200;

function ledgerKey(agentId) {
  return `pm:research-ledger:${agentId}`;
}

export async function readResearchLedger(agentId) {
  const redis = getRedis();
  if (!redis) return {};
  try {
    const raw = await redis.get(ledgerKey(agentId));
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (err) {
    console.warn(`[ResearchLedger] failed to read ledger for ${agentId}:`, err.message);
    return {};
  }
}

/**
 * Pure merge of one scan run's research records into the ledger map.
 * records: [{ ticker, action, quantScore, confidence, thesis, entryPrice }]
 */
export function mergeResearchRecords(existing = {}, records = [], now = new Date().toISOString()) {
  const merged = { ...existing };
  for (const r of records) {
    if (!r?.ticker) continue;
    const prior = merged[r.ticker];
    merged[r.ticker] = {
      ticker: r.ticker,
      lastResearchedAt: now,
      timesResearched: (prior?.timesResearched ?? 0) + 1,
      lastAction: r.action ?? "HOLD",
      lastQuantScore: r.quantScore ?? null,
      lastConfidence: r.confidence ?? null,
      thesisSnippet: (r.thesis ?? "").replace(/\s+/g, " ").trim().slice(0, THESIS_SNIPPET_MAX),
      lastEntryPrice: r.entryPrice ?? null,
    };
  }
  const tickers = Object.keys(merged);
  if (tickers.length > MAX_ENTRIES) {
    const evict = tickers
      .sort((a, b) => (merged[a].lastResearchedAt < merged[b].lastResearchedAt ? -1 : 1))
      .slice(0, tickers.length - MAX_ENTRIES);
    for (const t of evict) delete merged[t];
  }
  return merged;
}

/** Read-merge-write one scan run's records. Returns the merged ledger (or null if Redis is unconfigured). */
export async function applyResearchRecords(agentId, records, now = new Date().toISOString()) {
  if (!records?.length) return null;
  const redis = getRedis();
  if (!redis) {
    console.warn(`[ResearchLedger] Redis not configured — ${records.length} research record(s) for ${agentId} not persisted.`);
    return null;
  }
  try {
    const existing = await readResearchLedger(agentId);
    const merged = mergeResearchRecords(existing, records, now);
    await redis.set(ledgerKey(agentId), JSON.stringify(merged));
    return merged;
  } catch (err) {
    console.warn(`[ResearchLedger] failed to persist records for ${agentId}:`, err.message);
    return null;
  }
}

/** One-line prior-research reminder for the overlay's USER message (per-ticker/volatile — never the cached system block). */
export function formatResearchHistoryForPrompt(entry) {
  if (!entry) return "You have not researched this ticker before.";
  const parts = [
    `Your prior research on this ticker: last reviewed ${String(entry.lastResearchedAt).slice(0, 10)}`,
    `action ${entry.lastAction}`,
    entry.lastQuantScore != null ? `quant ${entry.lastQuantScore}/100` : null,
    entry.lastConfidence != null ? `confidence ${entry.lastConfidence}` : null,
    entry.timesResearched > 1 ? `reviewed ${entry.timesResearched} times total` : null,
  ].filter(Boolean);
  const thesis = entry.thesisSnippet ? ` Prior thesis: "${entry.thesisSnippet}"` : "";
  return `${parts.join(", ")}.${thesis}`;
}
