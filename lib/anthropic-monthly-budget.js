import { randomUUID } from "node:crypto";
import { getRedis } from "./redis.js";
import { readAnthropicMonthToDate } from "./anthropic-usage.js";
import {
  estimateAnthropicRequestUpperBound,
  resolveAnthropicModelPricing,
  resolveAnthropicPricingVersion,
} from "./anthropic-pricing.js";

const EPSILON = 1e-9;
const MICRO_USD = 1_000_000;
const STATUS_TTL_SECONDS = 50 * 24 * 60 * 60;
const DEFAULT_LEASE_SECONDS = 30 * 60;
const DEFAULT_MAX_REQUEST_BYTES = 1_000_000;
export const ANTHROPIC_BUDGET_READINESS_VERSION = "anthropic-budget-readiness-v2";
export const ANTHROPIC_BUDGET_STATUS_PREFIX = "pm:anthropic-budget-status";

const AUTHORIZE_SCRIPT = `-- pm-anthropic-budget-authorize-v2
local expired = redis.call("zrangebyscore", KEYS[2], "-inf", ARGV[1])
local reserved = tonumber(redis.call("hget", KEYS[1], "reservedMicrousd") or "0")
local spent = tonumber(redis.call("hget", KEYS[1], "spentMicrousd") or "0")
for _, id in ipairs(expired) do
  local amount = tonumber(redis.call("hget", KEYS[3], id) or "0")
  reserved = math.max(0, reserved - amount)
  spent = spent + amount
  redis.call("hdel", KEYS[3], id)
end
if #expired > 0 then
  redis.call("zremrangebyscore", KEYS[2], "-inf", ARGV[1])
  redis.call("hincrby", KEYS[1], "expiredLeasesRecovered", #expired)
end
local poison = redis.call("hget", KEYS[1], "poisonedReason")
if poison then return {"POISONED", 0, reserved, poison} end
local observed = tonumber(ARGV[5])
if observed > spent then spent = observed end
local reserve = tonumber(ARGV[4])
local cap = tonumber(ARGV[6])
local protected = tonumber(ARGV[7])
local isProtected = ARGV[8] == "1"
local limit = cap
if not isProtected then limit = math.max(0, cap - protected) end
local projected = spent + reserved + reserve
if projected > limit then
  local reason = "monthly_budget_exhausted"
  if not isProtected and projected <= cap and protected > 0 then reason = "protected_capacity_reserved" end
  redis.call("hincrby", KEYS[1], "deniedTotal", 1)
  if ARGV[9] == "evaluator" then
    redis.call("hincrby", KEYS[1], "deniedEvaluator", 1)
  elseif ARGV[9] == "weekly_review" then
    redis.call("hincrby", KEYS[1], "deniedWeeklyReview", 1)
  elseif isProtected then
    redis.call("hincrby", KEYS[1], "deniedProtectedHolding", 1)
  else
    redis.call("hincrby", KEYS[1], "deniedOther", 1)
  end
  if reason == "protected_capacity_reserved" then redis.call("hincrby", KEYS[1], "deniedDiscoveryProtectedPool", 1) end
  redis.call("hset", KEYS[1], "spentMicrousd", spent, "reservedMicrousd", reserved, "reservedUsd", reserved / 1000000,
    "schemaVersion", ARGV[10], "lastDeniedAt", ARGV[11], "lastDeniedReason", reason, "lastDeniedRole", ARGV[9])
  if isProtected then redis.call("hset", KEYS[1], "lastDeniedProtectedAt", ARGV[11]) end
  redis.call("expire", KEYS[1], ARGV[12])
  return {reason == "protected_capacity_reserved" and "PROTECTED_POOL" or "EXHAUSTED", spent, reserved, reason}
end
reserved = reserved + reserve
redis.call("hset", KEYS[3], ARGV[2], reserve)
redis.call("zadd", KEYS[2], ARGV[3], ARGV[2])
redis.call("hset", KEYS[1], "spentMicrousd", spent, "reservedMicrousd", reserved, "reservedUsd", reserved / 1000000,
  "schemaVersion", ARGV[10], "protectedReserveMicrousd", protected, "leaseSeconds", ARGV[13])
redis.call("expire", KEYS[1], ARGV[12])
redis.call("expire", KEYS[2], ARGV[12])
redis.call("expire", KEYS[3], ARGV[12])
return {"AUTHORIZED", spent, reserved, ARGV[3]}
`;

