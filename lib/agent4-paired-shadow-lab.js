import {
  evaluateShadowPortfolioDecision,
  fingerprintStructuredValue,
} from "./portfolio-manager-shadow.js";

export const AGENT4_PAIRED_SHADOW_LAB_VERSION = "agent4-paired-shadow-lab-v1";

const NOW = "2026-07-21T12:00:00.000Z";
const POLICY = Object.freeze({
  version: "fixture-policy-v1",
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
});

export const AGENT4_DRAFT_POLICY_OWNERSHIP = Object.freeze(
  Object.fromEntries(Object.keys(POLICY).map((field) => [
    field,
    "fixture_only_policy_unresolved",
  ])),
);

function baseRequest(agentId = "agent-1", side = "BUY") {
  const proposal = {
    intentId: `fixture-intent-${agentId}-${side}`,
    agentId,
    ticker: agentId === "agent-2" ? "MSFT" : agentId === "agent-3" ? "JNJ" : "NVDA",
    side,
    amountDollars: 500,
    maxPrice: null,
    thesis: `immutable ${agentId} fixture thesis`,
    killCriteria: ["fixture invalidation"],
    horizonDays: agentId === "agent-3" ? 180 : 30,
    evidenceSnapshotId: `fixture-evidence-${agentId}`,
    citedLotIds: side === "SELL" ? [`lot-${agentId}`] : [],
  };
  const budgets = ["agent-1", "agent-2", "agent-3"].map((id) => ({
    agentId: id, budgetDollars: 2_000, allocatedDollars: 500,
    previousBudgetDollars: 2_000, evaluatedProposalCount: 10, filledTradeCount: 5,
    evidenceWindowStart: "2026-06-21T12:00:00.000Z", evidenceWindowEnd: NOW,
  }));
  return {
    proposalId: `fixture-proposal-${agentId}-${side}`,
    originatorId: agentId, specialistProposal: proposal, reviewedProposal: structuredClone(proposal),
    policy: structuredClone(POLICY),
    allocationSnapshot: { id: `allocation-${agentId}`, policyVersion: POLICY.version, capturedAt: NOW, portfolioEquityDollars: 10_000, budgets },
    portfolioSnapshot: { id: `portfolio-${agentId}`, policyVersion: POLICY.version, capturedAt: NOW, portfolioEquityDollars: 10_000, cashAvailableDollars: 3_000, grossExposureDollars: 7_000, tickerExposures: [{ ticker: proposal.ticker, marketValueDollars: 1_000 }] },
    sellLotOwnership: side === "SELL" ? [{ lotId: `lot-${agentId}`, ticker: proposal.ticker, ownerAgentId: agentId, sharesOpen: 5 }] : [],
    decidedAt: NOW,
  };
}

function caseRecord(id, condition, request, samLabel, policyUnresolved = false) {
  return Object.freeze({ id, condition, request: Object.freeze(request), samLabel, policyUnresolved });
}

export const AGENT4_PAIRED_SHADOW_CASES = Object.freeze([
  caseRecord("A4-01", "accepted_within_bound_agent_1", baseRequest("agent-1"), "agree"),
  caseRecord("A4-02", "accepted_within_bound_agent_2", baseRequest("agent-2"), "agree"),
  caseRecord("A4-03", "owned_sell_different_horizon_agent_3", baseRequest("agent-3", "SELL"), "agree"),
  caseRecord("A4-04", "duplicate_thesis", baseRequest("agent-1"), "disagree", true),
  caseRecord("A4-05", "cash_reserve_breach", (() => { const r = baseRequest("agent-2"); r.portfolioSnapshot.cashAvailableDollars = 1_000; return r; })(), "agree"),
  caseRecord("A4-06", "gross_exposure_breach", (() => { const r = baseRequest("agent-3"); r.portfolioSnapshot.grossExposureDollars = 8_800; return r; })(), "agree"),
  caseRecord("A4-07", "ticker_concentration_breach", (() => { const r = baseRequest("agent-1"); r.portfolioSnapshot.tickerExposures[0].marketValueDollars = 1_800; return r; })(), "agree"),
  caseRecord("A4-08", "strategy_budget_breach", (() => { const r = baseRequest("agent-2"); r.allocationSnapshot.budgets[1].allocatedDollars = 1_700; return r; })(), "agree"),
  caseRecord("A4-09", "stale_portfolio_snapshot", (() => { const r = baseRequest("agent-3"); r.portfolioSnapshot.capturedAt = "2026-07-21T11:00:00.000Z"; return r; })(), "agree"),
  caseRecord("A4-10", "mismatched_snapshot", (() => { const r = baseRequest("agent-1"); r.portfolioSnapshot.portfolioEquityDollars = 9_000; return r; })(), "agree"),
  caseRecord("A4-11", "unowned_sell", (() => { const r = baseRequest("agent-2", "SELL"); r.sellLotOwnership[0].ownerAgentId = "agent-1"; return r; })(), "agree"),
  caseRecord("A4-12", "sam_disagreement_policy_unresolved", baseRequest("agent-3"), "disagree", true),
]);

export function runAgent4PairedShadowLab(cases = AGENT4_PAIRED_SHADOW_CASES) {
  return cases.map((entry) => {
    const proposalFingerprint = fingerprintStructuredValue(entry.request.specialistProposal);
    const requestFingerprint = fingerprintStructuredValue(entry.request);
    const result = entry.policyUnresolved
      ? { outcome: "ABSTAIN", reasonCodes: ["POLICY_UNRESOLVED"], explanation: ["Fixture-only policy does not own this decision."] }
      : evaluateShadowPortfolioDecision(entry.request);
    const virtualEffect = result.outcome === "ACCEPT" ? "would_accept_without_mutation"
      : result.outcome === "REJECT" ? "would_reject_without_mutation" : "no_virtual_effect";
    return Object.freeze({
      id: entry.id, condition: entry.condition, version: AGENT4_PAIRED_SHADOW_LAB_VERSION,
      policyVersion: POLICY.version, policyOwnership: AGENT4_DRAFT_POLICY_OWNERSHIP,
      proposalFingerprint, requestFingerprint, result: Object.freeze(result),
      virtualEffect, samLabel: entry.samLabel, mode: "SHADOW",
      liveApprovalHmac: null, orderIntent: null, queueMutation: null, cashReservation: null,
    });
  });
}
