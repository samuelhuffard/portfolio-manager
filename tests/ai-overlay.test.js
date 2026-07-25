import { test } from "node:test";
import assert from "node:assert/strict";
import { FRACTIONAL_SHARE_POLICY, buildProposalEvidence, enforceFractionalShareHoldPolicy, findFractionalShareHoldViolations, getAIRecommendation, parseRecommendation, promptBreakdown, promptNumber, validateActionableEvidence } from "../lib/ai-overlay.js";

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

test("actual research request includes the fractional-share policy without a cash anchor", async () => {
  let request;
  const anthropicClient = { messages: { create: async (input) => {
    request = input;
    return { stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }, content: [{ type: "text", text: JSON.stringify({ action: "HOLD", target_weight_pct: 0, thesis: "No action.", risks: [], kill_criteria: [], confidence: 0.5, suspect_evidence: [] }) }] };
  } } };
  await getAIRecommendation({ ticker: "TEST", name: "Test Company", quantScore: 70, breakdown: {}, news: [], strategyNotes: "", isHeld: false, nextEarningsDate: null, analystTrend: null, insiderActivity: null, recentFilings: [], marketScanSignals: [], athenaEvidence: [], macro: null, personality: null, persistentMemory: null, proposalPolicy: "Capital availability is handled downstream.", researchHistory: null, boundaryToken: null, evaluatorCritique: null, previousProposal: null, agentId: "agent-1", anthropicClient, recordUsage: async () => ({ persisted: false }) });
  assert.match(FRACTIONAL_SHARE_POLICY, /fractional-share market orders/i);
  assert.match(request.system[0].text, /not whole-share-based/i);
  assert.doesNotMatch(request.messages[0].content, /\$85|available cash/i);
  assert.equal(request.max_tokens, 1400);
});

test("a malformed model response gets one compact format-recovery retry", async () => {
  const requests = [];
  const responses = [
    {
      stop_reason: "max_tokens",
      usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      content: [{ type: "text", text: '{"action":"HOLD"' }],
    },
    {
      stop_reason: "end_turn",
      usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      content: [{ type: "text", text: JSON.stringify({ action: "HOLD", target_weight_pct: 0, thesis: "Evidence is insufficient.", risks: [], kill_criteria: [], confidence: 0.5, suspect_evidence: [] }) }],
    },
  ];
  const anthropicClient = { messages: { create: async (input) => {
    requests.push(input);
    return responses.shift();
  } } };

  const rec = await getAIRecommendation({
    ticker: "TEST", name: "Test Company", quantScore: 70, breakdown: {}, news: [], strategyNotes: "",
    isHeld: false, nextEarningsDate: null, analystTrend: null, insiderActivity: null,
    recentFilings: [], marketScanSignals: [], athenaEvidence: [], macro: null, personality: null,
    persistentMemory: null, proposalPolicy: "Capital availability is handled downstream.", researchHistory: null,
    boundaryToken: null, evaluatorCritique: null, previousProposal: null, agentId: "agent-3",
    anthropicClient, recordUsage: async () => ({ persisted: false }),
  });

  assert.equal(requests.length, 2);
  assert.equal(requests[0].max_tokens, 1400);
  assert.match(requests[1].messages[0].content, /FORMAT RECOVERY/i);
  assert.equal(rec.outputInvalid, false);
  assert.equal(rec.formatRecoveryAttempted, true);
  assert.equal(rec.initialModelStopReason, "max_tokens");
  assert.equal(rec.modelStopReason, "end_turn");
});

test("fractional-share HOLD detector catches position-size rationales but not free-cash-flow fundamentals", () => {
  const violations = findFractionalShareHoldViolations({
    action: "HOLD",
    thesis: "Only $85 of available cash is far below a meaningful position and cannot fund a 5-15% NAV entry.",
    risks: [], killCriteria: [],
  });
  assert.deepEqual(violations, ["meaningful_position", "cash_as_decision", "cannot_fund_position", "nav_minimum_position"]);
  assert.deepEqual(findFractionalShareHoldViolations({
    action: "HOLD",
    thesis: "Free cash flow is negative and the valuation does not clear the entry bar.", risks: [], killCriteria: [],
  }), []);
  assert.deepEqual(findFractionalShareHoldViolations({ action: "BUY", thesis: "Available cash is limited.", risks: [], killCriteria: [] }), []);
});

test("scan policy path retries one invalid HOLD and admits a corrected BUY without a live model call", async () => {
  let calls = 0;
  const result = await enforceFractionalShareHoldPolicy({
    action: "HOLD", thesis: "Only $85 of available cash is not a meaningful position.", risks: [], killCriteria: [],
  }, async (violations) => {
    calls += 1;
    assert.ok(violations.includes("meaningful_position"));
    return { action: "BUY", thesis: "The evidence and risk gates support entry.", risks: [], killCriteria: [] };
  });
  assert.equal(calls, 1);
  assert.equal(result.retried, true);
  assert.equal(result.proposal.action, "BUY");
  assert.deepEqual(result.repeatedViolations, []);
});

test("scan policy path never loops and exposes a repeated invalid HOLD", async () => {
  let calls = 0;
  const result = await enforceFractionalShareHoldPolicy({
    action: "HOLD", thesis: "The minimum dollar allocation is too small to be meaningful.", risks: [], killCriteria: [],
  }, async () => {
    calls += 1;
    return { action: "HOLD", thesis: "Available cash cannot fund a meaningful position.", risks: [], killCriteria: [] };
  });
  assert.equal(calls, 1);
  assert.equal(result.retried, true);
  assert.ok(result.repeatedViolations.length > 0);
});

