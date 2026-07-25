import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AllocationPolicySchema,
  AllocationSnapshotSchema,
  PortfolioDecisionSchema,
  PORTFOLIO_MANAGER_ID,
  PORTFOLIO_MANAGER_NAME,
  PortfolioReviewRequestSchema,
} from "../contracts/portfolio-decision.js";
import {
  evaluateShadowPortfolioDecision,
  fingerprintStrategyProposal,
} from "../lib/portfolio-manager-shadow.js";

const NOW = "2026-07-11T12:00:00.000Z";

test("Kairos keeps the stable Agent 4 machine identifier", () => {
  assert.equal(PORTFOLIO_MANAGER_NAME, "Kairos");
  assert.equal(PORTFOLIO_MANAGER_ID, "agent-4");
});

function proposal(overrides = {}) {
  return {
    intentId: "intent-1",
    agentId: "agent-1",
    ticker: "NVDA",
    side: "BUY",
    amountDollars: 500,
    maxPrice: null,
    thesis: "Specialist-authored thesis",
    killCriteria: ["Close below a specified invalidation level"],
    horizonDays: 30,
    evidenceSnapshotId: "evidence-1",
    citedLotIds: [],
    ...overrides,
  };
}

function budget(agentId, overrides = {}) {
  return {
    agentId,
    budgetDollars: 2_000,
    allocatedDollars: 500,
    previousBudgetDollars: 2_000,
    evaluatedProposalCount: 10,
    filledTradeCount: 5,
    evidenceWindowStart: "2026-06-11T12:00:00.000Z",
    evidenceWindowEnd: NOW,
    ...overrides,
  };
}

function request(overrides = {}) {
  const specialistProposal = overrides.specialistProposal ?? proposal();
  return {
    proposalId: "proposal-1",
    originatorId: specialistProposal.agentId,
    specialistProposal,
    reviewedProposal: structuredClone(specialistProposal),
    policy: {
      version: "policy-v1",
      mode: "SHADOW",
      effectiveAt: NOW,
      maxSingleProposalDollars: 1_000,
      maxStrategyAllocationPct: 30,
      maxTickerExposurePct: 20,
      minCashReservePct: 10,
      maxGrossExposurePct: 90,
      maxBudgetChangePct: 25,
      evidenceWindowDays: 90,
      maxAllocationSnapshotAgeMinutes: 1_440,
      maxPortfolioSnapshotAgeMinutes: 15,
      minEvaluatedProposals: 5,
      minFilledTrades: 2,
    },
    allocationSnapshot: {
      id: "allocation-1",
      policyVersion: "policy-v1",
      capturedAt: NOW,
      portfolioEquityDollars: 10_000,
      budgets: [budget("agent-1"), budget("agent-2"), budget("agent-3")],
    },
    portfolioSnapshot: {
      id: "portfolio-1",
      policyVersion: "policy-v1",
      capturedAt: NOW,
      portfolioEquityDollars: 10_000,
      cashAvailableDollars: 3_000,
      grossExposureDollars: 7_000,
      tickerExposures: [{ ticker: "NVDA", marketValueDollars: 1_000 }],
    },
    sellLotOwnership: [],
    decidedAt: NOW,
    ...overrides,
  };
}

test("contracts accept bounded shadow policy, complete allocation state, and review input", () => {
  const input = request();
  assert.doesNotThrow(() => AllocationPolicySchema.parse(input.policy));
  assert.doesNotThrow(() => AllocationSnapshotSchema.parse(input.allocationSnapshot));
  assert.doesNotThrow(() => PortfolioReviewRequestSchema.parse(input));
  assert.throws(() => AllocationPolicySchema.parse({ ...input.policy, maxTickerExposurePct: 101 }));
  assert.throws(() => AllocationPolicySchema.parse({ ...input.policy, mode: "LIVE" }));
  assert.throws(() => AllocationSnapshotSchema.parse({
    ...input.allocationSnapshot,
    budgets: [budget("agent-1"), budget("agent-1"), budget("agent-3")],
  }));
});

