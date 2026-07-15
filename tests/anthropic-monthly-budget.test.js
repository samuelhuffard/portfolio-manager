import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createResearchRunBudget } from "../lib/ai-budget.js";
import { anthropicBudgetStatusKey, createAnthropicMonthlyBudget, getAnthropicBudgetReadiness, getAnthropicSpendReport } from "../lib/anthropic-monthly-budget.js";
import { buildAnthropicUsageRecord } from "../lib/anthropic-usage.js";
import { getAIRecommendation } from "../lib/ai-overlay.js";
import { evaluateProposal } from "../lib/evaluator.js";

const NOW = new Date("2026-07-14T12:00:00Z");

function boundedRequest(model = "claude-opus-4-8", maxTokens = 1) {
  return { model, max_tokens: maxTokens, messages: [{ role: "user", content: "test" }] };
}

function storedCost(cost, overrides = {}) {
  return JSON.stringify({
    schemaVersion: "anthropic-usage-v2",
    pricingVersion: "anthropic-global-standard-2026-07-14",
    estimatedCostUsd: cost,
    costBreakdownUsd: { input: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0, output: cost },
    inputTokens: 0,
    outputTokens: cost * 40_000,
    cacheCreationInputTokens: 0,
    cacheCreation5mInputTokens: 0,
    cacheCreation1hInputTokens: 0,
    cacheReadInputTokens: 0,
    totalInputTokens: 0,
    model: "claude-opus-4-8",
    role: "generator",
    createdAt: "2026-07-14T11:00:00Z",
    ...overrides,
  });
}

function redisWith(records = []) {
  const hashes = new Map();
  const zsets = new Map();
  let evalCalls = 0;
  const hashFor = (key) => {
    if (!hashes.has(key)) hashes.set(key, {});
    return hashes.get(key);
  };
  const zsetFor = (key) => {
    if (!zsets.has(key)) zsets.set(key, new Map());
    return zsets.get(key);
  };
  const cleanup = (keys, nowMs) => {
    const state = hashFor(keys[0]);
    const leases = zsetFor(keys[1]);
    const data = hashFor(keys[2]);
    let recovered = 0;
    for (const [id, expiresAt] of [...leases]) {
      if (expiresAt > nowMs) continue;
      const amount = Number(data[id] ?? 0);
      state.reservedMicrousd = Math.max(0, Number(state.reservedMicrousd ?? 0) - amount);
      state.spentMicrousd = Number(state.spentMicrousd ?? 0) + amount;
      delete data[id];
      leases.delete(id);
      recovered += 1;
    }
    if (recovered) state.expiredLeasesRecovered = Number(state.expiredLeasesRecovered ?? 0) + recovered;
    state.reservedUsd = Number(state.reservedMicrousd ?? 0) / 1_000_000;
    return recovered;
  };
  return {
    async lrange(key) { return key.endsWith("2026-07-14") ? records : []; },
    async hgetall(key) { return { ...hashFor(key) }; },
    async hset(key, values) { Object.assign(hashFor(key), values); return 1; },
    async zcard(key) { return zsetFor(key).size; },
    async eval(script, keys, args) {
      evalCalls += 1;
      const state = hashFor(keys[0]);
      if (script.includes("cleanup-v2")) {
        const recovered = cleanup(keys, Number(args[0]));
        return [Number(state.spentMicrousd ?? 0), Number(state.reservedMicrousd ?? 0), state.poisonedReason ?? "", recovered];
      }
      if (script.includes("authorize-v2")) {
        cleanup(keys, Number(args[0]));
        if (state.poisonedReason) return ["POISONED", 0, Number(state.reservedMicrousd ?? 0), state.poisonedReason];
        const observed = Number(args[4]);
        const spent = Math.max(Number(state.spentMicrousd ?? 0), observed);
        const reserve = Number(args[3]);
        const cap = Number(args[5]);
        const protectedReserve = Number(args[6]);
        const isProtected = args[7] === "1";
        const reserved = Number(state.reservedMicrousd ?? 0);
        const limit = isProtected ? cap : Math.max(0, cap - protectedReserve);
        const projected = spent + reserved + reserve;
        if (projected > limit) {
          const reason = !isProtected && projected <= cap && protectedReserve > 0 ? "protected_capacity_reserved" : "monthly_budget_exhausted";
          state.deniedTotal = Number(state.deniedTotal ?? 0) + 1;
          if (reason === "protected_capacity_reserved") state.deniedDiscoveryProtectedPool = Number(state.deniedDiscoveryProtectedPool ?? 0) + 1;
          if (args[8] === "evaluator") state.deniedEvaluator = Number(state.deniedEvaluator ?? 0) + 1;
          else if (args[8] === "weekly_review") state.deniedWeeklyReview = Number(state.deniedWeeklyReview ?? 0) + 1;
          else if (isProtected) state.deniedProtectedHolding = Number(state.deniedProtectedHolding ?? 0) + 1;
          else state.deniedOther = Number(state.deniedOther ?? 0) + 1;
          Object.assign(state, { spentMicrousd: spent, reservedMicrousd: reserved, lastDeniedReason: reason, lastDeniedRole: args[8], lastDeniedAt: args[10] });
          return [reason === "protected_capacity_reserved" ? "PROTECTED_POOL" : "EXHAUSTED", spent, reserved, reason];
        }
        hashFor(keys[2])[args[1]] = reserve;
        zsetFor(keys[1]).set(args[1], Number(args[2]));
        Object.assign(state, { spentMicrousd: spent, reservedMicrousd: reserved + reserve, reservedUsd: (reserved + reserve) / 1_000_000, protectedReserveMicrousd: protectedReserve });
        return ["AUTHORIZED", spent, reserved + reserve, args[2]];
      }
      if (script.includes("settle-v2")) {
        const data = hashFor(keys[2]);
        const amount = data[args[0]];
        if (amount == null) return ["MISSING", 0, 0];
        delete data[args[0]];
        zsetFor(keys[1]).delete(args[0]);
        state.reservedMicrousd = Math.max(0, Number(state.reservedMicrousd ?? 0) - Number(amount));
        if (args[1] === "SUCCESS") state.spentMicrousd = Number(state.spentMicrousd ?? 0) + Number(args[2]);
        else if (args[1] === "AMBIGUOUS_FAILURE") {
          state.spentMicrousd = Number(state.spentMicrousd ?? 0) + Number(amount);
          state.ambiguousFailureSettlements = Number(state.ambiguousFailureSettlements ?? 0) + 1;
        } else state.providerFailureSettlements = Number(state.providerFailureSettlements ?? 0) + 1;
        state.reservedUsd = state.reservedMicrousd / 1_000_000;
        return ["SETTLED", Number(state.spentMicrousd ?? 0), state.reservedMicrousd];
      }
      if (script.includes("poison-v2")) {
        state.poisonedReason = args[0];
        return 1;
      }
      throw new Error("unexpected script");
    },
    async expire() { return 1; },
    _hashes: hashes,
    evalCalls() { return evalCalls; },
  };
}