const SETTLE_SCRIPT = `-- pm-anthropic-budget-settle-v2
local amount = redis.call("hget", KEYS[3], ARGV[1])
if not amount then return {"MISSING", 0, 0} end
local reserved = tonumber(redis.call("hget", KEYS[1], "reservedMicrousd") or "0")
reserved = math.max(0, reserved - tonumber(amount))
redis.call("hdel", KEYS[3], ARGV[1])
redis.call("zrem", KEYS[2], ARGV[1])
local spent = tonumber(redis.call("hget", KEYS[1], "spentMicrousd") or "0")
if ARGV[2] == "SUCCESS" then
  spent = spent + tonumber(ARGV[3])
  redis.call("hincrby", KEYS[1], "settledCalls", 1)
elseif ARGV[2] == "AMBIGUOUS_FAILURE" then
  spent = spent + tonumber(amount)
  redis.call("hincrby", KEYS[1], "ambiguousFailureSettlements", 1)
else
  redis.call("hincrby", KEYS[1], "providerFailureSettlements", 1)
end
redis.call("hset", KEYS[1], "spentMicrousd", spent, "reservedMicrousd", reserved, "reservedUsd", reserved / 1000000,
  "schemaVersion", ARGV[4], "lastSettlementAt", ARGV[5], "lastSettlementKind", ARGV[2])
redis.call("expire", KEYS[1], ARGV[6])
redis.call("expire", KEYS[2], ARGV[6])
redis.call("expire", KEYS[3], ARGV[6])
return {"SETTLED", spent, reserved}
`;

const POISON_SCRIPT = `-- pm-anthropic-budget-poison-v2
redis.call("hset", KEYS[1], "poisonedReason", ARGV[1], "poisonedAt", ARGV[2], "schemaVersion", ARGV[3])
redis.call("expire", KEYS[1], ARGV[4])
return 1
`;

export class MonthlyAnthropicBudgetError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "MonthlyAnthropicBudgetError";
    this.code = code;
  }
}

function optionalNonnegative(value, fallback = 0) {
  const raw = String(value ?? "").trim();
  if (!raw) return fallback;
  const numeric = Number(raw);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
}

function configuredCeiling(env) {
  const raw = String(env.ANTHROPIC_MONTHLY_MAX_USD ?? "").trim();
  if (!raw) return { status: "NOT_CONFIGURED", ceilingUsd: null, protectedReserveUsd: 0, error: null };
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    return { status: "INVALID_CONFIG", ceilingUsd: null, protectedReserveUsd: 0, error: "ANTHROPIC_MONTHLY_MAX_USD must be a finite positive number" };
  }
  const protectedReserveUsd = optionalNonnegative(env.ANTHROPIC_MONTHLY_PROTECTED_RESERVE_USD);
  if (protectedReserveUsd == null || protectedReserveUsd > value) {
    return { status: "INVALID_CONFIG", ceilingUsd: value, protectedReserveUsd: 0, error: "ANTHROPIC_MONTHLY_PROTECTED_RESERVE_USD must be non-negative and no greater than the monthly ceiling" };
  }
  return { status: "CONFIGURED", ceilingUsd: value, protectedReserveUsd, error: null };
}

function positive(value, fallback) {
  const normalized = typeof value === "string" ? value.trim() : value;
  const numeric = Number(normalized);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

function roleReserveUsd(role, env) {
  if (role === "evaluator") return positive(env.ANTHROPIC_EVALUATOR_CALL_RESERVE_USD, 0.1);
  if (role === "weekly_review") return positive(env.ANTHROPIC_WEEKLY_REVIEW_CALL_RESERVE_USD, 0.03);
  return positive(env.ANTHROPIC_GENERATOR_CALL_RESERVE_USD, 0.03);
}

export function anthropicProviderFailureDisposition(error) {
  const status = Number(error?.status);
  return Number.isInteger(status) && status >= 400 && status <= 599
    ? "PROVIDER_REJECTION"
    : "AMBIGUOUS_FAILURE";
}

function money(value) {
  return Number(Number(value).toFixed(12));
}

function toMicroUsd(value) {
  return Math.ceil((Number(value) - EPSILON) * MICRO_USD);
}

function capMicroUsd(value) {
  return Math.floor((Number(value) + EPSILON) * MICRO_USD);
}

function fromMicroUsd(value) {
  return money(Number(value ?? 0) / MICRO_USD);
}

function asDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError("date must be valid");
  return date;
}

