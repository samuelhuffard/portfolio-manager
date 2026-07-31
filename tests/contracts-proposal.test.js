import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ProposalSchema,
  validateProposalInput,
  AGENT_IDS,
  PROPOSAL_STATUSES,
  PROPOSAL_SIDES,
  MAX_AMOUNT_DOLLARS,
  DEFAULT_RISK_SUMMARY,
} from "../contracts/proposal.js";

// A structurally valid stored proposal used as a base for mutation tests.
function baseStored() {
  return {
    id: "p_123",
    agentId: "agent-1",
    ticker: "NVDA",
    side: "BUY",
    amountDollars: 500,
    maxPrice: null,
    rationale: "Momentum + earnings beat, entering a starter position.",
    riskSummary: DEFAULT_RISK_SUMMARY,
    status: "Pending",
    createdAt: "2026-07-11T00:00:00.000Z",
    updatedAt: "2026-07-11T00:00:00.000Z",
    expiresAt: "2026-07-13T00:00:00.000Z",
    createdByUserId: "user_1",
    createdByEmail: null,
    decidedAt: null,
    decidedByUserId: null,
    decisionNote: null,
    fulfilledAt: null,
    fulfilledOrderId: null,
    fulfilledShares: null,
    decisionHmac: null,
  };
}

test("enums match the historical hard-coded sets", () => {
  assert.deepEqual(AGENT_IDS, ["agent-1", "agent-2", "agent-3"]);
  assert.deepEqual(PROPOSAL_STATUSES, ["Pending", "ApprovedForBrokerReview", "Rejected", "Expired", "ExecutionFailed"]);
  assert.deepEqual(PROPOSAL_SIDES, ["BUY", "SELL"]);
});

test("ProposalSchema accepts a well-formed stored proposal", () => {
  assert.doesNotThrow(() => ProposalSchema.parse(baseStored()));
});

test("ProposalSchema rejects a bad agent, ticker, side, and non-null-wrong types", () => {
  assert.throws(() => ProposalSchema.parse({ ...baseStored(), agentId: "agent-9" }));
  assert.throws(() => ProposalSchema.parse({ ...baseStored(), ticker: "not a ticker" }));
  assert.throws(() => ProposalSchema.parse({ ...baseStored(), side: "HOLD" }));
  assert.throws(() => ProposalSchema.parse({ ...baseStored(), amountDollars: -5 }));
  assert.throws(() => ProposalSchema.parse({ ...baseStored(), status: "Filled" }));
});

// -----------------------------------------------------------------------------
// Parity: the shared validateProposalInput must reproduce, exactly, the messages
// and normalization the dashboard's lib/proposals.ts has always returned. This is
// the contract that lets the dashboard delegate to the shared package without any
// behavior change. If you change a message here, you are changing the API.
// -----------------------------------------------------------------------------

const parityCases = [
  {
    name: "bad agent",
    input: { agentId: "nope", ticker: "NVDA", side: "BUY", amountDollars: 100, rationale: "long enough rationale" },
    expect: { ok: false, error: "Select a valid agent." },
  },
  {
    name: "bad ticker",
    input: { agentId: "agent-1", ticker: "1BADTICKER", side: "BUY", amountDollars: 100, rationale: "long enough rationale" },
    expect: { ok: false, error: "Enter a valid ticker." },
  },
  {
    name: "bad side",
    input: { agentId: "agent-1", ticker: "NVDA", side: "hold", amountDollars: 100, rationale: "long enough rationale" },
    expect: { ok: false, error: "Side must be BUY or SELL." },
  },
  {
    name: "non-positive amount",
    input: { agentId: "agent-1", ticker: "NVDA", side: "BUY", amountDollars: 0, rationale: "long enough rationale" },
    expect: { ok: false, error: "Amount must be a positive dollar value." },
  },
  {
    name: "amount over cap",
    input: { agentId: "agent-1", ticker: "NVDA", side: "BUY", amountDollars: MAX_AMOUNT_DOLLARS + 1, rationale: "long enough rationale" },
    expect: { ok: false, error: "Amount cannot exceed $10,000 per proposal." },
  },
  {
    name: "invalid maxPrice",
    input: { agentId: "agent-1", ticker: "NVDA", side: "BUY", amountDollars: 100, maxPrice: "abc", rationale: "long enough rationale" },
    expect: { ok: false, error: "Max price must be blank or a positive number." },
  },
  {
    name: "rationale too short",
    input: { agentId: "agent-1", ticker: "NVDA", side: "BUY", amountDollars: 100, rationale: "short" },
    expect: { ok: false, error: "Rationale must explain the setup." },
  },
  {
    name: "rationale too long",
    input: { agentId: "agent-1", ticker: "NVDA", side: "BUY", amountDollars: 100, rationale: "x".repeat(2001) },
    expect: { ok: false, error: "Rationale is too long." },
  },
  {
    name: "risk summary too long",
    input: { agentId: "agent-1", ticker: "NVDA", side: "BUY", amountDollars: 100, rationale: "long enough rationale", riskSummary: "y".repeat(2001) },
    expect: { ok: false, error: "Risk summary is too long." },
  },
];

for (const c of parityCases) {
  test(`validateProposalInput parity: ${c.name}`, () => {
    assert.deepEqual(validateProposalInput(c.input), c.expect);
  });
}

test("validateProposalInput normalizes on success (uppercases ticker/side, rounds, defaults risk, blank maxPrice -> null)", () => {
  const result = validateProposalInput({
    agentId: "agent-2",
    ticker: "  nvda ",
    side: "buy",
    amountDollars: "123.456",
    maxPrice: "",
    rationale: "  A rationale that is definitely long enough.  ",
  });
  assert.deepEqual(result, {
    ok: true,
    value: {
      agentId: "agent-2",
      ticker: "NVDA",
      side: "BUY",
      amountDollars: 123.46,
      maxPrice: null,
      rationale: "A rationale that is definitely long enough.",
      riskSummary: DEFAULT_RISK_SUMMARY,
    },
  });
});

test("validateProposalInput rounds a provided maxPrice to 2dp", () => {
  const result = validateProposalInput({
    agentId: "agent-1",
    ticker: "AMD",
    side: "SELL",
    amountDollars: 200,
    maxPrice: "98.765",
    rationale: "Trimming into strength per plan.",
  });
  assert.equal(result.ok, true);
  assert.equal(result.value.maxPrice, 98.77);
});