test("blank ceiling is NOT_CONFIGURED and preserves known-model call authorization", async () => {
  const monthly = createAnthropicMonthlyBudget({ env: {}, now: () => NOW, redis: null });
  const auth = await monthly.authorizeCall({ role: "generator", model: "claude-opus-4-8" });
  assert.equal(auth.configured, false);
  assert.equal(monthly.snapshot().loaded, false);
  const report = await getAnthropicSpendReport({ env: {}, now: NOW, redis: redisWith([]) });
  assert.equal(report.capStatus, "NOT_CONFIGURED");
  assert.equal(report.remainingUsd, null);
  const readiness = await getAnthropicBudgetReadiness({ env: {}, now: NOW, redis: redisWith([]) });
  assert.equal(readiness.status, "NOT_CONFIGURED");
});

test("the privacy-safe spend report is read-only", async () => {
  const redis = redisWith([storedCost(0.1)]);
  const report = await getAnthropicSpendReport({ env: {}, now: NOW, redis });
  assert.equal(report.estimatedCostUsd, 0.1);
  assert.equal(redis.evalCalls(), 0);
});

test("unknown models are blocked before a paid call even without a ceiling", async () => {
  const monthly = createAnthropicMonthlyBudget({ env: {}, now: () => NOW, redis: null });
  await assert.rejects(
    () => monthly.authorizeCall({ role: "generator", model: "claude-unknown" }),
    (error) => error.code === "anthropic_model_unpriced"
  );
});

