/**
 * Versioned Anthropic Claude API list pricing for this application's supported
 * production models. Prices are USD per million tokens for first-party,
 * standard-speed, global inference (not Batch, fast mode, or US-only routing).
 *
 * Authoritative source checked 2026-07-14:
 * https://platform.claude.com/docs/en/build-with-claude/prompt-caching#pricing
 *
 * Anthropic has already published Sonnet 5's 2026-09-01 price change, so both
 * versions live here now. Adding a model or pricing modifier requires a new
 * immutable version; unknown models must never be assigned a zero-dollar rate.
 */

export const ANTHROPIC_PRICING_SOURCE = Object.freeze({
  url: "https://platform.claude.com/docs/en/build-with-claude/prompt-caching#pricing",
  checkedAt: "2026-07-14",
  scope: "Claude API standard speed, global inference, non-batch",
});

const MODEL_ALIASES = Object.freeze({
  "claude-haiku-4-5-20251001": "claude-haiku-4-5",
  "claude-opus-4-5-20251101": "claude-opus-4-5",
  "claude-sonnet-4-5-20250929": "claude-sonnet-4-5",
});

function rates(input, output) {
  return Object.freeze({
    input,
    cacheWrite5m: input * 1.25,
    cacheWrite1h: input * 2,
    cacheRead: input * 0.1,
    output,
  });
}

function modelRates({ sonnet5Input, sonnet5Output }) {
  const opus = rates(5, 25);
  const sonnet = rates(3, 15);
  return Object.freeze({
    "claude-fable-5": rates(10, 50),
    "claude-opus-4-8": opus,
    "claude-opus-4-7": opus,
    "claude-opus-4-6": opus,
    "claude-opus-4-5": opus,
    "claude-sonnet-5": rates(sonnet5Input, sonnet5Output),
    "claude-sonnet-4-6": sonnet,
    "claude-sonnet-4-5": sonnet,
    "claude-haiku-4-5": rates(1, 5),
  });
}

export const ANTHROPIC_PRICING_VERSIONS = Object.freeze({
  "anthropic-global-standard-2026-07-14": Object.freeze({
    effectiveFrom: "2026-07-14",
    effectiveThrough: "2026-08-31",
    models: modelRates({ sonnet5Input: 2, sonnet5Output: 10 }),
  }),
  "anthropic-global-standard-2026-09-01": Object.freeze({
    effectiveFrom: "2026-09-01",
    effectiveThrough: null,
    models: modelRates({ sonnet5Input: 3, sonnet5Output: 15 }),
  }),
});

export const DEFAULT_ANTHROPIC_PRICING_VERSION = "anthropic-global-standard-2026-07-14";

export class UnknownAnthropicModelError extends Error {
  constructor(model, pricingVersion) {
    super(`No Anthropic price is configured for model ${String(model)} under ${pricingVersion}; refusing an unpriced API call.`);
    this.name = "UnknownAnthropicModelError";
    this.code = "anthropic_model_unpriced";
  }
}

export class UnknownAnthropicPricingVersionError extends Error {
  constructor(pricingVersion) {
    super(`Unknown Anthropic pricing version: ${String(pricingVersion)}`);
    this.name = "UnknownAnthropicPricingVersionError";
    this.code = "anthropic_pricing_version_unknown";
  }
}

function finiteNonnegative(value, field) {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric) || numeric < 0) throw new TypeError(`${field} must be a finite non-negative number`);
  return numeric;
}

function isoDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError("pricing date must be valid");
  return date.toISOString().slice(0, 10);
}

export function pricingVersionForDate(value = new Date()) {
  const date = isoDate(value);
  if (date >= "2026-09-01") return "anthropic-global-standard-2026-09-01";
  return DEFAULT_ANTHROPIC_PRICING_VERSION;
}

export function resolveAnthropicPricingVersion({ env = process.env, at = new Date() } = {}) {
  const override = String(env.ANTHROPIC_PRICING_VERSION ?? "").trim();
  const version = override || pricingVersionForDate(at);
  if (!ANTHROPIC_PRICING_VERSIONS[version]) throw new UnknownAnthropicPricingVersionError(version);
  return version;
}

