import { randomUUID } from "node:crypto";
import { McpReadJobKindSchema, McpReadRequestSchema } from "../contracts/mcp-read-job.js";
import { getRedis } from "../lib/redis.js";
import { etDateString } from "../lib/market-calendar.js";

const REQUEST_TTL_SECONDS = 36 * 60 * 60;
const ENQUEUE_REQUEST_SCRIPT = `
local existing = redis.call("GET", KEYS[2])
if existing then return {0, existing} end
redis.call("SET", KEYS[2], ARGV[1], "EX", tonumber(ARGV[2]))
redis.call("RPUSH", KEYS[1], ARGV[1])
redis.call("EXPIRE", KEYS[1], tonumber(ARGV[2]))
return {1, ARGV[1]}
`;

export function mcpReadRequestKey(kind) {
  return `pm:mcp-read:${McpReadJobKindSchema.parse(kind)}:request`;
}

export function mcpReadQueueKey(kind) {
  return `pm:mcp-read:${McpReadJobKindSchema.parse(kind)}:queue`;
}

export function mcpReadInvocationKey(kind, invocationId) {
  const parsedKind = McpReadJobKindSchema.parse(kind);
  const normalized = String(invocationId ?? "").trim();
  if (!normalized) throw new Error("invocationId is required for a durable MCP request.");
  return `pm:mcp-read:${parsedKind}:invocation:${encodeURIComponent(normalized)}`;
}

/**
 * Queue one durable, read-only broker job per scheduled invocation. The atomic
 * invocation marker prevents duplicate scheduler delivery while the FIFO keeps
 * later slots distinct when an earlier broker read is retrying.
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
  const payload = JSON.stringify(request);
  const result = await redis.eval(
    ENQUEUE_REQUEST_SCRIPT,
    [mcpReadQueueKey(parsedKind), mcpReadInvocationKey(parsedKind, request.invocationId)],
    [payload, String(REQUEST_TTL_SECONDS)],
  );
  if (!Array.isArray(result) || result.length !== 2) throw new Error("MCP request enqueue returned an invalid result.");
  const retained = McpReadRequestSchema.parse(typeof result[1] === "string" ? JSON.parse(result[1]) : result[1]);
  return { queued: Number(result[0]) === 1, request: retained };
}

export const requestMcpHoldingsSync = (options) => enqueueMcpReadRequest("holdings-sync", options);
export const requestMcpOrderReconciliation = (options) => enqueueMcpReadRequest("order-reconciliation", options);

/**
 * Bind a downstream accounting write to the exact durable request emitted by
 * the scheduler. Shape-valid CLI flags are not scheduler provenance.
 */
export async function assertMcpReadRequestProvenance({ kind, requestId, invocationId, redis = getRedis() } = {}) {
  const parsedKind = McpReadJobKindSchema.parse(kind);
  const parsedRequestId = McpReadRequestSchema.shape.id.parse(requestId);
  const parsedInvocationId = McpReadRequestSchema.shape.invocationId.parse(invocationId);
  if (!parsedInvocationId) throw new Error("A scheduled MCP invocation ID is required for provenance verification.");
  if (!redis) throw new Error("Redis is required to verify scheduled MCP request provenance.");

  const raw = await redis.get(mcpReadInvocationKey(parsedKind, parsedInvocationId));
  if (!raw) throw new Error("Scheduled MCP request provenance is missing or expired; refusing to write a provenance-bound snapshot.");
  let request;
  try {
    request = McpReadRequestSchema.parse(typeof raw === "string" ? JSON.parse(raw) : raw);
  } catch {
    throw new Error("Scheduled MCP request provenance is malformed; refusing to write a provenance-bound snapshot.");
  }
  const [requestedForET] = parsedInvocationId.split("/");
  if (
    request.id !== parsedRequestId
    || request.kind !== parsedKind
    || request.invocationId !== parsedInvocationId
    || request.requestedForET !== requestedForET
  ) {
    throw new Error("Scheduled MCP request provenance does not match the snapshot; refusing to write it.");
  }
  return request;
}