function monthOf(value) {
  return asDate(value).toISOString().slice(0, 7);
}

export function anthropicBudgetStatusKey(value = new Date()) {
  return `${ANTHROPIC_BUDGET_STATUS_PREFIX}:${monthOf(value)}`;
}

function budgetKeys(value) {
  const state = anthropicBudgetStatusKey(value);
  return [state, `${state}:leases`, `${state}:lease-data`];
}

function nonnegative(value) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : 0;
}

async function readBudgetStatus(redis, at) {
  if (!redis) return { status: "UNAVAILABLE", error: "redis_not_configured", data: null };
  try {
    const instant = asDate(at);
    const keys = budgetKeys(instant);
    const raw = await redis.hgetall(keys[0]);
    const value = raw && typeof raw === "object" ? raw : {};
    const reservedUsd = value.reservedMicrousd != null ? fromMicroUsd(value.reservedMicrousd) : nonnegative(value.reservedUsd);
    return {
      status: "COMPLETE",
      error: null,
      data: {
        reservedUsd,
        settledSpentUsd: fromMicroUsd(value.spentMicrousd),
        activeLeases: nonnegative(await redis.zcard(keys[1])),
        expiredLeasesRecovered: nonnegative(value.expiredLeasesRecovered),
        providerFailureSettlements: nonnegative(value.providerFailureSettlements),
        ambiguousFailureSettlements: nonnegative(value.ambiguousFailureSettlements),
        poisonedReason: value.poisonedReason ? String(value.poisonedReason) : null,
        protectedReserveUsd: fromMicroUsd(value.protectedReserveMicrousd),
        deniedTotal: nonnegative(value.deniedTotal),
        deniedProtectedHolding: nonnegative(value.deniedProtectedHolding),
        deniedEvaluator: nonnegative(value.deniedEvaluator),
        deniedWeeklyReview: nonnegative(value.deniedWeeklyReview),
        deniedDiscoveryProtectedPool: nonnegative(value.deniedDiscoveryProtectedPool),
        deniedOther: nonnegative(value.deniedOther),
        lastDeniedAt: value.lastDeniedAt ? String(value.lastDeniedAt) : null,
        lastDeniedProtectedAt: value.lastDeniedProtectedAt ? String(value.lastDeniedProtectedAt) : null,
        lastDeniedReason: value.lastDeniedReason ? String(value.lastDeniedReason) : null,
        lastDeniedRole: value.lastDeniedRole ? String(value.lastDeniedRole) : null,
      },
    };
  } catch (error) {
    return { status: "UNREADABLE", error: error.message, data: null };
  }
}

