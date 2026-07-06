import { getRedis } from "./redis.js";

const USAGE_LIST_PREFIX = "pm:anthropic-usage";
const USAGE_LIST_MAX = 1000;
const USAGE_TTL_SECONDS = 45 * 24 * 3600;

function todayKey(now = new Date()) {
  return `${USAGE_LIST_PREFIX}:${now.toISOString().slice(0, 10)}`;
}

function numberOrZero(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

export function extractUsage(usage = {}) {
  const inputTokens = numberOrZero(usage.input_tokens);
  const outputTokens = numberOrZero(usage.output_tokens);
  const cacheCreationInputTokens = numberOrZero(usage.cache_creation_input_tokens);
  const cacheReadInputTokens = numberOrZero(usage.cache_read_input_tokens);
  const totalInputTokens = inputTokens + cacheCreationInputTokens + cacheReadInputTokens;

  return {
    inputTokens,
    outputTokens,
    cacheCreationInputTokens,
    cacheReadInputTokens,
    totalInputTokens,
  };
}

export function buildAnthropicUsageRecord({
  role,
  agentId = null,
  ticker = null,
  model,
  stopReason = null,
  usage,
  metadata = {},
  now = new Date(),
}) {
  if (!role) throw new Error("role is required");
  if (!model) throw new Error("model is required");
  const extracted = extractUsage(usage);
  return {
    ...extracted,
    role,
    agentId,
    ticker,
    model,
    stopReason,
    cacheHit: extracted.cacheReadInputTokens > 0,
    metadata,
    createdAt: now.toISOString(),
  };
}

export async function recordAnthropicUsage(input) {
  const redis = getRedis();
  if (!redis) return null;
  const record = buildAnthropicUsageRecord(input);
  const key = todayKey(new Date(record.createdAt));
  try {
    await redis.lpush(key, JSON.stringify(record));
    await redis.ltrim(key, 0, USAGE_LIST_MAX - 1);
    await redis.expire(key, USAGE_TTL_SECONDS);
  } catch (err) {
    console.warn("[AnthropicUsage] Failed to record usage:", err.message);
  }
  return record;
}
