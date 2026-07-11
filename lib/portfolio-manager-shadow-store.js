import {
  AllocationPolicySchema,
  AllocationSnapshotSchema,
  PortfolioDecisionSchema,
  PortfolioReviewRequestSchema,
  PortfolioRiskSnapshotSchema,
  PORTFOLIO_SHADOW_KEYS,
} from "../contracts/portfolio-decision.js";
import { getRedis } from "./redis.js";
import { evaluateShadowPortfolioDecision } from "./portfolio-manager-shadow.js";

const MAX_DECISIONS = 250;

function parseRedisValue(value) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

async function requireRedis() {
  const redis = getRedis();
  if (!redis) throw new Error("Redis is required for Agent 4 shadow state.");
  return redis;
}

async function readParsed(redis, key, schema) {
  const value = parseRedisValue(await redis.get(key));
  if (value == null) return null;
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new Error(`Agent 4 shadow state at ${key} failed validation.`);
  return parsed.data;
}

async function writeImmutable(redis, key, value, schema) {
  const parsed = schema.parse(value);
  await redis.set(key, JSON.stringify(parsed), { nx: true });
  const stored = await readParsed(redis, key, schema);
  if (!stored || stableJson(stored) !== stableJson(parsed)) {
    throw new Error(`Agent 4 immutable state conflict at ${key}.`);
  }
  return stored;
}

/** Activate a reviewed SHADOW policy. This never grants live approval authority. */
export async function activateShadowAllocationPolicy(rawPolicy) {
  const policy = AllocationPolicySchema.parse(rawPolicy);
  const redis = await requireRedis();
  await writeImmutable(redis, `${PORTFOLIO_SHADOW_KEYS.policyPrefix}${policy.version}`, policy, AllocationPolicySchema);
  await redis.set(PORTFOLIO_SHADOW_KEYS.policyActive, JSON.stringify(policy));
  return policy;
}

export async function getActiveShadowAllocationPolicy() {
  const redis = await requireRedis();
  return readParsed(redis, PORTFOLIO_SHADOW_KEYS.policyActive, AllocationPolicySchema);
}

/**
 * Validate, evaluate, and append one immutable shadow review. The active policy
 * must already exist and match byte-semantically; callers cannot smuggle a new
 * policy through a review request. No proposal status/signature is ever touched.
 */
export async function persistPortfolioManagerShadowReview(rawRequest) {
  const request = PortfolioReviewRequestSchema.parse(rawRequest);
  const redis = await requireRedis();
  const activePolicy = await readParsed(redis, PORTFOLIO_SHADOW_KEYS.policyActive, AllocationPolicySchema);
  if (!activePolicy) throw new Error("Agent 4 shadow policy is not activated yet.");
  if (stableJson(activePolicy) !== stableJson(request.policy)) {
    throw new Error("Review policy does not match the active Agent 4 shadow policy.");
  }

  const decision = PortfolioDecisionSchema.parse(evaluateShadowPortfolioDecision(request));
  const decisionKey = `${PORTFOLIO_SHADOW_KEYS.decisionPrefix}${decision.id}`;
  const existingDecision = await readParsed(redis, decisionKey, PortfolioDecisionSchema);

  await writeImmutable(
    redis,
    `${PORTFOLIO_SHADOW_KEYS.allocationPrefix}${request.allocationSnapshot.id}`,
    request.allocationSnapshot,
    AllocationSnapshotSchema
  );
  await writeImmutable(
    redis,
    `${PORTFOLIO_SHADOW_KEYS.riskPrefix}${request.portfolioSnapshot.id}`,
    request.portfolioSnapshot,
    PortfolioRiskSnapshotSchema
  );
  await writeImmutable(redis, decisionKey, decision, PortfolioDecisionSchema);
  await redis.set(PORTFOLIO_SHADOW_KEYS.allocationLatest, JSON.stringify(request.allocationSnapshot));
  await redis.set(PORTFOLIO_SHADOW_KEYS.riskLatest, JSON.stringify(request.portfolioSnapshot));

  if (!existingDecision) {
    await redis.lpush(PORTFOLIO_SHADOW_KEYS.decisionIndex, decision.id);
    await redis.ltrim(PORTFOLIO_SHADOW_KEYS.decisionIndex, 0, MAX_DECISIONS - 1);
  }
  return decision;
}

export async function getPortfolioManagerShadowState(limit = 100) {
  const redis = await requireRedis();
  const [policy, allocationSnapshot, portfolioSnapshot, ids] = await Promise.all([
    readParsed(redis, PORTFOLIO_SHADOW_KEYS.policyActive, AllocationPolicySchema),
    readParsed(redis, PORTFOLIO_SHADOW_KEYS.allocationLatest, AllocationSnapshotSchema),
    readParsed(redis, PORTFOLIO_SHADOW_KEYS.riskLatest, PortfolioRiskSnapshotSchema),
    redis.lrange(PORTFOLIO_SHADOW_KEYS.decisionIndex, 0, Math.max(0, limit - 1)),
  ]);

  const values = await Promise.all(
    ids.map((id) => redis.get(`${PORTFOLIO_SHADOW_KEYS.decisionPrefix}${id}`).catch(() => null))
  );
  const decisions = [];
  for (const value of values) {
    const parsed = PortfolioDecisionSchema.safeParse(parseRedisValue(value));
    if (parsed.success) decisions.push(parsed.data);
    else if (value != null) console.error("[Agent4] Invalid persisted shadow decision skipped.");
  }
  return { mode: "SHADOW", policy, allocationSnapshot, portfolioSnapshot, decisions };
}