export async function getAnthropicSpendReport({ env = process.env, now = new Date(), redis = getRedis() } = {}) {
  const cap = configuredCeiling(env);
  let pricingVersion = null;
  let pricingError = null;
  try {
    pricingVersion = resolveAnthropicPricingVersion({ env, at: now });
  } catch (error) {
    pricingError = error.message;
  }
  const [usage, budgetStatus] = await Promise.all([
    readAnthropicMonthToDate({ now, redis }),
    readBudgetStatus(redis, now),
  ]);
  const telemetryStatus = budgetStatus.status === "UNREADABLE" ? "UNREADABLE" : usage.telemetryStatus;
  const telemetryComplete = telemetryStatus === "COMPLETE" && !budgetStatus.data?.poisonedReason;
  const reservedUsd = budgetStatus.data?.reservedUsd ?? 0;
  const accountedCostUsd = usage.estimatedCostUsd == null
    ? null
    : money(Math.max(usage.estimatedCostUsd, budgetStatus.data?.settledSpentUsd ?? 0));
  const remainingUsd = cap.status === "CONFIGURED" && telemetryComplete && pricingVersion
    ? money(Math.max(0, cap.ceilingUsd - accountedCostUsd - reservedUsd))
    : null;
  const configIssues = [
    ...(cap.error ? [{ reason: cap.error }] : []),
    ...(pricingError ? [{ reason: pricingError }] : []),
    ...(budgetStatus.error ? [{ reason: `budget_status:${budgetStatus.error}` }] : []),
    ...(budgetStatus.data?.poisonedReason ? [{ reason: `budget_poisoned:${budgetStatus.data.poisonedReason}` }] : []),
  ];
  return {
    monthUtc: usage.monthUtc,
    capStatus: cap.status,
    ceilingUsd: cap.ceilingUsd,
    protectedReserveUsd: cap.protectedReserveUsd,
    remainingUsd,
    pricingVersion,
    pricingError,
    telemetryStatus: budgetStatus.data?.poisonedReason ? "INCOMPLETE" : telemetryStatus,
    estimatedCostUsd: accountedCostUsd,
    reservedUsd,
    activeLeases: budgetStatus.data?.activeLeases ?? null,
    providerFailureSettlements: budgetStatus.data?.providerFailureSettlements ?? null,
    ambiguousFailureSettlements: budgetStatus.data?.ambiguousFailureSettlements ?? null,
    records: usage.records,
    legacyRepricedRecords: usage.legacyRepricedRecords ?? 0,
    byModel: usage.byModel,
    byRole: usage.byRole,
    byPricingVersion: usage.byPricingVersion,
    retentionDays: usage.retentionDays,
    coverageStartUtc: usage.coverageStartUtc,
    coverageEndUtc: usage.coverageEndUtc,
    issueCount: usage.issueCount + configIssues.length,
    issues: [...configIssues, ...usage.issues],
    denials: budgetStatus.data ? {
      total: budgetStatus.data.deniedTotal,
      protectedHolding: budgetStatus.data.deniedProtectedHolding,
      evaluator: budgetStatus.data.deniedEvaluator,
      weeklyReview: budgetStatus.data.deniedWeeklyReview,
      discoveryProtectedPool: budgetStatus.data.deniedDiscoveryProtectedPool,
      other: budgetStatus.data.deniedOther,
      lastDeniedAt: budgetStatus.data.lastDeniedAt,
      lastDeniedProtectedAt: budgetStatus.data.lastDeniedProtectedAt,
      lastDeniedReason: budgetStatus.data.lastDeniedReason,
      lastDeniedRole: budgetStatus.data.lastDeniedRole,
    } : null,
  };
}

/** Stable, privacy-safe Phase 0 observer contract for the current UTC month. */
export async function getAnthropicBudgetReadiness(options = {}) {
  const report = await getAnthropicSpendReport(options);
  const env = options.env ?? process.env;
  const warnPct = Math.min(1, positive(env.ANTHROPIC_MONTHLY_WARN_PCT, 0.8));
  const usedAndReservedUsd = report.estimatedCostUsd == null ? null : money(report.estimatedCostUsd + report.reservedUsd);
  const warningAtUsd = report.ceilingUsd == null ? null : money(report.ceilingUsd * warnPct);
  const status = report.capStatus === "NOT_CONFIGURED"
    ? "NOT_CONFIGURED"
    : report.capStatus !== "CONFIGURED" || report.telemetryStatus !== "COMPLETE" || !report.pricingVersion
      ? "UNREADY"
      : report.remainingUsd <= EPSILON
        ? "EXHAUSTED"
        : usedAndReservedUsd + EPSILON >= warningAtUsd
          ? "WARNING"
          : "OK";
  return {
    schemaVersion: ANTHROPIC_BUDGET_READINESS_VERSION,
    monthUtc: report.monthUtc,
    status,
    capStatus: report.capStatus,
    telemetryStatus: report.telemetryStatus,
    pricingVersion: report.pricingVersion,
    spentUsd: report.estimatedCostUsd,
    reservedUsd: report.reservedUsd,
    activeLeases: report.activeLeases,
    remainingUsd: report.remainingUsd,
    thresholds: {
      ceilingUsd: report.ceilingUsd,
      warnPct,
      warningAtUsd,
      protectedReserveUsd: report.protectedReserveUsd,
    },
    denials: report.denials,
    protectedCapacityDenied: Boolean((report.denials?.protectedHolding ?? 0) > 0 || (report.denials?.evaluator ?? 0) > 0),
    protectedCapacityLastDeniedAt: report.denials?.lastDeniedProtectedAt ?? null,
    coverage: {
      retentionDays: report.retentionDays,
      startUtc: report.coverageStartUtc,
      endUtc: report.coverageEndUtc,
      pricedRecords: report.records,
      legacyRepricedRecords: report.legacyRepricedRecords,
      issueCount: report.issueCount,
    },
  };
}