test("a newly configured ceiling includes conservatively repriced pre-v2 July use", async () => {
  const legacy = JSON.stringify({
    createdAt: "2026-07-14T00:00:00Z",
    model: "claude-opus-4-8",
    role: "generator",
    inputTokens: 100,
    outputTokens: 20,
    cacheCreationInputTokens: 1000,
    cacheReadInputTokens: 3000,
  });
  const monthly = createAnthropicMonthlyBudget({
    env: { ANTHROPIC_MONTHLY_MAX_USD: "0.02" },
    now: () => NOW,
    redis: redisWith([legacy]),
  });
  await assert.rejects(
    () => monthly.authorizeCall({ role: "generator", model: "claude-opus-4-8", request: boundedRequest(), reserveUsd: 0.01 }),
    (error) => error.code === "monthly_budget_exhausted"
  );
  assert.equal(monthly.snapshot().spentUsd, 0.0125);
});

test("configured ceiling permits an exact boundary and blocks the next reservation", async () => {
  const monthly = createAnthropicMonthlyBudget({
    env: { ANTHROPIC_MONTHLY_MAX_USD: "1" },
    now: () => NOW,
    redis: redisWith([storedCost(0.9)]),
  });
  const auth = await monthly.authorizeCall({ role: "evaluator", model: "claude-opus-4-8", request: boundedRequest(), reserveUsd: 0.1 });
  assert.equal(auth.configured, true);
  await assert.rejects(
    () => monthly.authorizeCall({ role: "generator", model: "claude-opus-4-8", request: boundedRequest(), reserveUsd: 0.0001 }),
    (error) => error.code === "monthly_budget_exhausted"
  );
});

test("configured ceilings reject unbounded requests and reserve a conservative request maximum", async () => {
  const monthly = createAnthropicMonthlyBudget({ env: { ANTHROPIC_MONTHLY_MAX_USD: "10" }, now: () => NOW, redis: redisWith([]) });
  await assert.rejects(
    () => monthly.authorizeCall({ role: "generator", model: "claude-opus-4-8", reserveUsd: 0.001 }),
    (error) => error.code === "anthropic_request_unbounded"
  );
  const request = boundedRequest("claude-opus-4-8", 700);
  const auth = await monthly.authorizeCall({ role: "generator", model: request.model, request, reserveUsd: 0.001 });
  assert.ok(auth.requestUpperBoundUsd > 0.09);
  assert.equal(auth.reserveUsd, auth.requestUpperBoundUsd);
});

test("authorization time binds pricing and usage across a pricing boundary", async () => {
  let current = new Date("2026-08-31T23:59:59.900Z");
  const redis = redisWith([]);
  const monthly = createAnthropicMonthlyBudget({ env: { ANTHROPIC_MONTHLY_MAX_USD: "10" }, now: () => current, redis });
  const request = boundedRequest("claude-sonnet-5", 10);
  const auth = await monthly.authorizeCall({ role: "generator", model: request.model, request });
  assert.equal(auth.pricingVersion, "anthropic-global-standard-2026-07-14");
  current = new Date("2026-09-01T00:00:01Z");
  const record = buildAnthropicUsageRecord({
    role: "generator",
    model: request.model,
    usage: { input_tokens: 10, output_tokens: 2 },
    pricingVersion: auth.pricingVersion,
    now: new Date(auth.authorizedAt),
  });
  await monthly.settleCall(auth, { persisted: true, record });
  assert.equal(monthly.snapshot().poisonedReason, null);
});

test("privacy-safe readiness exposes spent, reserved, remaining, and protected denials", async () => {
  const redis = redisWith([storedCost(0.9)]);
  await redis.hset(anthropicBudgetStatusKey(NOW), {
    reservedMicrousd: 100000,
    deniedEvaluator: 1,
    deniedTotal: 1,
    lastDeniedReason: "monthly_budget_exhausted",
    lastDeniedProtectedAt: "2026-07-14T20:00:00.000Z",
  });
  const readiness = await getAnthropicBudgetReadiness({
    env: { ANTHROPIC_MONTHLY_MAX_USD: "1", ANTHROPIC_MONTHLY_WARN_PCT: "0.8" },
    now: NOW,
    redis,
  });
  assert.equal(readiness.schemaVersion, "anthropic-budget-readiness-v2");
  assert.equal(readiness.status, "EXHAUSTED");
  assert.equal(readiness.spentUsd, 0.9);
  assert.equal(readiness.reservedUsd, 0.1);
  assert.equal(readiness.remainingUsd, 0);
  assert.equal(readiness.protectedCapacityDenied, true);
  assert.equal(readiness.protectedCapacityLastDeniedAt, "2026-07-14T20:00:00.000Z");
  assert.equal(readiness.denials.evaluator, 1);
  assert.equal("ticker" in readiness, false);
});

