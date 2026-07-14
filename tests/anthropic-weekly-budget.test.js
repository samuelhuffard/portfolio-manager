import test from "node:test";
import assert from "node:assert/strict";
import { createAnthropicMonthlyBudget } from "../lib/anthropic-monthly-budget.js";
import { generateLessons } from "../jobs/weekly-review.js";

const NOW = new Date("2026-07-14T12:00:00Z");
const atCap = JSON.stringify({
  schemaVersion: "anthropic-usage-v2",
  pricingVersion: "anthropic-global-standard-2026-07-14",
  estimatedCostUsd: 1,
  costBreakdownUsd: { input: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0, output: 1 },
  inputTokens: 0,
  outputTokens: 40000,
  cacheCreationInputTokens: 0,
  cacheCreation5mInputTokens: 0,
  cacheCreation1hInputTokens: 0,
  cacheReadInputTokens: 0,
  totalInputTokens: 0,
  model: "claude-opus-4-8",
  role: "generator",
  createdAt: "2026-07-14T11:00:00Z",
});

test("weekly review checks the monthly ceiling before its Anthropic call", async () => {
  const hash = {};
  const monthlyBudget = createAnthropicMonthlyBudget({
    env: { ANTHROPIC_MONTHLY_MAX_USD: "1" },
    now: () => NOW,
    redis: {
      async lrange(key) { return key.endsWith("2026-07-14") ? [atCap] : []; },
      async hgetall() { return { ...hash }; },
      async zcard() { return 0; },
      async eval(script) {
        if (script.includes("cleanup-v2")) return [0, 0, "", 0];
        if (script.includes("authorize-v2")) return ["EXHAUSTED", 1_000_000, 0, "monthly_budget_exhausted"];
        throw new Error("unexpected script");
      },
      async expire() { return 1; },
    },
  });
  let calls = 0;
  const anthropicClient = { messages: { async create() { calls += 1; throw new Error("must not be called"); } } };
  const scorecard = {
    agentId: "agent-1",
    weekEnding: "2026-07-14",
    proposalStats: { created: 1, buys: 1, sells: 0, accepted: 0, rejected: 0, expired: 0, pending: 1, fulfilled: 0 },
    weekActivity: { scanned: 1, actionable: 1, dataGateBlocked: 0, evaluatorRejected: 0, scanErrors: 0 },
    evaluatorHealth: { reason: "insufficient sample", consecutiveOutOfBand: false },
    trackRecord: { 30: { matured: 0 }, 90: { matured: 0 }, 180: { matured: 0 } },
    calibration: null,
  };
  await assert.rejects(
    () => generateLessons(scorecard, [], { monthlyBudget, anthropicClient }),
    (error) => error.code === "monthly_budget_exhausted"
  );
  assert.equal(calls, 0);
});