/**
 * Redis-authoritative monthly authorization ledger. Every call receives a
 * bounded lease in one EVAL operation; all scheduler, Lab, and manual processes
 * contend on the same state. An expired crash lease is conservatively charged
 * at its reserved amount: the process recovers without pretending a possibly
 * billed call was free.
 */
export function createAnthropicMonthlyBudget({ env = process.env, now = () => new Date(), redis = getRedis() } = {}) {
  const cap = configuredCeiling(env);
  const leaseSeconds = Math.ceil(positive(env.ANTHROPIC_CALL_LEASE_SECONDS, DEFAULT_LEASE_SECONDS));
  let loadedReport = null;
  let poisonedReason = null;
  let localOutstandingUsd = 0;
  let localSpentUsd = 0;
  const reservations = new Map();

  async function loadConfiguredReport() {
    if (loadedReport) return loadedReport;
    loadedReport = await getAnthropicSpendReport({ env, now: now(), redis });
    if (loadedReport.capStatus !== "CONFIGURED") {
      throw new MonthlyAnthropicBudgetError(
        loadedReport.issues[0]?.reason || "Anthropic monthly ceiling configuration is invalid",
        "monthly_budget_config_invalid"
      );
    }
    if (loadedReport.telemetryStatus !== "COMPLETE" || !loadedReport.pricingVersion) {
      poisonedReason = `monthly Anthropic telemetry is ${loadedReport.telemetryStatus}; remaining budget cannot be trusted`;
      throw new MonthlyAnthropicBudgetError(poisonedReason, "monthly_budget_telemetry_unavailable");
    }
    localSpentUsd = loadedReport.estimatedCostUsd;
    return loadedReport;
  }

  async function authorizeCall({ role, model, request = null, reserveUsd = null, protectedCapacity = false }) {
    const at = asDate(now());
    const pricingVersion = resolveAnthropicPricingVersion({ env, at });
    resolveAnthropicModelPricing(model, pricingVersion);
    if (cap.status === "INVALID_CONFIG") throw new MonthlyAnthropicBudgetError(cap.error, "monthly_budget_config_invalid");
    if (cap.status === "NOT_CONFIGURED") {
      return { id: null, configured: false, role, model, pricingVersion, reserveUsd: 0, authorizedAt: at.toISOString() };
    }
    if (poisonedReason) throw new MonthlyAnthropicBudgetError(poisonedReason, "monthly_budget_telemetry_unavailable");
    const report = await loadConfiguredReport();
    let requestBound;
    try {
      requestBound = estimateAnthropicRequestUpperBound({ model, pricingVersion, request });
    } catch (error) {
      throw new MonthlyAnthropicBudgetError(error.message, "anthropic_request_unbounded");
    }
    const maxRequestBytes = Math.floor(positive(env.ANTHROPIC_MAX_REQUEST_BYTES, DEFAULT_MAX_REQUEST_BYTES));
    if (requestBound.requestBytes > maxRequestBytes) {
      throw new MonthlyAnthropicBudgetError(
        `Anthropic request is ${requestBound.requestBytes} bytes, above ANTHROPIC_MAX_REQUEST_BYTES=${maxRequestBytes}`,
        "anthropic_request_unbounded"
      );
    }
    const reservation = Math.max(positive(reserveUsd, roleReserveUsd(role, env)), requestBound.upperBoundUsd);
    const id = randomUUID();
    const expiresAt = at.getTime() + leaseSeconds * 1000;
    let result;
    try {
      result = await redis.eval(AUTHORIZE_SCRIPT, budgetKeys(at), [
        String(at.getTime()), id, String(expiresAt), String(toMicroUsd(reservation)),
        String(toMicroUsd(report.estimatedCostUsd)), String(capMicroUsd(cap.ceilingUsd)),
        String(toMicroUsd(cap.protectedReserveUsd)), protectedCapacity ? "1" : "0", String(role),
        ANTHROPIC_BUDGET_READINESS_VERSION, at.toISOString(), String(STATUS_TTL_SECONDS), String(leaseSeconds),
      ]);
    } catch (error) {
      poisonedReason = `monthly Anthropic atomic authorization failed: ${error.message}`;
      throw new MonthlyAnthropicBudgetError(poisonedReason, "monthly_budget_telemetry_unavailable");
    }
    const [decision, spentMicro, reservedMicro, detail] = result ?? [];
    if (decision === "POISONED") {
      poisonedReason = String(detail || "Redis budget state is poisoned");
      throw new MonthlyAnthropicBudgetError(poisonedReason, "monthly_budget_telemetry_unavailable");
    }
    if (decision !== "AUTHORIZED") {
      const reason = String(detail || "monthly_budget_exhausted");
      throw new MonthlyAnthropicBudgetError(
        reason === "protected_capacity_reserved"
          ? `monthly Anthropic discovery capacity is reserved for holding reviews and evaluators; protected pool $${cap.protectedReserveUsd.toFixed(4)}.`
          : `monthly Anthropic budget exhausted before ${role}: spent/reserved $${fromMicroUsd(Number(spentMicro) + Number(reservedMicro)).toFixed(4)} of $${cap.ceilingUsd.toFixed(4)}; next call reserves $${reservation.toFixed(4)}.`,
        "monthly_budget_exhausted"
      );
    }
    const authorization = {
      id, configured: true, role, model, pricingVersion, reserveUsd: reservation,
      protectedCapacity: Boolean(protectedCapacity),
      requestBytes: requestBound.requestBytes,
      requestUpperBoundUsd: requestBound.upperBoundUsd,
      authorizedAt: at.toISOString(),
      expiresAt: new Date(Number(detail)).toISOString(),
    };
    reservations.set(id, authorization);
    localOutstandingUsd = money(localOutstandingUsd + reservation);
    localSpentUsd = fromMicroUsd(spentMicro);
    return authorization;
  }

  async function poison(active, reason) {
    poisonedReason = reason;
    const at = asDate(now());
    try {
      await redis.eval(POISON_SCRIPT, [budgetKeys(active.authorizedAt)[0]], [reason, at.toISOString(), ANTHROPIC_BUDGET_READINESS_VERSION, String(STATUS_TTL_SECONDS)]);
    } catch (error) {
      poisonedReason = `${reason}; Redis poison write also failed: ${error.message}`;
    }
  }

  async function atomicSettle(active, kind, actualUsd = 0) {
    const at = asDate(now());
    let result;
    try {
      result = await redis.eval(SETTLE_SCRIPT, budgetKeys(active.authorizedAt), [
        active.id, kind, String(toMicroUsd(actualUsd)), ANTHROPIC_BUDGET_READINESS_VERSION,
        at.toISOString(), String(STATUS_TTL_SECONDS),
      ]);
    } catch (error) {
      poisonedReason = `monthly Anthropic reservation settlement failed: ${error.message}`;
      throw new MonthlyAnthropicBudgetError(poisonedReason, "monthly_budget_telemetry_unavailable");
    }
    if (result?.[0] !== "SETTLED") {
      poisonedReason = "monthly Anthropic reservation lease was missing during settlement";
      throw new MonthlyAnthropicBudgetError(poisonedReason, "monthly_budget_telemetry_unavailable");
    }
    reservations.delete(active.id);
    localOutstandingUsd = money(Math.max(0, localOutstandingUsd - active.reserveUsd));
    localSpentUsd = fromMicroUsd(result[1]);
    return result;
  }

  async function settleCall(authorization, telemetryResult) {
    if (!authorization?.configured) return telemetryResult?.record ?? null;
    const active = reservations.get(authorization.id);
    if (!active) throw new MonthlyAnthropicBudgetError("monthly Anthropic reservation was missing during settlement", "monthly_budget_telemetry_unavailable");
    if (!telemetryResult?.persisted) {
      const reason = `Anthropic usage telemetry write failed after a paid call: ${telemetryResult?.error ?? "unknown error"}`;
      await poison(active, reason);
      throw new MonthlyAnthropicBudgetError(poisonedReason, "monthly_budget_telemetry_unavailable");
    }
    const record = telemetryResult.record;
    if (
      record.role !== active.role ||
      record.pricingVersion !== active.pricingVersion ||
      record.createdAt !== active.authorizedAt ||
      ![record.model, record.requestedModel].includes(active.model)
    ) {
      const reason = "Anthropic usage record did not match its monthly budget authorization";
      await poison(active, reason);
      throw new MonthlyAnthropicBudgetError(poisonedReason, "monthly_budget_telemetry_unavailable");
    }
    await atomicSettle(active, "SUCCESS", record.estimatedCostUsd);
    if (localSpentUsd > cap.ceilingUsd + EPSILON) {
      poisonedReason = `monthly Anthropic ceiling was exceeded after settlement ($${localSpentUsd.toFixed(4)} > $${cap.ceilingUsd.toFixed(4)}); increase call reserves before re-enabling`;
      await poison(active, poisonedReason);
      throw new MonthlyAnthropicBudgetError(poisonedReason, "monthly_budget_overshoot");
    }
    return record;
  }

  async function settleProviderFailure(authorization, error) {
    if (!authorization?.configured) return false;
    const active = reservations.get(authorization.id);
    if (!active) return false;
    const disposition = anthropicProviderFailureDisposition(error);
    await atomicSettle(active, disposition, 0);
    return disposition;
  }

  return {
    capStatus: cap.status,
    ceilingUsd: cap.ceilingUsd,
    protectedReserveUsd: cap.protectedReserveUsd,
    requiresTelemetry: cap.status === "CONFIGURED",
    authorizeCall,
    settleCall,
    settleProviderFailure,
    snapshot() {
      return {
        capStatus: cap.status,
        ceilingUsd: cap.ceilingUsd,
        protectedReserveUsd: cap.protectedReserveUsd,
        spentUsd: localSpentUsd,
        outstandingUsd: localOutstandingUsd,
        poisonedReason,
        loaded: Boolean(loadedReport),
        leaseSeconds,
      };
    },
  };
}

