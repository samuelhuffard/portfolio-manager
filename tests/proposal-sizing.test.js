import { test } from "node:test";
import assert from "node:assert/strict";
import { sizeProposalAmount, hasOpenProposal, hasRecentProposal } from "../lib/proposal-sizing.js";

test("sizes a BUY off total portfolio value", () => {
  const result = sizeProposalAmount({ action: "BUY", targetWeightPct: 5, totalPortfolioValue: 20000 });
  assert.deepEqual(result, { amountDollars: 1000, clamped: false });
});

test("sizes a BUY as the increment toward target, not the full target", () => {
  // Already holding 8% ($1600 of $20k); target 10% → buy only the 2% gap ($400),
  // not another 10% (which would land the position at ~18%, over the cap).
  const result = sizeProposalAmount({
    action: "BUY",
    targetWeightPct: 10,
    totalPortfolioValue: 20000,
    currentPositionValue: 1600,
  });
  assert.deepEqual(result, { amountDollars: 400, clamped: false });
});

test("returns null for a BUY when the position already meets its target weight", () => {
  assert.equal(
    sizeProposalAmount({ action: "BUY", targetWeightPct: 8, totalPortfolioValue: 20000, currentPositionValue: 2000 }),
    null
  );
});

test("uses concentrated starter sizing for a tiny new account without a required cash reserve", () => {
  const result = sizeProposalAmount({
    action: "BUY",
    targetWeightPct: 15,
    totalPortfolioValue: 50,
    currentPositionValue: 0,
    limits: {
      percentageSizingMinPortfolioValue: 500,
      starterPortfolioMaxPositions: 2,
      starterPortfolioCashReservePct: 0,
    },
  });
  assert.deepEqual(result, { amountDollars: 25, clamped: false, starterSized: true });
});

test("uses incremental percentage sizing for adds to existing positions even in a tiny account", () => {
  // Holding $20 of $50 (40%); target 55% → increment is 15% of $50 = $7.50.
  const result = sizeProposalAmount({
    action: "BUY",
    targetWeightPct: 55,
    totalPortfolioValue: 50,
    currentPositionValue: 20,
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

test("caps a BUY by currently available idle cash", () => {
  const result = sizeProposalAmount({
    action: "BUY",
    targetWeightPct: 20,
    totalPortfolioValue: 10000,
    cashAvailable: 750,
  });
  assert.deepEqual(result, { amountDollars: 750, clamped: false, cashClamped: true });
});

test("returns null for a BUY when open proposals reserve all idle cash", () => {
  assert.equal(sizeProposalAmount({ action: "BUY", targetWeightPct: 5, totalPortfolioValue: 10000, cashAvailable: 0 }), null);
});

test("sizes a SELL off the ticker's actual position market value", () => {
  // Position is worth $2000 — the SELL is $2000 regardless of how much idle
  // cash sits in the account (weight × total value used to overstate this).
  const result = sizeProposalAmount({ action: "SELL", totalPortfolioValue: 20000, currentPositionValue: 2000 });
  assert.deepEqual(result, { amountDollars: 2000, clamped: false });
});

test("returns null for a SELL with no current position", () => {
  assert.equal(sizeProposalAmount({ action: "SELL", totalPortfolioValue: 20000, currentPositionValue: 0 }), null);
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

test("hasRecentProposal caps ordinary SELL reviews by age", () => {
  const now = new Date("2026-07-01T12:00:00.000Z");
  const proposals = [
    { agentId: "agent-1", ticker: "AAPL", side: "SELL", createdAt: "2026-06-28T12:00:00.000Z" },
    { agentId: "agent-1", ticker: "MSFT", side: "SELL", createdAt: "2026-06-01T12:00:00.000Z" },
    { agentId: "agent-1", ticker: "AAPL", side: "BUY", createdAt: "2026-06-30T12:00:00.000Z" },
  ];

  assert.equal(hasRecentProposal(proposals, { agentId: "agent-1", ticker: "AAPL", side: "SELL", cooldownDays: 7, now }), true);
  assert.equal(hasRecentProposal(proposals, { agentId: "agent-1", ticker: "MSFT", side: "SELL", cooldownDays: 7, now }), false);
  assert.equal(hasRecentProposal(proposals, { agentId: "agent-1", ticker: "AAPL", side: "SELL", cooldownDays: 0, now }), false);
});