test("unreadable telemetry fails closed before any configured-ceiling call", async () => {
  const monthly = createAnthropicMonthlyBudget({
    env: { ANTHROPIC_MONTHLY_MAX_USD: "10" },
    now: () => NOW,
    redis: { async lrange() { throw new Error("Redis unavailable"); } },
  });
  await assert.rejects(
    () => monthly.authorizeCall({ role: "generator", model: "claude-opus-4-8", request: boundedRequest() }),
    (error) => error.code === "monthly_budget_telemetry_unavailable"
  );
});

test("a failed usage write poisons an enabled ceiling instead of releasing capacity", async () => {
  const monthly = createAnthropicMonthlyBudget({
    env: { ANTHROPIC_MONTHLY_MAX_USD: "10" },
    now: () => NOW,
    redis: redisWith([]),
  });
  const auth = await monthly.authorizeCall({ role: "generator", model: "claude-opus-4-8", request: boundedRequest() });
  await assert.rejects(
    () => monthly.settleCall(auth, { persisted: false, error: "write failed", record: null }),
    (error) => error.code === "monthly_budget_telemetry_unavailable"
  );
  assert.match(monthly.snapshot().poisonedReason, /write failed/);
});

test("successful telemetry settlement releases the reservation and adds actual spend", async () => {
  const redis = redisWith([]);
  const monthly = createAnthropicMonthlyBudget({
    env: { ANTHROPIC_MONTHLY_MAX_USD: "10" },
    now: () => NOW,
    redis,
  });
  const auth = await monthly.authorizeCall({ role: "generator", model: "claude-opus-4-8", request: boundedRequest(), reserveUsd: 0.1 });
  await monthly.settleCall(auth, {
    persisted: true,
    error: null,
    record: {
      role: "generator",
      model: "claude-opus-4-8",
      requestedModel: "claude-opus-4-8",
      pricingVersion: "anthropic-global-standard-2026-07-14",
      estimatedCostUsd: 0.02,
      createdAt: auth.authorizedAt,
    },
  });
  assert.equal(monthly.snapshot().outstandingUsd, 0);
  assert.equal(monthly.snapshot().spentUsd, 0.02);
  assert.equal(Number((await redis.hgetall(anthropicBudgetStatusKey(NOW))).reservedUsd), 0);
});

