// CANONICAL — edit here only. Mirrored to portfolio-dashboard/lib/contracts/ by
// `npm run contracts:sync`; the dashboard's contracts-drift test enforces equality.
//
// Additive, shadow-only Agent 4 contracts. These shapes deliberately contain no
// order authorization or live approval signature. Agent 4 reviews an immutable
// specialist StrategyProposal and may only ACCEPT or REJECT that exact proposal.

import { z } from "zod";
import { AGENT_IDS, AgentIdSchema, TICKER_RE } from "./proposal.js";
import { StrategyProposalSchema } from "./pipeline.js";

export const PORTFOLIO_MANAGER_ID = "agent-4";
export const PORTFOLIO_SHADOW_KEYS = Object.freeze({
  decisionIndex: "pm:portfolio-decisions:index",
  decisionPrefix: "pm:portfolio-decision:",
  policyActive: "pm:allocation-policy:active",
  policyPrefix: "pm:allocation-policy:",
  allocationLatest: "pm:allocation-snapshot:latest",
  allocationPrefix: "pm:allocation-snapshot:",
  riskLatest: "pm:portfolio-risk-snapshot:latest",
  riskPrefix: "pm:portfolio-risk-snapshot:",
});
export const PORTFOLIO_DECISIONS = ["ACCEPT", "REJECT"];
export const PORTFOLIO_DECISION_REASON_CODES = [
  "ACCEPT_WITHIN_POLICY_BOUNDS",
  "REJECT_INVALID_INPUT",
  "REJECT_MANAGER_ORIGINATED",
  "REJECT_ORIGIN_MISMATCH",
  "REJECT_PROPOSAL_MUTATED",
  "REJECT_POLICY_VERSION_MISMATCH",
  "REJECT_ALLOCATION_SNAPSHOT_MISMATCH",
  "REJECT_PORTFOLIO_SNAPSHOT_MISMATCH",
  "REJECT_EVIDENCE_MINIMUM_NOT_MET",
  "REJECT_SINGLE_PROPOSAL_LIMIT",
  "REJECT_STRATEGY_BUDGET_EXCEEDED",
  "REJECT_CASH_RESERVE_LIMIT",
  "REJECT_GROSS_EXPOSURE_LIMIT",
  "REJECT_TICKER_CONCENTRATION_LIMIT",
  "REJECT_UNOWNED_SELL",
];

const Iso = z.string().datetime({ offset: true });
const Dollars = z.number().finite().nonnegative();
const Percentage = z.number().finite().min(0).max(100);

export const PortfolioDecisionOutcomeSchema = z.enum(PORTFOLIO_DECISIONS);
export const PortfolioDecisionReasonCodeSchema = z.enum(PORTFOLIO_DECISION_REASON_CODES);

/**
 * Hard bounds supplied by a separately approved, versioned policy. The schema
 * validates only safe numeric ranges; it does not choose an investment policy.
 */
export const AllocationPolicySchema = z.object({
  version: z.string().min(1),
  mode: z.literal("SHADOW"),
  effectiveAt: Iso,
  maxSingleProposalDollars: z.number().finite().positive(),
  maxStrategyAllocationPct: Percentage,
  maxTickerExposurePct: Percentage,
  minCashReservePct: Percentage,
  maxGrossExposurePct: Percentage,
  maxBudgetChangePct: Percentage,
  evidenceWindowDays: z.number().int().positive(),
  maxAllocationSnapshotAgeMinutes: z.number().int().positive().max(10_080),
  maxPortfolioSnapshotAgeMinutes: z.number().int().positive().max(1_440),
  minEvaluatedProposals: z.number().int().nonnegative(),
  minFilledTrades: z.number().int().nonnegative(),
});

export const StrategyBudgetSchema = z.object({
  agentId: AgentIdSchema,
  budgetDollars: Dollars,
  allocatedDollars: Dollars,
  previousBudgetDollars: Dollars,
  evaluatedProposalCount: z.number().int().nonnegative(),
  filledTradeCount: z.number().int().nonnegative(),
  evidenceWindowStart: Iso,
  evidenceWindowEnd: Iso,
}).superRefine((budget, ctx) => {
  if (budget.allocatedDollars > budget.budgetDollars) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Strategy allocatedDollars cannot exceed budgetDollars.",
    });
  }
  if (Date.parse(budget.evidenceWindowStart) > Date.parse(budget.evidenceWindowEnd)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Strategy evidence window start cannot follow its end.",
    });
  }
});

