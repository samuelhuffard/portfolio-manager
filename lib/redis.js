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

// Each agent has its own cached spreadsheet ID — fully separate data storage, no shared key.
export async function getCachedSpreadsheetId(agentId) {
  const redis = getRedis();
  if (!redis) return null;
  try {
    return await redis.get(`pm:${agentId}:spreadsheet-id`);
  } catch (e) {
    console.warn(`[Redis] Failed to get spreadsheet id for ${agentId}:`, e.message);
    return null;
  }
}

export async function setCachedSpreadsheetId(agentId, id) {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.set(`pm:${agentId}:spreadsheet-id`, id);
  } catch (e) {
    console.warn(`[Redis] Failed to set spreadsheet id for ${agentId}:`, e.message);
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
