import test from "node:test";
import assert from "node:assert/strict";
import { buildAgent4ShadowReviewRequest } from "../lib/agent4-shadow-adapter.js";
import { evaluateShadowPortfolioDecision } from "../lib/portfolio-manager-shadow.js";

const policy = {
  version: "agent-4-shadow-v1", mode: "SHADOW", effectiveAt: "2026-07-25T00:00:00.000Z",
  maxSingleProposalDollars: 10_000, maxStrategyAllocationPct: 70, maxTickerExposurePct: 20,
  minCashReservePct: 0, maxGrossExposurePct: 100, maxBudgetChangePct: 10,
  evidenceWindowDays: 60, maxAllocationSnapshotAgeMinutes: 60, maxPortfolioSnapshotAgeMinutes: 30,
  minEvaluatedProposals: 0, minFilledTrades: 0,
};

function input(overrides = {}) {
  return {
    proposal: { id: "proposal-1", agentId: "agent-3", ticker: "GS", side: "BUY", amountDollars: 6.05, maxPrice: 700 },
    recommendation: { thesis: "Durable franchise with a valuation-supported long-term thesis.", killCriteria: ["Business-quality or valuation thesis materially breaks."] },
    context: { totalPortfolioValue: 100, cashAvailableBeforeProposal: 100, heldAllocation: [], lots: [] },
    policy,
    now: "2026-07-25T12:00:00.000Z",
    ...overrides,
  };
}

test("Agent 4 adapter preserves the exact specialist BUY and produces an observable shadow decision", () => {
  const request = buildAgent4ShadowReviewRequest(input());
  assert.equal(request.specialistProposal.agentId, "agent-3");
  assert.equal(request.specialistProposal.ticker, "GS");
  assert.equal(request.specialistProposal.amountDollars, 6.05);
  assert.deepEqual(request.reviewedProposal, request.specialistProposal);
  const decision = evaluateShadowPortfolioDecision(request);
  assert.equal(decision.outcome, "ACCEPT");
  assert.equal(decision.liveApprovalHmac, null);
  assert.equal(decision.orderIntent, null);
});

test("Agent 4 adapter records owned SELL lots but never borrows another strategy's inventory", () => {
  const request = buildAgent4ShadowReviewRequest(input({
    proposal: { id: "proposal-2", agentId: "agent-1", ticker: "NVDA", side: "SELL", amountDollars: 10, maxPrice: null },
    context: {
      totalPortfolioValue: 100,
      cashAvailableBeforeProposal: 50,
      heldAllocation: [{ ticker: "NVDA", shares: 1, marketValue: 50 }],
      lots: [
        { lotId: "owned", agentId: "agent-1", ticker: "NVDA", status: "OPEN", sharesOpen: 0.5 },
        { lotId: "other", agentId: "agent-2", ticker: "NVDA", status: "OPEN", sharesOpen: 0.5 },
      ],
    },
  }));
  assert.deepEqual(request.specialistProposal.citedLotIds, ["owned"]);
  assert.deepEqual(request.sellLotOwnership.map((lot) => lot.lotId), ["owned"]);
  assert.equal(evaluateShadowPortfolioDecision(request).outcome, "ACCEPT");
});