/** Versioned virtual budgets. No money is moved by this object. */
export const AllocationSnapshotSchema = z.object({
  id: z.string().min(1),
  policyVersion: z.string().min(1),
  capturedAt: Iso,
  portfolioEquityDollars: z.number().finite().positive(),
  budgets: z.array(StrategyBudgetSchema).length(AGENT_IDS.length),
}).superRefine((snapshot, ctx) => {
  const ids = snapshot.budgets.map((budget) => budget.agentId);
  if (new Set(ids).size !== ids.length || AGENT_IDS.some((id) => !ids.includes(id))) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "AllocationSnapshot must contain exactly one budget for every specialist agent.",
    });
  }
});

export const TickerExposureSchema = z.object({
  ticker: z.string().regex(TICKER_RE),
  marketValueDollars: Dollars,
});

/** Minimal deterministic portfolio state needed to apply hard allocation caps. */
export const PortfolioRiskSnapshotSchema = z.object({
  id: z.string().min(1),
  policyVersion: z.string().min(1),
  capturedAt: Iso,
  portfolioEquityDollars: z.number().finite().positive(),
  cashAvailableDollars: Dollars,
  grossExposureDollars: Dollars,
  tickerExposures: z.array(TickerExposureSchema),
}).superRefine((snapshot, ctx) => {
  const tickers = snapshot.tickerExposures.map((row) => row.ticker);
  if (new Set(tickers).size !== tickers.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Ticker exposures must be unique." });
  }
});

/** Minimal lot evidence used only to prove a specialist owns every cited SELL lot. */
export const SellLotOwnershipSchema = z.object({
  lotId: z.string().min(1),
  ticker: z.string().regex(TICKER_RE),
  ownerAgentId: z.union([AgentIdSchema, z.literal("unattributed")]),
  sharesOpen: z.number().finite().positive(),
});

/**
 * The review request carries both the specialist proposal and the exact proposal
 * presented for decision. Any difference is an attempted mutation and fails
 * closed. originatorId includes Agent 4 so self-origin attempts produce a
 * recorded rejection instead of merely becoming an unparseable request.
 */
export const PortfolioReviewRequestSchema = z.object({
  proposalId: z.string().min(1),
  originatorId: z.union([AgentIdSchema, z.literal(PORTFOLIO_MANAGER_ID)]),
  specialistProposal: StrategyProposalSchema,
  reviewedProposal: StrategyProposalSchema,
  policy: AllocationPolicySchema,
  allocationSnapshot: AllocationSnapshotSchema,
  portfolioSnapshot: PortfolioRiskSnapshotSchema,
  sellLotOwnership: z.array(SellLotOwnershipSchema).default([]),
  decidedAt: Iso,
});

/**
 * Shadow decision record. `liveApprovalHmac` and `orderIntent` are required to
 * be null so this additive foundation cannot accidentally enter execution.
 */
export const PortfolioDecisionSchema = z.object({
  id: z.string().min(1),
  proposalId: z.string().min(1),
  managerAgentId: z.literal(PORTFOLIO_MANAGER_ID),
  mode: z.literal("SHADOW"),
  outcome: PortfolioDecisionOutcomeSchema,
  reasonCodes: z.array(PortfolioDecisionReasonCodeSchema).min(1),
  explanation: z.array(z.string().min(1)).min(1),
  proposalFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  allocationSnapshotFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  portfolioSnapshotFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  proposalSnapshot: StrategyProposalSchema,
  allocationSnapshotId: z.string().min(1),
  portfolioSnapshotId: z.string().min(1),
  policyVersion: z.string().min(1),
  decidedAt: Iso,
  liveApprovalHmac: z.null(),
  orderIntent: z.null(),
});

/**
 * @typedef {z.infer<typeof AllocationPolicySchema>} AllocationPolicy
 * @typedef {z.infer<typeof AllocationSnapshotSchema>} AllocationSnapshot
 * @typedef {z.infer<typeof PortfolioRiskSnapshotSchema>} PortfolioRiskSnapshot
 * @typedef {z.infer<typeof PortfolioDecisionSchema>} PortfolioDecision
 */
