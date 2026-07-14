import { getRedis } from "./redis.js";
import {
  estimateAnthropicUsageCost,
  resolveAnthropicPricingVersion,
} from "./anthropic-pricing.js";

export const ANTHROPIC_USAGE_SCHEMA_VERSION = "anthropic-usage-v2";
export const ANTHROPIC_USAGE_RETENTION_DAYS = 45;
export const ANTHROPIC_USAGE_LIST_MAX = 1000;

const USAGE_LIST_PREFIX = "pm:anthropic-usage";
const USAGE_TTL_SECONDS = ANTHROPIC_USAGE_RETENTION_DAYS * 24 * 3600;
const RECORD_USAGE_SCRIPT = `-- pm-anthropic-usage-record-v2
redis.call("lpush", KEYS[1], ARGV[1])
redis.call("ltrim", KEYS[1], 0, tonumber(ARGV[2]) - 1)
redis.call("expire", KEYS[1], ARGV[3])
return redis.call("llen", KEYS[1])
`;

function dayKey(date) {
  return `${USAGE_LIST_PREFIX}:${date}`;
}

function utcDate(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError("date must be valid");
  return date.toISOString().slice(0, 10);
}

function numberOrZero(value, field) {
  const numeric = value == null ? 0 : Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) throw new TypeError(`${field} must be a finite non-negative number`);
  return numeric;
}

function cacheCreationBreakdown(usage, cacheWriteTtl) {
  const total = numberOrZero(usage.cache_creation_input_tokens, "usage.cache_creation_input_tokens");
  const details = usage.cache_creation;
  if (details && typeof details === "object") {
    const fiveMinute = numberOrZero(details.ephemeral_5m_input_tokens, "usage.cache_creation.ephemeral_5m_input_tokens");
    const oneHour = numberOrZero(details.ephemeral_1h_input_tokens, "usage.cache_creation.ephemeral_1h_input_tokens");
    if (Math.abs(fiveMinute + oneHour - total) > 1e-9) {
      throw new TypeError("cache_creation token classes do not sum to cache_creation_input_tokens");
    }
    return { cacheCreation5mInputTokens: fiveMinute, cacheCreation1hInputTokens: oneHour };
  }
  if (total === 0) return { cacheCreation5mInputTokens: 0, cacheCreation1hInputTokens: 0 };
  if (cacheWriteTtl === "5m") return { cacheCreation5mInputTokens: total, cacheCreation1hInputTokens: 0 };
  if (cacheWriteTtl === "1h") return { cacheCreation5mInputTokens: 0, cacheCreation1hInputTokens: total };
  throw new TypeError("cache_creation_input_tokens require cache_creation detail or an explicit cacheWriteTtl");
}

export function extractUsage(usage = {}, { cacheWriteTtl = null } = {}) {
  const inputTokens = numberOrZero(usage.input_tokens, "usage.input_tokens");
  const outputTokens = numberOrZero(usage.output_tokens, "usage.output_tokens");
  const cacheCreationInputTokens = numberOrZero(usage.cache_creation_input_tokens, "usage.cache_creation_input_tokens");
  const cacheReadInputTokens = numberOrZero(usage.cache_read_input_tokens, "usage.cache_read_input_tokens");
  const cacheClasses = cacheCreationBreakdown(usage, cacheWriteTtl);
  const totalInputTokens = inputTokens + cacheCreationInputTokens + cacheReadInputTokens;

  return {
    inputTokens,
    outputTokens,
    cacheCreationInputTokens,
    ...cacheClasses,
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
  cacheWriteTtl = null,
  metadata = {},
  now = new Date(),
  env = process.env,
  pricingVersion = null,
}) {
  if (!String(role ?? "").trim()) throw new Error("role is required");
  if (!String(model ?? "").trim()) throw new Error("model is required");
  const createdAt = (now instanceof Date ? now : new Date(now)).toISOString();
  const extracted = extractUsage(usage, { cacheWriteTtl });
  const resolvedPricingVersion = pricingVersion || resolveAnthropicPricingVersion({ env, at: createdAt });
  const cost = estimateAnthropicUsageCost({ model, pricingVersion: resolvedPricingVersion, usage: extracted });
  return {
    schemaVersion: ANTHROPIC_USAGE_SCHEMA_VERSION,
    pricingVersion: resolvedPricingVersion,
    estimatedCostUsd: cost.estimatedCostUsd,
    costBreakdownUsd: cost.costBreakdownUsd,
    ...extracted,
    role: String(role).trim(),
    agentId,
    ticker,
    model: cost.canonicalModel,
    requestedModel: String(model).trim(),
    stopReason,
    cacheHit: extracted.cacheReadInputTokens > 0,
    cacheWriteTtl,
    metadata,
    createdAt,
  };
}

/**
 * Persists one priced usage record. The result explicitly says whether Redis
 * accepted it; callers with an enabled monthly ceiling must treat persisted=false
 * as fail-closed because subsequent remaining-budget math would be untrustworthy.
 */