test("policy correction is sent as a distinct generator retry", async () => {
  let request;
  const anthropicClient = { messages: { create: async (input) => {
    request = input;
    return { stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }, content: [{ type: "text", text: JSON.stringify({ action: "HOLD", target_weight_pct: 0, thesis: "The valuation gate fails.", risks: [], kill_criteria: [], confidence: 0.5, suspect_evidence: [] }) }] };
  } } };
  await getAIRecommendation({ ticker: "TEST", name: "Test Company", quantScore: 70, breakdown: {}, news: [], strategyNotes: "", isHeld: false, nextEarningsDate: null, analystTrend: null, insiderActivity: null, recentFilings: [], marketScanSignals: [], athenaEvidence: [], macro: null, personality: null, persistentMemory: null, proposalPolicy: "Capital availability is handled downstream.", researchHistory: null, boundaryToken: null, evaluatorCritique: null, previousProposal: null, decisionPolicyCorrection: "meaningful_position,cash_as_decision", agentId: "agent-1", anthropicClient, recordUsage: async () => ({ persisted: false }) });
  assert.match(request.messages[0].content, /previous HOLD is invalid/i);
  assert.match(request.messages[0].content, /Do not mention available cash/i);
});

test("invalid model JSON is marked as an output error instead of an investment HOLD", () => {
  const rec = parseRecommendation('{"action":"BUY"', "TEST", new Set());
  assert.equal(rec.action, "HOLD");
  assert.equal(rec.outputInvalid, true);
  assert.match(rec.outputError, /invalid JSON/i);
});

test("proposal evidence ledger labels scores as ranks and preserves typed raw facts", () => {
  const packet = buildProposalEvidence({
    quantScore: 81.2,
    breakdown: { trailingPE: 94.6, rsi: 60 },
    factEvidence: [{ id: "raw_trailing_pe", kind: "raw_fact", label: "Trailing P/E", value: 22.4, unit: "x", source: "Yahoo Finance" }],
  });
  assert.deepEqual(packet.find((entry) => entry.id === "rank_trailingPE"), {
    id: "rank_trailingPE", kind: "normalized_rank", label: "trailingPE score", value: 94.6, unit: "rank_0_to_100", source: "internal cross-sectional scoring",
  });
  assert.equal(packet.find((entry) => entry.id === "raw_trailing_pe").value, 22.4);
  assert.equal(packet.find((entry) => entry.id === "raw_trailing_pe").kind, "raw_fact");
});

test("context-only news remains outside the actionable evidence ledger", () => {
  const packet = buildProposalEvidence({
    quantScore: 81.2,
    breakdown: {},
    news: [
      { title: "promotional", url: "https://example.test/promo", thesisSupport: false },
      { title: "reported result", url: "https://example.test/report", thesisSupport: true },
    ],
  });
  assert.equal(packet.some((entry) => entry.id === "news_1"), false);
  assert.equal(packet.some((entry) => entry.id === "news_2"), true);
});

test("actionable thesis fails closed when an exact sentence lacks an evidence citation", () => {
  const check = validateActionableEvidence({
    action: "BUY",
    thesis: "The quant rank is strong. The company trades at 12x earnings.",
    evidenceCitations: [{ claim: "The quant rank is strong.", evidence_ids: ["quant_score_rank"] }],
    evidenceIds: new Set(["quant_score_rank"]),
    claimedBusinessFamily: "technology",
  });
  assert.equal(check.valid, false);
  assert.match(check.issues.join(" "), /no exact evidence citation/);
});

test("parseRecommendation downgrades an actionable response with invented citation IDs to HOLD", () => {
  const rec = parseRecommendation(JSON.stringify({
    action: "BUY", target_weight_pct: 5, thesis: "The company trades at 12x earnings.", risks: ["Risk."], kill_criteria: ["Kill."], confidence: 0.8, claimed_business_family: "technology",
    evidence_citations: [{ claim: "The company trades at 12x earnings.", evidence_ids: ["invented_pe"] }], suspect_evidence: [],
  }), "TEST", new Set(["quant_score_rank"]));
  assert.equal(rec.action, "HOLD");
  assert.equal(rec.targetWeight, 0);
  assert.equal(rec.evidenceValidation.valid, false);
});

test("parseRecommendation retains an actionable response only when every thesis sentence is cited", () => {
  const thesis = "The normalized quant rank is strong.";
  const rec = parseRecommendation(JSON.stringify({
    action: "BUY", target_weight_pct: 5, thesis, risks: ["Risk."], kill_criteria: ["Kill."], confidence: 0.8, claimed_business_family: "technology",
    evidence_citations: [{ claim: thesis, evidence_ids: ["quant_score_rank"] }], suspect_evidence: [],
  }), "TEST", new Set(["quant_score_rank"]));
  assert.equal(rec.action, "BUY");
  assert.equal(rec.evidenceValidation.valid, true);
  assert.equal(rec.claimedBusinessFamily, "technology");
});

test("BUY/SELL fail closed without a valid claimed business family", () => {
  const thesis = "The normalized quant rank is strong.";
  const rec = parseRecommendation(JSON.stringify({
    action: "BUY", target_weight_pct: 5, thesis, risks: ["Risk."], kill_criteria: ["Kill."], confidence: 0.8,
    evidence_citations: [{ claim: thesis, evidence_ids: ["quant_score_rank"] }], suspect_evidence: [],
  }), "TEST", new Set(["quant_score_rank"]));
  assert.equal(rec.action, "HOLD");
  assert.match(rec.evidenceValidation.issues.join(" "), /claimed_business_family/);
});
