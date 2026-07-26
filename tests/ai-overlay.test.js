import { test } from "node:test";
import assert from "node:assert/strict";
import { FRACTIONAL_SHARE_POLICY, getAIRecommendation, parseRecommendation, promptBreakdown, promptNumber } from "../lib/ai-overlay.js";

test("promptNumber never emits NaN or Infinity into prompts", () => {
  assert.equal(promptNumber(72.345), 72.34);
  assert.equal(promptNumber(NaN), "unknown");
  assert.equal(promptNumber(Infinity), "unknown");
  assert.equal(promptNumber(null), "unknown");
});

test("promptBreakdown serializes non-finite metric values as null", () => {
  const breakdown = promptBreakdown({
    revenueGrowth: 82.34,
    profitMargins: NaN,
    freeCashflow: Infinity,
    rsi: null,
  });
  assert.deepEqual(breakdown, {
    revenueGrowth: 82.3,
    profitMargins: null,
    freeCashflow: null,
    rsi: null,
  });
  assert.doesNotMatch(JSON.stringify(breakdown), /NaN|Infinity/);
});

test("research prompt tells agents that fractional shares make dollar-sized BUYs valid", () => {
  assert.match(FRACTIONAL_SHARE_POLICY, /fractional-share market orders/i);
  assert.match(FRACTIONAL_SHARE_POLICY, /not whole-share-based/i);
  assert.match(FRACTIONAL_SHARE_POLICY, /Never use a stock's per-share price/i);
});

test("parseRecommendation preserves normalized risks and kill criteria", () => {
  const recommendation = parseRecommendation(JSON.stringify({
    action: "HOLD",
    thesis: "Wait for a clearer setup.",
    risks: ["Volatility"],
    kill_criteria: ["Fundamentals deteriorate"],
  }), "TEST");
  assert.deepEqual(recommendation.risks, ["Volatility"]);
  assert.deepEqual(recommendation.killCriteria, ["Fundamentals deteriorate"]);
});

test("two bounded format retries recover a malformed model response", async () => {
  let calls = 0;
  const reply = (text) => ({
    stop_reason: "end_turn",
    usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    content: [{ type: "text", text }],
  });
  const anthropicClient = {
    messages: {
      create: async () => {
        calls += 1;
        if (calls < 3) return reply('{"action":"HOLD"');
        return reply(JSON.stringify({ action: "HOLD", target_weight_pct: 0, thesis: "Valid recovery.", risks: [], kill_criteria: [], confidence: 0.5 }));
      },
    },
  };
  const recommendation = await getAIRecommendation({
    ticker: "TEST", name: "Test Company", quantScore: 70, breakdown: {}, news: [], strategyNotes: "",
    isHeld: false, nextEarningsDate: null, analystTrend: null, insiderActivity: null,
    recentFilings: [], marketScanSignals: [], athenaEvidence: [], macro: null, personality: null,
    persistentMemory: null, proposalPolicy: "", researchHistory: null, boundaryToken: null,
    evaluatorCritique: null, previousProposal: null, agentId: "agent-1", anthropicClient,
    recordUsage: async () => ({ persisted: false }),
  });
  assert.equal(calls, 3);
  assert.equal(recommendation.outputInvalid, false);
  assert.equal(recommendation.formatRecoveryAttempts, 2);
});

test("the actual model request carries the fractional-share policy", async () => {
  let request;
  const anthropicClient = {
    messages: {
      create: async (input) => {
        request = input;
        return {
          stop_reason: "end_turn",
          usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
          content: [{ type: "text", text: JSON.stringify({ action: "HOLD", target_weight_pct: 0, thesis: "No action.", risks: [], kill_criteria: [], confidence: 0.5, suspect_evidence: [] }) }],
        };
      },
    },
  };

  await getAIRecommendation({
    ticker: "TEST", name: "Test Company", quantScore: 70, breakdown: {}, news: [], strategyNotes: "",
    isHeld: false, nextEarningsDate: null, analystTrend: null, insiderActivity: null,
    recentFilings: [], marketScanSignals: [], athenaEvidence: [], macro: null, personality: null,
    persistentMemory: null, proposalPolicy: "Available cash: $85.00", researchHistory: null,
    boundaryToken: null, evaluatorCritique: null, previousProposal: null, agentId: "agent-1",
    anthropicClient, recordUsage: async () => ({ persisted: false }),
  });

  assert.match(request.system[0].text, /fractional-share market orders/i);
  assert.match(request.system[0].text, /not whole-share-based/i);
});