test("accepts only the exact specialist proposal and emits no live authority", () => {
  const input = request();
  const decision = evaluateShadowPortfolioDecision(input);

  assert.equal(decision.outcome, "ACCEPT");
  assert.deepEqual(decision.reasonCodes, ["ACCEPT_WITHIN_POLICY_BOUNDS"]);
  assert.deepEqual(decision.proposalSnapshot, input.specialistProposal);
  assert.equal(decision.proposalFingerprint, fingerprintStrategyProposal(input.specialistProposal));
  assert.equal(decision.liveApprovalHmac, null);
  assert.equal(decision.orderIntent, null);
  assert.ok(Object.isFrozen(decision));
  assert.ok(Object.isFrozen(decision.proposalSnapshot));
  assert.doesNotThrow(() => PortfolioDecisionSchema.parse(decision));
});

test("fingerprint is deterministic across object key order", () => {
  const first = proposal();
  const reordered = Object.fromEntries(Object.entries(first).reverse());
  assert.equal(fingerprintStrategyProposal(first), fingerprintStrategyProposal(reordered));
});

test("decision lineage changes when snapshot contents change under the same ids", () => {
  const first = request();
  const second = request();
  second.portfolioSnapshot.cashAvailableDollars = 2_900;
  const a = evaluateShadowPortfolioDecision(first);
  const b = evaluateShadowPortfolioDecision(second);
  assert.notEqual(a.id, b.id);
  assert.notEqual(a.portfolioSnapshotFingerprint, b.portfolioSnapshotFingerprint);
});

test("rejects an Agent 4 self-originated proposal", () => {
  const decision = evaluateShadowPortfolioDecision(request({ originatorId: "agent-4" }));
  assert.equal(decision.outcome, "REJECT");
  assert.ok(decision.reasonCodes.includes("REJECT_MANAGER_ORIGINATED"));

  const selfAuthored = request();
  selfAuthored.specialistProposal.agentId = "agent-4";
  selfAuthored.reviewedProposal.agentId = "agent-4";
  assert.equal(evaluateShadowPortfolioDecision(selfAuthored).outcome, "REJECT");
});

test("rejects any proposal mutation without adopting the changed proposal", () => {
  const input = request();
  input.reviewedProposal.amountDollars = 400;
  const decision = evaluateShadowPortfolioDecision(input);

  assert.equal(decision.outcome, "REJECT");
  assert.ok(decision.reasonCodes.includes("REJECT_PROPOSAL_MUTATED"));
  assert.equal(decision.proposalSnapshot.amountDollars, 500);
});

test("rejects origin, policy-version, and allocation-state mismatches", () => {
  const input = request({ originatorId: "agent-2" });
  input.allocationSnapshot.policyVersion = "old-policy";
  input.portfolioSnapshot.portfolioEquityDollars = 9_000;
  const decision = evaluateShadowPortfolioDecision(input);

  assert.equal(decision.outcome, "REJECT");
  assert.ok(decision.reasonCodes.includes("REJECT_ORIGIN_MISMATCH"));
  assert.ok(decision.reasonCodes.includes("REJECT_POLICY_VERSION_MISMATCH"));
  assert.ok(decision.reasonCodes.includes("REJECT_ALLOCATION_SNAPSHOT_MISMATCH"));
});

test("rejects a portfolio snapshot from after the explicit decision time", () => {
  const input = request();
  input.portfolioSnapshot.capturedAt = "2026-07-11T12:00:01.000Z";
  const decision = evaluateShadowPortfolioDecision(input);
  assert.equal(decision.outcome, "REJECT");
  assert.ok(decision.reasonCodes.includes("REJECT_PORTFOLIO_SNAPSHOT_MISMATCH"));
});

test("rejects snapshots older than the active policy permits", () => {
  const input = request();
  input.allocationSnapshot.capturedAt = "2026-07-10T11:59:00.000Z";
  input.portfolioSnapshot.capturedAt = "2026-07-11T11:30:00.000Z";
  const decision = evaluateShadowPortfolioDecision(input);
  assert.equal(decision.outcome, "REJECT");
  assert.ok(decision.reasonCodes.includes("REJECT_ALLOCATION_SNAPSHOT_MISMATCH"));
  assert.ok(decision.reasonCodes.includes("REJECT_PORTFOLIO_SNAPSHOT_MISMATCH"));
});