test("two processes contend atomically and cannot over-authorize the ceiling", async () => {
  const redis = redisWith([storedCost(0.9)]);
  const options = { env: { ANTHROPIC_MONTHLY_MAX_USD: "1" }, now: () => NOW, redis };
  const first = createAnthropicMonthlyBudget(options);
  const second = createAnthropicMonthlyBudget(options);
  const results = await Promise.allSettled([
    first.authorizeCall({ role: "generator", model: "claude-opus-4-8", request: boundedRequest(), reserveUsd: 0.1 }),
    second.authorizeCall({ role: "generator", model: "claude-opus-4-8", request: boundedRequest(), reserveUsd: 0.1 }),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected" && result.reason.code === "monthly_budget_exhausted").length, 1);
});

test("expired leases recover capacity after a process crash", async () => {
  let current = new Date(NOW);
  const redis = redisWith([storedCost(0.9)]);
  const env = { ANTHROPIC_MONTHLY_MAX_USD: "1.1", ANTHROPIC_CALL_LEASE_SECONDS: "60" };
  const crashed = createAnthropicMonthlyBudget({ env, now: () => current, redis });
  await crashed.authorizeCall({ role: "generator", model: "claude-opus-4-8", request: boundedRequest(), reserveUsd: 0.1 });
  current = new Date(NOW.getTime() + 61_000);
  const recovered = createAnthropicMonthlyBudget({ env, now: () => current, redis });
  const auth = await recovered.authorizeCall({ role: "generator", model: "claude-opus-4-8", request: boundedRequest(), reserveUsd: 0.1 });
  assert.equal(auth.configured, true);
  const state = await redis.hgetall(anthropicBudgetStatusKey(NOW));
  assert.equal(Number(state.expiredLeasesRecovered), 1);
  assert.equal(Number(state.spentMicrousd), 1_000_000);
});

test("discovery cannot consume a configured holding and evaluator pool", async () => {
  const redis = redisWith([storedCost(0.6)]);
  const monthly = createAnthropicMonthlyBudget({
    env: { ANTHROPIC_MONTHLY_MAX_USD: "1", ANTHROPIC_MONTHLY_PROTECTED_RESERVE_USD: "0.3" },
    now: () => NOW,
    redis,
  });
  await monthly.authorizeCall({ role: "generator", model: "claude-opus-4-8", request: boundedRequest(), reserveUsd: 0.1, protectedCapacity: false });
  await assert.rejects(
    () => monthly.authorizeCall({ role: "generator", model: "claude-opus-4-8", request: boundedRequest(), reserveUsd: 0.01, protectedCapacity: false }),
    (error) => error.code === "monthly_budget_exhausted" && /reserved for holding reviews/.test(error.message)
  );
  const evaluator = await monthly.authorizeCall({ role: "evaluator", model: "claude-opus-4-8", request: boundedRequest(), reserveUsd: 0.3, protectedCapacity: true });
  assert.equal(evaluator.configured, true);
});

test("ambiguous connection failures conservatively charge the full reservation", async () => {
  const redis = redisWith([]);
  const monthly = createAnthropicMonthlyBudget({ env: { ANTHROPIC_MONTHLY_MAX_USD: "1" }, now: () => NOW, redis });
  const auth = await monthly.authorizeCall({ role: "generator", model: "claude-opus-4-8", request: boundedRequest(), reserveUsd: 0.1 });
  assert.equal(await monthly.settleProviderFailure(auth, new Error("connection reset")), "AMBIGUOUS_FAILURE");
  assert.equal(monthly.snapshot().outstandingUsd, 0);
  const state = await redis.hgetall(anthropicBudgetStatusKey(NOW));
  assert.equal(Number(state.reservedUsd), 0);
  assert.equal(Number(state.spentMicrousd), 100000);
  assert.equal(Number(state.ambiguousFailureSettlements), 1);
});

test("explicit HTTP provider rejections release their lease as non-billable", async () => {
  const redis = redisWith([]);
  const monthly = createAnthropicMonthlyBudget({ env: { ANTHROPIC_MONTHLY_MAX_USD: "1" }, now: () => NOW, redis });
  const auth = await monthly.authorizeCall({ role: "generator", model: "claude-opus-4-8", request: boundedRequest(), reserveUsd: 0.1 });
  const rejection = Object.assign(new Error("rate limited"), { status: 429 });
  assert.equal(await monthly.settleProviderFailure(auth, rejection), "PROVIDER_REJECTION");
  const state = await redis.hgetall(anthropicBudgetStatusKey(NOW));
  assert.equal(Number(state.spentMicrousd), 0);
  assert.equal(Number(state.providerFailureSettlements), 1);
});

test("generator provider exceptions use the monthly failure settlement path", async () => {
  const redis = redisWith([]);
  const monthly = createAnthropicMonthlyBudget({ env: { ANTHROPIC_MONTHLY_MAX_USD: "1" }, now: () => NOW, redis });
  const budget = createResearchRunBudget({ env: {}, monthlyBudget: monthly });
  const anthropicClient = { messages: { async create() { throw new Error("provider unavailable"); } } };
  await assert.rejects(() => getAIRecommendation({
    ticker: "TEST",
    name: "Test Company",
    quantScore: 50,
    breakdown: {},
    news: [],
    strategyNotes: "",
    isHeld: false,
    recentFilings: [],
    marketScanSignals: [],
    athenaEvidence: [],
    personality: "",
    persistentMemory: "",
    boundaryToken: "BOUNDARY",
    agentId: "agent-1",
    budget,
    anthropicClient,
  }), /provider unavailable/);
  const state = await redis.hgetall(anthropicBudgetStatusKey(NOW));
  assert.equal(Number(state.reservedUsd), 0);
  assert.ok(Number(state.spentMicrousd) > 0);
  assert.equal(Number(state.ambiguousFailureSettlements), 1);
});

test("research generator makes no Anthropic call when monthly ceiling is exhausted", async () => {
  const monthly = createAnthropicMonthlyBudget({
    env: { ANTHROPIC_MONTHLY_MAX_USD: "0.10" },
    now: () => NOW,
    redis: redisWith([storedCost(0.1)]),
  });
  const budget = createResearchRunBudget({ env: {}, monthlyBudget: monthly });
  let calls = 0;
  const anthropicClient = { messages: { async create() { calls += 1; throw new Error("must not be called"); } } };
  await assert.rejects(() => getAIRecommendation({
    ticker: "TEST",
    name: "Test Company",
    quantScore: 50,
    breakdown: {},
    news: [],
    strategyNotes: "",
    isHeld: false,
    recentFilings: [],
    marketScanSignals: [],
    athenaEvidence: [],
    personality: "",
    persistentMemory: "",
    boundaryToken: "BOUNDARY",
    agentId: "agent-1",
    budget,
    anthropicClient,
  }), (error) => error.code === "monthly_budget_exhausted");
  assert.equal(calls, 0);
});

test("research evaluator uses the same monthly guard and makes no exhausted call", async () => {
  const monthly = createAnthropicMonthlyBudget({
    env: { ANTHROPIC_MONTHLY_MAX_USD: "0.10" },
    now: () => NOW,
    redis: redisWith([storedCost(0.1)]),
  });
  const budget = createResearchRunBudget({ env: {}, monthlyBudget: monthly });
  let calls = 0;
  const anthropicClient = { messages: { async create() { calls += 1; throw new Error("must not be called"); } } };
  await assert.rejects(() => evaluateProposal({
    ticker: "TEST",
    name: "Test Company",
    proposal: { action: "BUY", targetWeight: 1, thesis: "test", risks: ["risk"], killCriteria: ["kill"], confidence: 0.5 },
    quantScore: 50,
    breakdown: {},
    rawData: {},
    newsBlock: "",
    mandate: "test",
    boundaryToken: "BOUNDARY",
    agentId: "agent-1",
    budget,
    anthropicClient,
  }), (error) => error.code === "monthly_budget_exhausted");
  assert.equal(calls, 0);
});

test("all Anthropic SDK clients disable automatic retries", () => {
  for (const path of ["../lib/ai-overlay.js", "../lib/evaluator.js", "../jobs/weekly-review.js"]) {
    const source = readFileSync(new URL(path, import.meta.url), "utf8");
    assert.match(source, /new Anthropic\(\{[^}]*maxRetries:\s*0[^}]*\}\)/s, `${path} must set maxRetries: 0`);
  }
});

