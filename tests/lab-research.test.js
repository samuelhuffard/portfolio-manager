import { test } from "node:test";
import assert from "node:assert/strict";
import { validateResearchTickerRequest, buildLabOutcome, LAB_TICKER_RE, DEFAULT_LAB_AGENT_ID } from "../lib/lab-research.js";

const KNOWN_AGENTS = ["agent-1", "agent-2", "agent-3"];

// --- validateResearchTickerRequest ---

test("accepts a plain ticker and defaults to agent-1", () => {
  const result = validateResearchTickerRequest({ ticker: "NVDA" }, KNOWN_AGENTS);
  assert.deepEqual(result, { ok: true, ticker: "NVDA", agentId: DEFAULT_LAB_AGENT_ID });
});

test("normalizes lowercase and surrounding whitespace before validating", () => {
  const result = validateResearchTickerRequest({ ticker: "  nvda " }, KNOWN_AGENTS);
  assert.deepEqual(result, { ok: true, ticker: "NVDA", agentId: "agent-1" });
});

test("accepts class-suffix tickers (BRK.B, BF-B)", () => {
  assert.equal(validateResearchTickerRequest({ ticker: "BRK.B" }, KNOWN_AGENTS).ok, true);
  assert.equal(validateResearchTickerRequest({ ticker: "bf-b" }, KNOWN_AGENTS).ticker, "BF-B");
});

test("accepts an explicit known agentId", () => {
  const result = validateResearchTickerRequest({ ticker: "AAPL", agentId: "agent-2" }, KNOWN_AGENTS);
  assert.deepEqual(result, { ok: true, ticker: "AAPL", agentId: "agent-2" });
});

test("rejects unknown agentIds instead of silently defaulting", () => {
  const result = validateResearchTickerRequest({ ticker: "AAPL", agentId: "agent-9" }, KNOWN_AGENTS);
  assert.equal(result.ok, false);
  assert.match(result.error, /Unknown agentId/);
});

test("rejects a non-string agentId", () => {
  const result = validateResearchTickerRequest({ ticker: "AAPL", agentId: 2 }, KNOWN_AGENTS);
  assert.equal(result.ok, false);
});

test("empty-string agentId falls back to the default agent", () => {
  const result = validateResearchTickerRequest({ ticker: "AAPL", agentId: "" }, KNOWN_AGENTS);
  assert.deepEqual(result, { ok: true, ticker: "AAPL", agentId: "agent-1" });
});

test("rejects missing, empty, or non-string tickers", () => {
  assert.equal(validateResearchTickerRequest({}, KNOWN_AGENTS).ok, false);
  assert.equal(validateResearchTickerRequest({ ticker: "" }, KNOWN_AGENTS).ok, false);
  assert.equal(validateResearchTickerRequest({ ticker: "   " }, KNOWN_AGENTS).ok, false);
  assert.equal(validateResearchTickerRequest({ ticker: 42 }, KNOWN_AGENTS).ok, false);
  assert.equal(validateResearchTickerRequest({ ticker: ["NVDA"] }, KNOWN_AGENTS).ok, false);
});

test("rejects malformed ticker formats", () => {
  for (const bad of ["TOOLONGG", "NV1", "NVDA!", ".B", "BRK.", "BRK.BBB", "BRK..B", "A B", "BRK-", "-B", "NVDA.B2"]) {
    const result = validateResearchTickerRequest({ ticker: bad }, KNOWN_AGENTS);
    assert.equal(result.ok, false, `expected ${bad} to be rejected`);
  }
});

test("accepts boundary-length tickers (1 and 5 letters)", () => {
  assert.equal(validateResearchTickerRequest({ ticker: "F" }, KNOWN_AGENTS).ok, true);
  assert.equal(validateResearchTickerRequest({ ticker: "GOOGL" }, KNOWN_AGENTS).ok, true);
});

test("rejects non-object bodies", () => {
  assert.equal(validateResearchTickerRequest(null, KNOWN_AGENTS).ok, false);
  assert.equal(validateResearchTickerRequest("NVDA", KNOWN_AGENTS).ok, false);
  assert.equal(validateResearchTickerRequest(["NVDA"], KNOWN_AGENTS).ok, false);
});

test("fails closed when the known-agent list is missing or empty", () => {
  assert.equal(validateResearchTickerRequest({ ticker: "NVDA" }, []).ok, false);
  assert.equal(validateResearchTickerRequest({ ticker: "NVDA" }, undefined).ok, false);
});

