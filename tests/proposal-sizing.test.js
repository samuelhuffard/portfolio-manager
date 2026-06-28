import { test } from "node:test";
import assert from "node:assert/strict";
import { sizeProposalAmount, hasOpenProposal } from "../lib/proposal-sizing.js";

test("sizes a BUY off total portfolio value", () => {
  const result = sizeProposalAmount({ action: "BUY", targetWeightPct: 5, totalPortfolioValue: 20000 });
  assert.deepEqual(result, { amountDollars: 1000, clamped: false });
});

test("uses concentrated starter sizing for a tiny new account without a required cash reserve", () => {
  const result = sizeProposalAmount({
    action: "BUY",
    targetWeightPct: 15,
    totalPortfolioValue: 50,
    currentPositionWeightPct: 0,
    limits: {
      percentageSizingMinPortfolioValue: 500,
      starterPortfolioMaxPositions: 2,
      starterPortfolioCashReservePct: 0,
    },
  });
  assert.deepEqual(result, { amountDollars: 25, clamped: false, starterSized: true });
});

test("uses percentage sizing for adds to existing positions even in a tiny account", () => {
  const result = sizeProposalAmount({
    action: "BUY",
    targetWeightPct: 15,
    totalPortfolioValue: 50,
    currentPositionWeightPct: 40,
    limits: {
      percentageSizingMinPortfolioValue: 500,
      starterPortfolioMaxPositions: 2,
      starterPortfolioCashReservePct: 10,
    },
  });
  assert.deepEqual(result, { amountDollars: 7.5, clamped: false });
});

test("returns null for a BUY before the account has any value", () => {
  assert.equal(sizeProposalAmount({ action: "BUY", targetWeightPct: 5, totalPortfolioValue: 0 }), null);
});

test("clamps an oversized BUY to the $10,000 proposal cap", () => {
  const result = sizeProposalAmount({ action: "BUY", targetWeightPct: 50, totalPortfolioValue: 100000 });
  assert.deepEqual(result, { amountDollars: 10000, clamped: true });
});

test("sizes a SELL off the ticker's current position weight", () => {
  const result = sizeProposalAmount({ action: "SELL", totalPortfolioValue: 20000, currentPositionWeightPct: 10 });
  assert.deepEqual(result, { amountDollars: 2000, clamped: false });
});

test("returns null for a SELL with no current position", () => {
  assert.equal(sizeProposalAmount({ action: "SELL", totalPortfolioValue: 20000, currentPositionWeightPct: 0 }), null);
});

test("returns null for HOLD", () => {
  assert.equal(sizeProposalAmount({ action: "HOLD", totalPortfolioValue: 20000 }), null);
});

const baseProposals = [
  { agentId: "agent-1", ticker: "AAPL", side: "BUY", status: "Pending", fulfilledAt: null },
  { agentId: "agent-1", ticker: "MSFT", side: "BUY", status: "ApprovedForBrokerReview", fulfilledAt: "2026-06-20T00:00:00Z" },
  { agentId: "agent-2", ticker: "NVDA", side: "SELL", status: "ApprovedForBrokerReview", fulfilledAt: null },
];

test("hasOpenProposal matches a pending proposal for the same agent/ticker/side", () => {
  assert.equal(hasOpenProposal(baseProposals, { agentId: "agent-1", ticker: "AAPL", side: "BUY" }), true);
});

test("hasOpenProposal ignores a fulfilled approved proposal", () => {
  assert.equal(hasOpenProposal(baseProposals, { agentId: "agent-1", ticker: "MSFT", side: "BUY" }), false);
});

test("hasOpenProposal matches an approved-but-unfulfilled proposal", () => {
  assert.equal(hasOpenProposal(baseProposals, { agentId: "agent-2", ticker: "NVDA", side: "SELL" }), true);
});

test("hasOpenProposal is false when nothing matches", () => {
  assert.equal(hasOpenProposal(baseProposals, { agentId: "agent-3", ticker: "TSLA", side: "BUY" }), false);
});
