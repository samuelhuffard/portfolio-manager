import { Redis } from "@upstash/redis";

let _redis = null;

export function getRedis() {
  if (!_redis) {
    const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
    const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
    if (!url || !token) return null; // gracefully skip if not configured
    _redis = new Redis({ url, token });
  }
  return _redis;
}

// Single shared spreadsheet for the whole portfolio (one Robinhood account, one
// investor pool, one set of Holdings/Performance/Trade Ledger/Lots/Investors tabs).
// Agents still each get their own internal tab (see lib/sheets.js agentTabName),
// but that's a tab within this same spreadsheet, not a separate spreadsheet ID.
export async function getCachedSharedSpreadsheetId() {
  const redis = getRedis();
  if (!redis) return null;
  try {
    return await redis.get("pm:shared:spreadsheet-id");
  } catch (e) {
    console.warn("[Redis] Failed to get shared spreadsheet id:", e.message);
    return null;
  }
}

export async function setCachedSharedSpreadsheetId(id) {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.set("pm:shared:spreadsheet-id", id);
  } catch (e) {
    console.warn("[Redis] Failed to set shared spreadsheet id:", e.message);
  }
}

// Tracks the last successfully-processed Robinhood order timestamp, so each
// holdings-sync run only asks robinhood-sync.py for fills since then.
export async function getLastFillSyncAt() {
  const redis = getRedis();
  if (!redis) return null;
  try {
    return await redis.get("pm:last-fill-sync-at");
  } catch (e) {
    console.warn("[Redis] Failed to get last fill sync timestamp:", e.message);
    return null;
  }
}

export async function setLastFillSyncAt(iso) {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.set("pm:last-fill-sync-at", iso);
  } catch (e) {
    console.warn("[Redis] Failed to set last fill sync timestamp:", e.message);
  }
}

// Mirrors config/tax.json's reserveRatePct into Redis so the dashboard (a
// separate Vercel deployment with no filesystem access to this repo's config)
// can show the same withdrawal tax-reserve estimate without duplicating config.
export async function setCachedTaxReserveRatePct(rate) {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.set("pm:tax:reserve-rate-pct", rate);
  } catch (e) {
    console.warn("[Redis] Failed to set tax reserve rate:", e.message);
  }
}

// Approval queue — same Redis keys the dashboard's lib/proposals.ts writes/reads,
// so a fill can be matched back to the specific agent proposal Sam approved for it.
const PROPOSALS_LIST_KEY = "pm:approval_proposals";

function proposalKeyFor(id) {
  return `pm:approval_proposal:${id}`;
}

export async function listOpenApprovedProposals(limit = 250) {
  const redis = getRedis();
  if (!redis) return [];
  try {
    const ids = await redis.lrange(PROPOSALS_LIST_KEY, 0, limit - 1);
    const proposals = await Promise.all(
      ids.map((id) =>
        redis
          .get(proposalKeyFor(id))
          .then((raw) => (typeof raw === "string" ? JSON.parse(raw) : raw))
          .catch(() => null)
      )
    );
    return proposals.filter((p) => p && p.status === "ApprovedForBrokerReview" && !p.fulfilledAt);
  } catch (e) {
    console.warn("[Redis] Failed to list approved proposals:", e.message);
    return [];
  }
}

export async function markProposalFulfilled(proposalId, tradeId, now = new Date().toISOString()) {
  const redis = getRedis();
  if (!redis) return;
  try {
    const raw = await redis.get(proposalKeyFor(proposalId));
    const proposal = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!proposal) return;
    proposal.fulfilledAt = now;
    proposal.fulfilledTradeId = tradeId;
    proposal.updatedAt = now;
    await redis.set(proposalKeyFor(proposalId), JSON.stringify(proposal));
  } catch (e) {
    console.warn(`[Redis] Failed to mark proposal ${proposalId} fulfilled:`, e.message);
  }
}

// News dedup — avoid re-fetching Tavily results for the same ticker within a day
const NEWS_CACHE_TTL = 12 * 3600;

export async function getCachedNews(ticker) {
  const redis = getRedis();
  if (!redis) return null;
  try {
    const raw = await redis.get(`pm:news:${ticker}`);
    if (!raw) return null;
    return typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch (e) {
    console.warn("[Redis] Failed to get cached news:", e.message);
    return null;
  }
}

export async function setCachedNews(ticker, results) {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.set(`pm:news:${ticker}`, JSON.stringify(results), { ex: NEWS_CACHE_TTL });
  } catch (e) {
    console.warn("[Redis] Failed to cache news:", e.message);
  }
}

// Macro snapshot — shared across every ticker in a scan and changes slowly, so cache across runs too.
const MACRO_CACHE_TTL = 6 * 3600;

export async function getCachedMacro() {
  const redis = getRedis();
  if (!redis) return null;
  try {
    const raw = await redis.get("pm:macro");
    if (!raw) return null;
    return typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch (e) {
    console.warn("[Redis] Failed to get cached macro snapshot:", e.message);
    return null;
  }
}

export async function setCachedMacro(snapshot) {
  const redis = getRedis();
  if (!redis || !snapshot) return;
  try {
    await redis.set("pm:macro", JSON.stringify(snapshot), { ex: MACRO_CACHE_TTL });
  } catch (e) {
    console.warn("[Redis] Failed to cache macro snapshot:", e.message);
  }
}
