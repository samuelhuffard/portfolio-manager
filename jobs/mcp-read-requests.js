import { randomUUID } from "node:crypto";
import { McpReadJobKindSchema, McpReadRequestSchema } from "../contracts/mcp-read-job.js";
import { getRedis } from "../lib/redis.js";
import { etDateString } from "../lib/market-calendar.js";

const REQUEST_TTL_SECONDS = 36 * 60 * 60;

export function mcpReadRequestKey(kind) {
  return `pm:mcp-read:${McpReadJobKindSchema.parse(kind)}:request`;
}

/**
 * Queue one durable, read-only broker job for the Mac companion. NX means a
 * sleeping Mac accumulates one fresh request rather than five duplicate broker
 * reads; the companion's lease/receipt protocol owns actual completion.
 */
export async function enqueueMcpReadRequest(kind, { redis = getRedis(), now = new Date(), invocationId = null } = {}) {
  const parsedKind = McpReadJobKindSchema.parse(kind);
  if (!redis) throw new Error("Redis is required to request Mac MCP broker work.");
  const request = McpReadRequestSchema.parse({
    id: randomUUID(),
    kind: parsedKind,
    requestedAt: now.toISOString(),
    requestedForET: etDateString(now),
    invocationId,
  });
  const result = await redis.set(mcpReadRequestKey(parsedKind), JSON.stringify(request), {
    nx: true,
    ex: REQUEST_TTL_SECONDS,
  });
  if (result === "OK") return { queued: true, request };

  // A scheduled run found already-pending work. Report the request the Mac
  // will actually process instead of inventing a misleading request id.
  const existingRaw = await redis.get(mcpReadRequestKey(parsedKind));
  const existing = McpReadRequestSchema.parse(typeof existingRaw === "string" ? JSON.parse(existingRaw) : existingRaw);
  return { queued: false, request: existing };
}

export const requestMcpHoldingsSync = (options) => enqueueMcpReadRequest("holdings-sync", options);
export const requestMcpOrderReconciliation = (options) => enqueueMcpReadRequest("order-reconciliation", options);