export async function recordAnthropicUsage(input, { redis = getRedis() } = {}) {
  const record = buildAnthropicUsageRecord(input);
  if (!redis) {
    const error = "redis_not_configured";
    console.error(`[AnthropicUsage] Failed to record usage (telemetry dropped): ${error}`);
    return { record, persisted: false, error };
  }
  const key = dayKey(utcDate(record.createdAt));
  try {
    await redis.eval(RECORD_USAGE_SCRIPT, [key], [JSON.stringify(record), String(ANTHROPIC_USAGE_LIST_MAX), String(USAGE_TTL_SECONDS)]);
    return { record, persisted: true, error: null };
  } catch (err) {
    console.error("[AnthropicUsage] Failed to record usage (telemetry dropped):", err.message);
    return { record, persisted: false, error: err.message };
  }
}

function startOfUtcMonth(now) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

function addUtcDays(date, days) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function parseStoredRecord(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value !== "string") throw new TypeError("usage record must be JSON text or an object");
  const parsed = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new TypeError("usage record must decode to an object");
  return parsed;
}

function addCost(group, key, cost) {
  const label = String(key ?? "UNKNOWN").trim() || "UNKNOWN";
  group[label] = Number(((group[label] ?? 0) + cost).toFixed(12));
}

function exactNumber(value, expected, field) {
  if (typeof value !== "number" || !Number.isFinite(value) || value !== expected) {
    throw new TypeError(`${field}_does_not_match_recomputed_cost`);
  }
}

function validateAndRepriceV2(record) {
  if (!String(record.pricingVersion ?? "").trim()) throw new TypeError("missing_pricing_version");
  if (!String(record.model ?? "").trim() || !String(record.role ?? "").trim()) throw new TypeError("missing_model_or_role");
  const usage = {
    inputTokens: numberOrZero(record.inputTokens, "record.inputTokens"),
    outputTokens: numberOrZero(record.outputTokens, "record.outputTokens"),
    cacheCreation5mInputTokens: numberOrZero(record.cacheCreation5mInputTokens, "record.cacheCreation5mInputTokens"),
    cacheCreation1hInputTokens: numberOrZero(record.cacheCreation1hInputTokens, "record.cacheCreation1hInputTokens"),
    cacheReadInputTokens: numberOrZero(record.cacheReadInputTokens, "record.cacheReadInputTokens"),
  };
  const cacheCreationInputTokens = numberOrZero(record.cacheCreationInputTokens, "record.cacheCreationInputTokens");
  if (usage.cacheCreation5mInputTokens + usage.cacheCreation1hInputTokens !== cacheCreationInputTokens) {
    throw new TypeError("cache_creation_classes_do_not_match_total");
  }
  const totalInputTokens = usage.inputTokens + cacheCreationInputTokens + usage.cacheReadInputTokens;
  if (numberOrZero(record.totalInputTokens, "record.totalInputTokens") !== totalInputTokens) {
    throw new TypeError("total_input_tokens_do_not_match_classes");
  }
  const recomputed = estimateAnthropicUsageCost({ model: record.model, pricingVersion: record.pricingVersion, usage });
  exactNumber(record.estimatedCostUsd, recomputed.estimatedCostUsd, "estimated_cost");
  const breakdown = record.costBreakdownUsd;
  if (!breakdown || typeof breakdown !== "object" || Array.isArray(breakdown)) throw new TypeError("missing_cost_breakdown");
  const expectedKeys = Object.keys(recomputed.costBreakdownUsd).sort();
  if (Object.keys(breakdown).sort().join("|") !== expectedKeys.join("|")) throw new TypeError("cost_breakdown_keys_do_not_match");
  for (const key of expectedKeys) exactNumber(breakdown[key], recomputed.costBreakdownUsd[key], `cost_breakdown_${key}`);
  return { ...recomputed, role: String(record.role).trim(), pricingBucket: record.pricingVersion };
}

function conservativeLegacyCost(record) {
  // v1 rows predate priced telemetry but preserve the token classes needed to
  // reconstruct a safe cost. The old schema did not distinguish 5-minute from
  // one-hour cache writes, so price every legacy cache write at the more
  // expensive one-hour rate. This deliberately overstates, never understates,
  // legacy month-to-date spend.
  const createdAt = new Date(record.createdAt);
  const pricingVersion = resolveAnthropicPricingVersion({ env: {}, at: createdAt });
  const inputTokens = numberOrZero(record.inputTokens, "legacy.inputTokens");
  const outputTokens = numberOrZero(record.outputTokens, "legacy.outputTokens");
  const cacheCreationInputTokens = numberOrZero(record.cacheCreationInputTokens, "legacy.cacheCreationInputTokens");
  const cacheReadInputTokens = numberOrZero(record.cacheReadInputTokens, "legacy.cacheReadInputTokens");
  if (!String(record.model ?? "").trim() || !String(record.role ?? "").trim()) {
    throw new TypeError("legacy_missing_model_or_role");
  }
  const priced = estimateAnthropicUsageCost({
    model: record.model,
    pricingVersion,
    usage: {
      inputTokens,
      outputTokens,
      cacheCreation5mInputTokens: 0,
      cacheCreation1hInputTokens: cacheCreationInputTokens,
      cacheReadInputTokens,
    },
  });
  return {
    ...priced,
    role: String(record.role).trim(),
    pricingBucket: `${pricingVersion}:legacy-conservative-1h-cache`,
  };
}