test("LAB_TICKER_RE itself rejects lowercase (normalization happens before it)", () => {
  assert.equal(LAB_TICKER_RE.test("nvda"), false);
  assert.equal(LAB_TICKER_RE.test("NVDA"), true);
});

// --- buildLabOutcome ---

test("builds a queued-proposal outcome with proposalId, amount, and riskSummary", () => {
  const outcome = buildLabOutcome({
    ticker: "NVDA",
    agentId: "agent-1",
    quantScore: 72,
    rec: { action: "BUY", thesis: "Strong momentum", confidence: 0.8, targetWeight: 5, overrideNotes: ["evaluator: APPROVE"] },
    recommendation: { action: "BUY", quantScore: 72, ruleCheck: "evaluator: APPROVE", confidence: 0.8 },
    createdProposal: { id: "prop-123", amountDollars: 500, riskSummary: "Quant score 72/100. Risk checks: evaluator: APPROVE." },
    evaluatorVerdict: "APPROVE",
    noProposalReason: null,
  });
  assert.equal(outcome.action, "BUY");
  assert.equal(outcome.thesis, "Strong momentum");
  assert.equal(outcome.confidence, 0.8);
  assert.equal(outcome.quantScore, 72);
  assert.equal(outcome.evaluatorVerdict, "APPROVE");
  assert.equal(outcome.proposalId, "prop-123");
  assert.equal(outcome.amountDollars, 500);
  assert.match(outcome.riskSummary, /Quant score 72/);
  assert.equal(outcome.reason, undefined);
});

test("builds a no-proposal outcome carrying the human-readable reason", () => {
  const outcome = buildLabOutcome({
    ticker: "AAPL",
    agentId: "agent-2",
    quantScore: 40,
    rec: { action: "HOLD", thesis: "Nothing compelling", confidence: 0.4, overrideNotes: ["evaluator_reject: weak thesis"] },
    recommendation: { action: "HOLD", quantScore: 40, ruleCheck: "evaluator_reject: weak thesis", confidence: 0.4 },
    createdProposal: null,
    evaluatorVerdict: "REJECT",
    noProposalReason: "evaluator rejected: weak thesis",
  });
  assert.equal(outcome.action, "HOLD");
  assert.equal(outcome.reason, "evaluator rejected: weak thesis");
  assert.equal(outcome.evaluatorVerdict, "REJECT");
  assert.equal(outcome.proposalId, undefined);
  assert.equal(outcome.amountDollars, undefined);
});

test("handles the data-gate shape (rec is null, recommendation carries the story)", () => {
  const outcome = buildLabOutcome({
    ticker: "XYZ",
    agentId: "agent-1",
    quantScore: null,
    rec: null,
    recommendation: {
      action: "HOLD",
      quantScore: null,
      rationale: "NO_TRADE (data gate): missing EPS",
      ruleCheck: "data_gate_blocked: missing EPS",
      confidence: null,
    },
    createdProposal: null,
    evaluatorVerdict: "not run (data gate)",
    noProposalReason: "NO_TRADE (data gate): missing EPS",
  });
  assert.equal(outcome.action, "HOLD");
  assert.equal(outcome.thesis, "NO_TRADE (data gate): missing EPS");
  assert.equal(outcome.ruleCheck, "data_gate_blocked: missing EPS");
  assert.equal(outcome.reason, "NO_TRADE (data gate): missing EPS");
});

test("handles the starter-slots-full shape (recommendation null, rec present)", () => {
  const outcome = buildLabOutcome({
    ticker: "TSLA",
    agentId: "agent-1",
    quantScore: 65,
    rec: { action: "BUY", thesis: "Starter buy", confidence: 0.7, overrideNotes: [] },
    recommendation: null,
    createdProposal: null,
    evaluatorVerdict: "APPROVE",
    noProposalReason: "starter slots full (2 positions + 0 open BUYs / 2) — proposal skipped",
  });
  assert.equal(outcome.action, "BUY");
  assert.equal(outcome.thesis, "Starter buy");
  assert.equal(outcome.ruleCheck, "OK");
  assert.match(outcome.reason, /starter slots full/);
});

test("falls back to a sane default reason when no reason was recorded", () => {
  const outcome = buildLabOutcome({
    ticker: "MSFT",
    agentId: "agent-1",
    rec: { action: "HOLD", thesis: "", confidence: null, overrideNotes: [] },
    recommendation: { action: "HOLD", ruleCheck: "OK" },
    createdProposal: null,
    evaluatorVerdict: null,
    noProposalReason: null,
  });
  assert.equal(outcome.reason, "HOLD after risk checks");
  assert.equal(outcome.evaluatorVerdict, "not run");
});