export function resolveAnthropicModelPricing(model, pricingVersion) {
  const version = ANTHROPIC_PRICING_VERSIONS[pricingVersion];
  if (!version) throw new UnknownAnthropicPricingVersionError(pricingVersion);
  const requested = String(model ?? "").trim();
  const canonicalModel = MODEL_ALIASES[requested] ?? requested;
  const modelPricing = version.models[canonicalModel];
  if (!modelPricing) throw new UnknownAnthropicModelError(requested || "(blank)", pricingVersion);
  return { canonicalModel, pricingVersion, rates: modelPricing };
}

export function estimateAnthropicUsageCost({ model, pricingVersion, usage }) {
  const { canonicalModel, rates: modelRatesForVersion } = resolveAnthropicModelPricing(model, pricingVersion);
  const inputTokens = finiteNonnegative(usage?.inputTokens, "usage.inputTokens");
  const outputTokens = finiteNonnegative(usage?.outputTokens, "usage.outputTokens");
  const cacheCreation5mInputTokens = finiteNonnegative(usage?.cacheCreation5mInputTokens, "usage.cacheCreation5mInputTokens");
  const cacheCreation1hInputTokens = finiteNonnegative(usage?.cacheCreation1hInputTokens, "usage.cacheCreation1hInputTokens");
  const cacheReadInputTokens = finiteNonnegative(usage?.cacheReadInputTokens, "usage.cacheReadInputTokens");
  const perMillion = 1_000_000;
  const breakdown = {
    input: (inputTokens * modelRatesForVersion.input) / perMillion,
    cacheWrite5m: (cacheCreation5mInputTokens * modelRatesForVersion.cacheWrite5m) / perMillion,
    cacheWrite1h: (cacheCreation1hInputTokens * modelRatesForVersion.cacheWrite1h) / perMillion,
    cacheRead: (cacheReadInputTokens * modelRatesForVersion.cacheRead) / perMillion,
    output: (outputTokens * modelRatesForVersion.output) / perMillion,
  };
  const estimatedCostUsd = Object.values(breakdown).reduce((sum, value) => sum + value, 0);
  return {
    canonicalModel,
    pricingVersion,
    estimatedCostUsd: Number(estimatedCostUsd.toFixed(12)),
    costBreakdownUsd: Object.fromEntries(Object.entries(breakdown).map(([key, value]) => [key, Number(value.toFixed(12))])),
  };
}

export const ANTHROPIC_REQUEST_TOKEN_OVERHEAD = 8_192;

/**
 * Conservative pre-call bound for this request. A tokenizer cannot emit more
 * content tokens than the UTF-8 bytes carrying the serialized request; the
 * fixed overhead covers API/message framing not present in user text. Every
 * possible input token is charged at the table's most expensive input/cache
 * class and every allowed output token at the output rate.
 */
export function estimateAnthropicRequestUpperBound({ model, pricingVersion, request }) {
  if (!request || typeof request !== "object" || Array.isArray(request)) throw new TypeError("Anthropic request must be a bounded object");
  if (String(request.model ?? "").trim() !== String(model ?? "").trim()) throw new TypeError("Anthropic request model must match its budget authorization");
  const maxTokens = Number(request.max_tokens);
  if (!Number.isSafeInteger(maxTokens) || maxTokens <= 0) throw new TypeError("Anthropic request max_tokens must be a positive safe integer");
  let serialized;
  try {
    serialized = JSON.stringify(request);
  } catch (error) {
    throw new TypeError(`Anthropic request cannot be bounded: ${error.message}`);
  }
  if (typeof serialized !== "string") throw new TypeError("Anthropic request cannot be serialized for a cost bound");
  const requestBytes = Buffer.byteLength(serialized, "utf8");
  const { rates } = resolveAnthropicModelPricing(model, pricingVersion);
  const inputTokenUpperBound = requestBytes + ANTHROPIC_REQUEST_TOKEN_OVERHEAD;
  const worstInputRate = Math.max(rates.input, rates.cacheWrite5m, rates.cacheWrite1h, rates.cacheRead);
  const upperBoundUsd = (inputTokenUpperBound * worstInputRate + maxTokens * rates.output) / 1_000_000;
  return {
    requestBytes,
    inputTokenUpperBound,
    outputTokenUpperBound: maxTokens,
    upperBoundUsd: Math.ceil(upperBoundUsd * 1_000_000_000_000) / 1_000_000_000_000,
  };
}