function sortedEntries(group) {
  return Object.entries(group ?? {}).sort(([a], [b]) => a.localeCompare(b));
}

export function formatAnthropicSpendReport(report) {
  const amount = (value) => value == null ? "UNKNOWN" : `$${Number(value).toFixed(4)}`;
  const lines = [
    `Anthropic spend — ${report.monthUtc} UTC`,
    `Cap: ${report.capStatus}${report.ceilingUsd == null ? "" : ` (${amount(report.ceilingUsd)})`}`,
    `Protected holding/evaluator pool: ${amount(report.protectedReserveUsd ?? 0)}`,
    `Telemetry: ${report.telemetryStatus} (${report.records} priced record(s), ${report.legacyRepricedRecords ?? 0} legacy repriced, ${report.retentionDays}-day retention)`,
    `Month-to-date: ${amount(report.estimatedCostUsd)}`,
    `Reserved leases: ${amount(report.reservedUsd)}${report.activeLeases == null ? "" : ` (${report.activeLeases} active)`}`,
    `Remaining: ${report.capStatus === "NOT_CONFIGURED" ? "NOT_CONFIGURED" : amount(report.remainingUsd)}`,
    `Pricing version: ${report.pricingVersion ?? "UNKNOWN"}`,
    "By model:",
    ...sortedEntries(report.byModel).map(([key, value]) => `  ${key}: ${amount(value)}`),
    "By role:",
    ...sortedEntries(report.byRole).map(([key, value]) => `  ${key}: ${amount(value)}`),
    "By pricing version:",
    ...sortedEntries(report.byPricingVersion).map(([key, value]) => `  ${key}: ${amount(value)}`),
  ];
  if (report.issueCount || report.issues?.length) lines.push(`Issues: ${report.issues.map((issue) => issue.reason).join(" | ")}`);
  return lines.join("\n");
}
