import test from "node:test";
import assert from "node:assert/strict";
import {
  aggregateAnthropicUsageRecords,
  buildAnthropicUsageRecord,
  extractUsage,
  recordAnthropicUsage,
  readAnthropicMonthToDate,
} from "../lib/anthropic-usage.js";
import { formatAnthropicSpendReport } from "../lib/anthropic-monthly-budget.js";

function record(overrides = {}) {
  return buildAnthropicUsageRecord({
    role: "generator",
    agentId: "agent-1",
    ticker: "PRIVATE",
    model: "claude-opus-4-8",
    usage: { input_tokens: 100, output_tokens: 20, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    now: new Date("2026-07-14T12:00:00Z"),
    ...overrides,
  });
}

test("extractUsage maps Anthropic cache usage fields and computes total input", () => {
  const usage = extractUsage({
    input_tokens: 50,
    output_tokens: 20,
    cache_creation_input_tokens: 1000,
    cache_read_input_tokens: 3000,
  }, { cacheWriteTtl: "5m" });
  assert.deepEqual(usage, {
    inputTokens: 50,
    outputTokens: 20,
    cacheCreationInputTokens: 1000,
    cacheCreation5mInputTokens: 1000,
    cacheCreation1hInputTokens: 0,
    cacheReadInputTokens: 3000,
    totalInputTokens: 4050,
  });
});

test("buildAnthropicUsageRecord stores role metadata and cache hit state", () => {
  const value = buildAnthropicUsageRecord({
    role: "generator",
    agentId: "agent-1",
    ticker: "NVDA",
    model: "claude-sonnet-4-6",
    stopReason: "end_turn",
    usage: {
      input_tokens: 75,
      output_tokens: 30,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 1200,
    },
    now: new Date("2026-07-06T15:00:00.000Z"),
  });
  assert.equal(value.role, "generator");
  assert.equal(value.agentId, "agent-1");
  assert.equal(value.ticker, "NVDA");
  assert.equal(value.cacheHit, true);
  assert.equal(value.totalInputTokens, 1275);
  assert.equal(value.createdAt, "2026-07-06T15:00:00.000Z");
});

test("buildAnthropicUsageRecord requires role and model", () => {
  assert.throws(() => buildAnthropicUsageRecord({ model: "claude-sonnet-4-6" }), /role is required/);
  assert.throws(() => buildAnthropicUsageRecord({ role: "generator" }), /model is required/);
});

test("usage records carry cost, pricing version, and cache accounting", () => {
  const value = record();
  assert.equal(value.schemaVersion, "anthropic-usage-v2");
  assert.equal(value.pricingVersion, "anthropic-global-standard-2026-07-14");
  assert.equal(value.estimatedCostUsd, 0.001);
  assert.deepEqual(value.costBreakdownUsd, {
    input: 0.0005,
    cacheWrite5m: 0,
    cacheWrite1h: 0,
    cacheRead: 0,
    output: 0.0005,
  });
});

test("aggregation separates pricing versions, models, and roles", () => {
  const first = record();
  const second = record({
    role: "weekly_review",
    model: "claude-sonnet-5",
    pricingVersion: "anthropic-global-standard-2026-09-01",
  });
  const result = aggregateAnthropicUsageRecords([first, second], { monthUtc: "2026-07" });
  assert.equal(result.telemetryStatus, "COMPLETE");
  assert.deepEqual(Object.keys(result.byPricingVersion).sort(), [
    "anthropic-global-standard-2026-07-14",
    "anthropic-global-standard-2026-09-01",
  ]);
  assert.equal(result.records, 2);
});

test("v2 aggregation recomputes costs and rejects tampered totals or breakdowns", () => {
  const original = record();
  const badTotal = { ...original, estimatedCostUsd: original.estimatedCostUsd + 0.01 };
  const badBreakdown = { ...original, costBreakdownUsd: { ...original.costBreakdownUsd, output: 999 } };
  const result = aggregateAnthropicUsageRecords([badTotal, badBreakdown], { monthUtc: "2026-07" });
  assert.equal(result.telemetryStatus, "INCOMPLETE");
  assert.equal(result.records, 0);
  assert.equal(result.issueCount, 2);
  assert.match(result.issues[0].reason, /does_not_match_recomputed_cost/);
  assert.match(result.issues[1].reason, /does_not_match_recomputed_cost/);
});

test("usage persistence is one atomic Redis operation", async () => {
  const calls = [];
  const redis = {
    async eval(script, keys, args) {
      calls.push({ script, keys, args });
      return 1;
    },
  };
  const result = await recordAnthropicUsage({
    role: "generator",
    model: "claude-opus-4-8",
    usage: { input_tokens: 10, output_tokens: 2 },
    now: new Date("2026-07-14T12:00:00Z"),
  }, { redis });
  assert.equal(result.persisted, true);
  assert.equal(calls.length, 1);
  assert.match(calls[0].script, /lpush[\s\S]*ltrim[\s\S]*expire/i);
  assert.deepEqual(calls[0].keys, ["pm:anthropic-usage:2026-07-14"]);
});

test("legacy or malformed telemetry is explicit and never counted as complete", () => {
  const result = aggregateAnthropicUsageRecords([{ createdAt: "2026-07-14T00:00:00Z", model: "claude-opus-4-8" }], { monthUtc: "2026-07" });
  assert.equal(result.telemetryStatus, "INCOMPLETE");
  assert.equal(result.records, 0);
  assert.equal(result.issueCount, 1);
});

test("pre-v2 token rows are conservatively repriced with one-hour cache writes", () => {
  const result = aggregateAnthropicUsageRecords([{
    createdAt: "2026-07-10T00:00:00Z",
    model: "claude-opus-4-8",
    role: "generator",
    inputTokens: 100,
    outputTokens: 20,
    cacheCreationInputTokens: 1000,
    cacheReadInputTokens: 3000,
  }], { monthUtc: "2026-07" });
  assert.equal(result.telemetryStatus, "COMPLETE");
  assert.equal(result.legacyRepricedRecords, 1);
  assert.equal(result.estimatedCostUsd, 0.0125);
  assert.equal(result.byPricingVersion["anthropic-global-standard-2026-07-14:legacy-conservative-1h-cache"], 0.0125);
});

test("Redis read errors make monthly telemetry unreadable", async () => {
  const redis = { async lrange() { throw new Error("network down"); } };
  const report = await readAnthropicMonthToDate({ now: new Date("2026-07-14T12:00:00Z"), redis });
  assert.equal(report.telemetryStatus, "UNREADABLE");
  assert.equal(report.estimatedCostUsd, 0);
  assert.ok(report.issueCount >= 1);
});

test("spend report omits tickers, private rationale, prompts, and raw records", () => {
  const output = formatAnthropicSpendReport({
    monthUtc: "2026-07",
    capStatus: "CONFIGURED",
    ceilingUsd: 10,
    remainingUsd: 9,
    telemetryStatus: "COMPLETE",
    records: 1,
    retentionDays: 45,
    estimatedCostUsd: 1,
    pricingVersion: "v1",
    byModel: { "claude-opus-4-8": 1 },
    byRole: { generator: 1 },
    byPricingVersion: { v1: 1 },
    issueCount: 0,
    issues: [],
    ticker: "PRIVATE",
    rationale: "do not expose this",
  });
  assert.doesNotMatch(output, /PRIVATE|do not expose|rationale|prompt/i);
  assert.match(output, /claude-opus-4-8/);
});
