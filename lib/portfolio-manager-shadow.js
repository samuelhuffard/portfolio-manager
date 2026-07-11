import { createHash } from "node:crypto";
import {
  PORTFOLIO_DECISION_REASON_CODES,
  PORTFOLIO_MANAGER_ID,
  PortfolioDecisionSchema,
  PortfolioReviewRequestSchema,
} from "../contracts/portfolio-decision.js";

const REASON_ORDER = new Map(PORTFOLIO_DECISION_REASON_CODES.map((code, index) => [code, index]));
const EPSILON = 1e-8;

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])])
    );
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

export function fingerprintStructuredValue(value) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export function fingerprintStrategyProposal(proposal) {
  return fingerprintStructuredValue(proposal);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function percentOf(amount, total) {
  return (amount / total) * 100;
}

function budgetChangePct(current, previous, portfolioEquity) {
  return percentOf(Math.abs(current - previous), portfolioEquity);
}

function makeDecision({ request, proposal, outcome, reasons, explanation }) {
  const proposalFingerprint = fingerprintStrategyProposal(proposal);
  const allocationSnapshotFingerprint = fingerprintStructuredValue(request.allocationSnapshot);
  const portfolioSnapshotFingerprint = fingerprintStructuredValue(request.portfolioSnapshot);
  const decisionFingerprint = fingerprintStructuredValue({
    proposalId: request.proposalId,
    proposalFingerprint,
    policyVersion: request.policy.version,
    allocationSnapshotFingerprint,
    portfolioSnapshotFingerprint,
    decidedAt: request.decidedAt,
  });
  const decision = PortfolioDecisionSchema.parse({
    id: `shadow:${request.proposalId}:${decisionFingerprint.slice(0, 16)}`,
    proposalId: request.proposalId,
    managerAgentId: PORTFOLIO_MANAGER_ID,
    mode: "SHADOW",
    outcome,
    reasonCodes: reasons,
    explanation,
    proposalFingerprint,
    allocationSnapshotFingerprint,
    portfolioSnapshotFingerprint,
    proposalSnapshot: structuredClone(proposal),
    allocationSnapshotId: request.allocationSnapshot.id,
    portfolioSnapshotId: request.portfolioSnapshot.id,
    policyVersion: request.policy.version,
    decidedAt: request.decidedAt,
    liveApprovalHmac: null,
    orderIntent: null,
  });
  return deepFreeze(decision);
}

function invalidDecision(rawRequest, message) {
  const proposal = rawRequest?.specialistProposal;
  if (!proposal || typeof proposal !== "object") {
    return deepFreeze({
      outcome: "REJECT",
      reasonCodes: ["REJECT_INVALID_INPUT"],
      explanation: [message],
      mode: "SHADOW",
      liveApprovalHmac: null,
      orderIntent: null,
    });
  }

  // A malformed proposal cannot satisfy PortfolioDecisionSchema. Return a
  // deliberately minimal fail-closed result rather than fabricating fields.
  return deepFreeze({
    proposalId: typeof rawRequest.proposalId === "string" ? rawRequest.proposalId : null,
    outcome: "REJECT",
    reasonCodes: ["REJECT_INVALID_INPUT"],
    explanation: [message],
    proposalSnapshot: structuredClone(proposal),
    mode: "SHADOW",
    liveApprovalHmac: null,
    orderIntent: null,
  });
}

/**
 * Pure, deterministic Agent 4 shadow evaluation. All state and time are explicit
 * inputs. It neither persists nor signs nor schedules nor calls a model.
 */
export function evaluateShadowPortfolioDecision(rawRequest) {
  const parsed = PortfolioReviewRequestSchema.safeParse(rawRequest);
  if (!parsed.success) {
    return invalidDecision(rawRequest, `Review request failed contract validation: ${parsed.error.issues[0]?.message ?? "invalid input"}`);
  }

  const request = parsed.data;
  const proposal = request.specialistProposal;
  const reasons = new Set();
  const explanations = [];
  const reject = (code, explanation) => {
    reasons.add(code);
    explanations.push(explanation);
  };

  if (request.originatorId === PORTFOLIO_MANAGER_ID) {
    reject("REJECT_MANAGER_ORIGINATED", "Agent 4 cannot originate a specialist proposal.");
  } else if (request.originatorId !== proposal.agentId) {
    reject("REJECT_ORIGIN_MISMATCH", "The declared originator does not match the specialist proposal owner.");
  }

  if (canonicalJson(proposal) !== canonicalJson(request.reviewedProposal)) {
    reject("REJECT_PROPOSAL_MUTATED", "Agent 4 must accept or reject the specialist proposal without changing it.");
  }

  if (request.allocationSnapshot.policyVersion !== request.policy.version) {
    reject("REJECT_POLICY_VERSION_MISMATCH", "The allocation snapshot was produced under a different policy version.");
  }
  if (request.portfolioSnapshot.policyVersion !== request.policy.version) {
    reject("REJECT_POLICY_VERSION_MISMATCH", "The portfolio snapshot was produced under a different policy version.");
  }
  if (Math.abs(request.allocationSnapshot.portfolioEquityDollars - request.portfolioSnapshot.portfolioEquityDollars) > EPSILON) {
    reject("REJECT_ALLOCATION_SNAPSHOT_MISMATCH", "Allocation and portfolio snapshots disagree on portfolio equity.");
  }
  if (Date.parse(request.policy.effectiveAt) > Date.parse(request.decidedAt)) {
    reject("REJECT_POLICY_VERSION_MISMATCH", "The policy was not yet effective at the decision time.");
  }
  if (Date.parse(request.allocationSnapshot.capturedAt) > Date.parse(request.decidedAt)) {
    reject("REJECT_ALLOCATION_SNAPSHOT_MISMATCH", "The allocation snapshot is later than the decision time.");
  }
  if (Date.parse(request.portfolioSnapshot.capturedAt) > Date.parse(request.decidedAt)) {
    reject("REJECT_PORTFOLIO_SNAPSHOT_MISMATCH", "The portfolio snapshot is later than the decision time.");
  }
  const allocationAgeMs = Date.parse(request.decidedAt) - Date.parse(request.allocationSnapshot.capturedAt);
  if (allocationAgeMs > request.policy.maxAllocationSnapshotAgeMinutes * 60_000) {
    reject("REJECT_ALLOCATION_SNAPSHOT_MISMATCH", "The allocation snapshot is stale under the active policy.");
  }
  const portfolioAgeMs = Date.parse(request.decidedAt) - Date.parse(request.portfolioSnapshot.capturedAt);
  if (portfolioAgeMs > request.policy.maxPortfolioSnapshotAgeMinutes * 60_000) {
    reject("REJECT_PORTFOLIO_SNAPSHOT_MISMATCH", "The portfolio risk snapshot is stale under the active policy.");
  }

  const budget = request.allocationSnapshot.budgets.find((row) => row.agentId === proposal.agentId);
  if (!budget) {
    reject("REJECT_ALLOCATION_SNAPSHOT_MISMATCH", "No strategy budget exists for the specialist.");
  } else {
    const evidenceWindowMs = Date.parse(budget.evidenceWindowEnd) - Date.parse(budget.evidenceWindowStart);
    if (
      Date.parse(budget.evidenceWindowEnd) > Date.parse(request.allocationSnapshot.capturedAt) ||
      evidenceWindowMs > request.policy.evidenceWindowDays * 24 * 60 * 60 * 1000 + EPSILON ||
      budget.evaluatedProposalCount < request.policy.minEvaluatedProposals ||
      budget.filledTradeCount < request.policy.minFilledTrades
    ) {
      reject("REJECT_EVIDENCE_MINIMUM_NOT_MET", "The strategy does not satisfy the policy's evidence window and sample minimums.");
    }
    if (percentOf(budget.budgetDollars, request.allocationSnapshot.portfolioEquityDollars) > request.policy.maxStrategyAllocationPct + EPSILON) {
      reject("REJECT_STRATEGY_BUDGET_EXCEEDED", "The strategy budget itself exceeds the policy allocation cap.");
    }
    if (
      budgetChangePct(
        budget.budgetDollars,
        budget.previousBudgetDollars,
        request.allocationSnapshot.portfolioEquityDollars
      ) > request.policy.maxBudgetChangePct + EPSILON
    ) {
      reject("REJECT_STRATEGY_BUDGET_EXCEEDED", "The strategy budget change exceeds the policy change cap.");
    }
  }

  if (proposal.amountDollars > request.policy.maxSingleProposalDollars + EPSILON) {
    reject("REJECT_SINGLE_PROPOSAL_LIMIT", "The exact proposal exceeds the policy's per-proposal dollar limit.");
  }

  if (proposal.side === "SELL") {
    const ownership = new Map(request.sellLotOwnership.map((lot) => [lot.lotId, lot]));
    const unowned = proposal.citedLotIds.some((lotId) => {
      const lot = ownership.get(lotId);
      return !lot || lot.ownerAgentId !== proposal.agentId || lot.ticker !== proposal.ticker;
    });
    if (unowned) {
      reject("REJECT_UNOWNED_SELL", "Every cited SELL lot must exist and be owned by the proposing specialist for the same ticker.");
    }
  } else {
    if (budget && budget.allocatedDollars + proposal.amountDollars > budget.budgetDollars + EPSILON) {
      reject("REJECT_STRATEGY_BUDGET_EXCEEDED", "The BUY would exceed the specialist's available virtual budget.");
    }

    const equity = request.portfolioSnapshot.portfolioEquityDollars;
    const remainingCash = request.portfolioSnapshot.cashAvailableDollars - proposal.amountDollars;
    if (remainingCash < -EPSILON || percentOf(Math.max(remainingCash, 0), equity) + EPSILON < request.policy.minCashReservePct) {
      reject("REJECT_CASH_RESERVE_LIMIT", "The BUY would breach the policy's cash reserve floor.");
    }

    const projectedGross = request.portfolioSnapshot.grossExposureDollars + proposal.amountDollars;
    if (percentOf(projectedGross, equity) > request.policy.maxGrossExposurePct + EPSILON) {
      reject("REJECT_GROSS_EXPOSURE_LIMIT", "The BUY would breach the policy's gross exposure cap.");
    }

    const tickerExposure = request.portfolioSnapshot.tickerExposures.find((row) => row.ticker === proposal.ticker)?.marketValueDollars ?? 0;
    if (percentOf(tickerExposure + proposal.amountDollars, equity) > request.policy.maxTickerExposurePct + EPSILON) {
      reject("REJECT_TICKER_CONCENTRATION_LIMIT", "The BUY would breach the policy's ticker concentration cap.");
    }
  }

  const orderedReasons = [...reasons].sort((a, b) => REASON_ORDER.get(a) - REASON_ORDER.get(b));
  if (orderedReasons.length > 0) {
    return makeDecision({ request, proposal, outcome: "REJECT", reasons: orderedReasons, explanation: explanations });
  }
  return makeDecision({
    request,
    proposal,
    outcome: "ACCEPT",
    reasons: ["ACCEPT_WITHIN_POLICY_BOUNDS"],
    explanation: ["The exact specialist proposal is within the supplied shadow policy bounds."],
  });
}
