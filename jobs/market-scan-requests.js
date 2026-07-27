import { getRedis } from "../lib/redis.js";

export const MARKET_SCAN_TRIGGER_KEY = "pm:market_scan_trigger";
const MARKET_SCAN_TRIGGER_TTL_SECONDS = 10 * 60;

/**
 * Ask the Mac execution companion to refresh its read-only Robinhood MCP
 * market scans.  The trigger is deliberately coalesced: research uses the
 * last completed snapshot and never waits for, or attempts, a direct broker
 * login from Jetson.
 */
export async function requestMcpMarketScan({ redis = getRedis(), now = new Date() } = {}) {
  if (!redis) throw new Error("Redis is required to request a Mac MCP market scan.");
  const payload = JSON.stringify({ requestedAt: now.toISOString(), source: "research-scan" });
  const result = await redis.set(MARKET_SCAN_TRIGGER_KEY, payload, {
    nx: true,
    ex: MARKET_SCAN_TRIGGER_TTL_SECONDS,
  });
  return { queued: result === "OK" || result === true };
}
