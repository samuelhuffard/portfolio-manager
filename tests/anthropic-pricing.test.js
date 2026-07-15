import test from "node:test";
import assert from "node:assert/strict";
import {
  estimateAnthropicUsageCost,
  estimateAnthropicRequestUpperBound,
  pricingVersionForDate,
  resolveAnthropicModelPricing,
  UnknownAnthropicModelError,
} from "../lib/anthropic-pricing.js";
import { extractUsage } from "../lib/anthropic-usage.js";

const JULY_PRICING = "anthropic-global-standard-2026-07-14";

test("prices base, output, five-minute, one-hour, and cache-read token classes", () => {
  const cost = estimateAnthropicUsageCost({
    model: "claude-sonnet-4-6",
    pricingVersion: JULY_PRICING,
    usage: {
      inputTokens: 1_000,
      outputTokens: 200,
      cacheCreation5mInputTokens: 4_000,
      cacheCreation1hInputTokens: 500,
      cacheReadInputTokens: 10_000,
    },
  });
  assert.equal(cost.estimatedCostUsd, 0.027);
  assert.deepEqual(cost.costBreakdownUsd, {
    input: 0.003,
    cacheWrite5m: 0.015,
    cacheWrite1h: 0.003,
    cacheRead: 0.003,
    output: 0.003,
  });
});

test("extractUsage preserves Anthropic's detailed cache classes", () => {
  assert.deepEqual(extractUsage({
    input_tokens: 20,
    output_tokens: 5,
    cache_creation_input_tokens: 15,
    cache_read_input_tokens: 30,
    cache_creation: { ephemeral_5m_input_tokens: 10, ephemeral_1h_input_tokens: 5 },
  }), {
    inputTokens: 20,
    outputTokens: 5,
    cacheCreationInputTokens: 15,
    cacheCreation5mInputTokens: 10,
    cacheCreation1hInputTokens: 5,
    cacheReadInputTokens: 30,
    totalInputTokens: 65,
    usageComplete: true,
  });
});

test("aggregate cache writes require a declared TTL when details are absent", () => {
  assert.throws(() => extractUsage({ cache_creation_input_tokens: 10 }), /explicit cacheWriteTtl/);
  assert.equal(extractUsage({ cache_creation_input_tokens: 10 }, { cacheWriteTtl: "5m" }).cacheCreation5mInputTokens, 10);
});

test("model aliases normalize and unknown models fail instead of pricing at zero", () => {
  assert.equal(resolveAnthropicModelPricing("claude-haiku-4-5-20251001", JULY_PRICING).canonicalModel, "claude-haiku-4-5");
  assert.throws(() => resolveAnthropicModelPricing("claude-free-mystery", JULY_PRICING), UnknownAnthropicModelError);
});

test("published Sonnet 5 price change is a separate deterministic version", () => {
  assert.equal(pricingVersionForDate("2026-08-31T23:59:59Z"), JULY_PRICING);
  assert.equal(pricingVersionForDate("2026-09-01T00:00:00Z"), "anthropic-global-standard-2026-09-01");
  const july = estimateAnthropicUsageCost({ model: "claude-sonnet-5", pricingVersion: JULY_PRICING, usage: { inputTokens: 1_000_000 } });
  const september = estimateAnthropicUsageCost({ model: "claude-sonnet-5", pricingVersion: "anthropic-global-standard-2026-09-01", usage: { inputTokens: 1_000_000 } });
  assert.equal(july.estimatedCostUsd, 2);
  assert.equal(september.estimatedCostUsd, 3);
});

test("request upper bound covers worst input/cache pricing and max output", () => {
  const request = { model: "claude-opus-4-8", max_tokens: 700, messages: [{ role: "user", content: "hello" }] };
  const bound = estimateAnthropicRequestUpperBound({ model: request.model, pricingVersion: JULY_PRICING, request });
  const worstActual = estimateAnthropicUsageCost({
    model: request.model,
    pricingVersion: JULY_PRICING,
    usage: {
      cacheCreation1hInputTokens: bound.inputTokenUpperBound,
      outputTokens: bound.outputTokenUpperBound,
    },
  });
  assert.equal(bound.upperBoundUsd, worstActual.estimatedCostUsd);
  assert.throws(
    () => estimateAnthropicRequestUpperBound({ model: request.model, pricingVersion: JULY_PRICING, request: { model: request.model, messages: [] } }),
    /max_tokens/
  );
});