test("ANTHROPIC_BUDGET_REQUIRED=true refuses unbudgeted calls when the ceiling is missing", async () => {
  const monthly = createAnthropicMonthlyBudget({
    env: { ANTHROPIC_BUDGET_REQUIRED: "true" },
    now: () => NOW,
    redis: redisWith([]),
  });
  await assert.rejects(
    () => monthly.authorizeCall({ role: "generator", model: "claude-opus-4-8", request: boundedRequest() }),
    (error) => error.code === "monthly_budget_config_invalid" && /ANTHROPIC_MONTHLY_MAX_USD is not configured/.test(error.message)
  );
});

test("a success response without usage token counts settles at its full reservation, never $0", async () => {
  const redis = redisWith([]);
  const monthly = createAnthropicMonthlyBudget({
    env: { ANTHROPIC_MONTHLY_MAX_USD: "10" },
    now: () => NOW,
    redis,
  });
  const auth = await monthly.authorizeCall({ role: "generator", model: "claude-opus-4-8", request: boundedRequest(), reserveUsd: 0.25 });
  const record = buildAnthropicUsageRecord({
    role: "generator",
    model: "claude-opus-4-8",
    usage: {},
    pricingVersion: auth.pricingVersion,
    now: new Date(auth.authorizedAt),
  });
  assert.equal(record.usageComplete, false);
  assert.equal(record.estimatedCostUsd, 0);
  await monthly.settleCall(auth, { persisted: true, error: null, record });
  assert.equal(monthly.snapshot().outstandingUsd, 0);
  assert.equal(monthly.snapshot().spentUsd, auth.reserveUsd);
  const state = await redis.hgetall(anthropicBudgetStatusKey(NOW));
  assert.equal(Number(state.ambiguousFailureSettlements), 1);
  assert.equal(monthly.snapshot().poisonedReason, null);
  const report = await getAnthropicSpendReport({ env: { ANTHROPIC_MONTHLY_MAX_USD: "10" }, now: NOW, redis });
  assert.equal(report.estimatedCostUsd, auth.reserveUsd);
  assert.equal(report.remainingUsd, 10 - auth.reserveUsd);
});
