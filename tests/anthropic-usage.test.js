import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAnthropicUsageRecord, extractUsage } from "../lib/anthropic-usage.js";

test("extractUsage maps Anthropic cache usage fields and computes total input", () => {
  const usage = extractUsage({
    input_tokens: 50,
    output_tokens: 20,
    cache_creation_input_tokens: 1000,
    cache_read_input_tokens: 3000,
  });
  assert.deepEqual(usage, {
    inputTokens: 50,
    outputTokens: 20,
    cacheCreationInputTokens: 1000,
    cacheReadInputTokens: 3000,
    totalInputTokens: 4050,
  });
});

test("buildAnthropicUsageRecord stores role metadata and cache hit state", () => {
  const record = buildAnthropicUsageRecord({
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

  assert.equal(record.role, "generator");
  assert.equal(record.agentId, "agent-1");
  assert.equal(record.ticker, "NVDA");
  assert.equal(record.cacheHit, true);
  assert.equal(record.totalInputTokens, 1275);
  assert.equal(record.createdAt, "2026-07-06T15:00:00.000Z");
});

test("buildAnthropicUsageRecord requires role and model", () => {
  assert.throws(() => buildAnthropicUsageRecord({ model: "claude-sonnet-4-6" }), /role is required/);
  assert.throws(() => buildAnthropicUsageRecord({ role: "generator" }), /model is required/);
});