test("rejects a budget change larger than the supplied equity-percentage cap", () => {
  const input = request();
  input.policy.maxStrategyAllocationPct = 60;
  input.policy.maxBudgetChangePct = 10;
  input.allocationSnapshot.budgets[0] = budget("agent-1", {
    budgetDollars: 3_100,
    previousBudgetDollars: 2_000,
  });
  const decision = evaluateShadowPortfolioDecision(input);

  assert.equal(decision.outcome, "REJECT");
  assert.ok(decision.reasonCodes.includes("REJECT_STRATEGY_BUDGET_EXCEEDED"));
});

test("rejects a SELL unless every cited lot belongs to the proposing specialist", () => {
  const sell = proposal({ side: "SELL", citedLotIds: ["lot-1", "lot-2"] });
  const decision = evaluateShadowPortfolioDecision(request({
    specialistProposal: sell,
    reviewedProposal: structuredClone(sell),
    sellLotOwnership: [
      { lotId: "lot-1", ticker: "NVDA", ownerAgentId: "agent-1", sharesOpen: 2 },
      { lotId: "lot-2", ticker: "NVDA", ownerAgentId: "unattributed", sharesOpen: 2 },
    ],
  }));

  assert.equal(decision.outcome, "REJECT");
  assert.ok(decision.reasonCodes.includes("REJECT_UNOWNED_SELL"));
});

test("accepts an owner-specialist SELL without creating or forcing a different trade", () => {
  const sell = proposal({ side: "SELL", citedLotIds: ["lot-1"] });
  const decision = evaluateShadowPortfolioDecision(request({
    specialistProposal: sell,
    reviewedProposal: structuredClone(sell),
    sellLotOwnership: [
      { lotId: "lot-1", ticker: "NVDA", ownerAgentId: "agent-1", sharesOpen: 2 },
    ],
  }));

  assert.equal(decision.outcome, "ACCEPT");
  assert.equal(decision.proposalSnapshot.side, "SELL");
  assert.deepEqual(decision.proposalSnapshot.citedLotIds, ["lot-1"]);
});

test("applies supplied budget, evidence, cash, gross, and ticker bounds deterministically", () => {
  const input = request();
  input.allocationSnapshot.budgets[0] = budget("agent-1", {
    budgetDollars: 1_000,
    allocatedDollars: 800,
    evaluatedProposalCount: 1,
    filledTradeCount: 0,
  });
  input.portfolioSnapshot.cashAvailableDollars = 1_200;
  input.portfolioSnapshot.grossExposureDollars = 8_800;
  input.portfolioSnapshot.tickerExposures[0].marketValueDollars = 1_800;

  const first = evaluateShadowPortfolioDecision(input);
  const second = evaluateShadowPortfolioDecision(structuredClone(input));
  assert.deepEqual(first, second);
  assert.equal(first.outcome, "REJECT");
  assert.deepEqual(first.reasonCodes, [
    "REJECT_EVIDENCE_MINIMUM_NOT_MET",
    "REJECT_STRATEGY_BUDGET_EXCEEDED",
    "REJECT_CASH_RESERVE_LIMIT",
    "REJECT_GROSS_EXPOSURE_LIMIT",
    "REJECT_TICKER_CONCENTRATION_LIMIT",
  ]);
});

test("fails closed on malformed input and cannot emit an executable decision", () => {
  const input = request();
  input.policy.mode = "LIVE";
  const decision = evaluateShadowPortfolioDecision(input);
  assert.equal(decision.outcome, "REJECT");
  assert.deepEqual(decision.reasonCodes, ["REJECT_INVALID_INPUT"]);
  assert.equal(decision.liveApprovalHmac, null);
  assert.equal(decision.orderIntent, null);
});