export function aggregateAnthropicUsageRecords(records, {
  monthUtc,
  expectedDayByIndex = [],
  truncatedDays = [],
  readErrors = [],
} = {}) {
  const month = String(monthUtc ?? "").trim();
  if (!/^\d{4}-\d{2}$/.test(month)) throw new TypeError("monthUtc must be YYYY-MM");
  const totals = { estimatedCostUsd: 0, records: 0, legacyRepricedRecords: 0, byModel: {}, byRole: {}, byPricingVersion: {} };
  const issues = [];
  for (let index = 0; index < records.length; index += 1) {
    let record;
    try {
      record = parseStoredRecord(records[index]);
      const createdDay = utcDate(record.createdAt);
      if (!createdDay.startsWith(`${month}-`)) throw new TypeError(`record ${createdDay} falls outside ${month}`);
      if (expectedDayByIndex[index] && createdDay !== expectedDayByIndex[index]) {
        throw new TypeError(`record date ${createdDay} does not match Redis day ${expectedDayByIndex[index]}`);
      }
      let cost;
      let model;
      let role;
      let pricingBucket;
      if (record.schemaVersion === ANTHROPIC_USAGE_SCHEMA_VERSION) {
        const repriced = validateAndRepriceV2(record);
        cost = repriced.estimatedCostUsd;
        model = repriced.canonicalModel;
        role = repriced.role;
        pricingBucket = repriced.pricingBucket;
      } else if (record.schemaVersion == null) {
        const legacy = conservativeLegacyCost(record);
        cost = legacy.estimatedCostUsd;
        model = legacy.canonicalModel;
        role = legacy.role;
        pricingBucket = legacy.pricingBucket;
        totals.legacyRepricedRecords += 1;
      } else {
        throw new TypeError("unknown_schema");
      }
      totals.estimatedCostUsd = Number((totals.estimatedCostUsd + cost).toFixed(12));
      totals.records += 1;
      addCost(totals.byModel, model, cost);
      addCost(totals.byRole, role, cost);
      addCost(totals.byPricingVersion, pricingBucket, cost);
    } catch (error) {
      issues.push({ index, reason: error.message });
    }
  }
  for (const day of truncatedDays) issues.push({ day, reason: "daily_usage_list_reached_retention_cap" });
  for (const error of readErrors) issues.push({ day: error.day, reason: `redis_read_failed:${error.error}` });
  return {
    ...totals,
    telemetryStatus: readErrors.length ? "UNREADABLE" : issues.length ? "INCOMPLETE" : "COMPLETE",
    issueCount: issues.length,
    issues,
  };
}

/** Read-only month-to-date aggregation over UTC day keys. */
export async function readAnthropicMonthToDate({ now = new Date(), redis = getRedis() } = {}) {
  const instant = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(instant.getTime())) throw new TypeError("now must be valid");
  const monthUtc = instant.toISOString().slice(0, 7);
  const monthStart = startOfUtcMonth(instant);
  const retentionStart = addUtcDays(new Date(Date.UTC(instant.getUTCFullYear(), instant.getUTCMonth(), instant.getUTCDate())), -(ANTHROPIC_USAGE_RETENTION_DAYS - 1));
  const coverageStart = monthStart > retentionStart ? monthStart : retentionStart;
  const base = {
    monthUtc,
    retentionDays: ANTHROPIC_USAGE_RETENTION_DAYS,
    coverageStartUtc: utcDate(coverageStart),
    coverageEndUtc: utcDate(instant),
  };
  if (!redis) {
    return {
      ...base,
      estimatedCostUsd: null,
      records: 0,
      byModel: {},
      byRole: {},
      byPricingVersion: {},
      telemetryStatus: "UNAVAILABLE",
      issueCount: 1,
      issues: [{ reason: "redis_not_configured" }],
    };
  }

  const records = [];
  const expectedDayByIndex = [];
  const truncatedDays = [];
  const readErrors = [];
  for (let cursor = new Date(coverageStart); cursor <= instant; cursor = addUtcDays(cursor, 1)) {
    const day = utcDate(cursor);
    try {
      const values = await redis.lrange(dayKey(day), 0, ANTHROPIC_USAGE_LIST_MAX - 1);
      const dayRecords = Array.isArray(values) ? values : [];
      if (dayRecords.length >= ANTHROPIC_USAGE_LIST_MAX) truncatedDays.push(day);
      records.push(...dayRecords);
      expectedDayByIndex.push(...dayRecords.map(() => day));
    } catch (error) {
      readErrors.push({ day, error: error.message });
    }
  }
  return {
    ...base,
    ...aggregateAnthropicUsageRecords(records, { monthUtc, expectedDayByIndex, truncatedDays, readErrors }),
  };
}
