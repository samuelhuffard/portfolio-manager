import { randomUUID } from "node:crypto";
import { getActiveShadowAllocationPolicy, persistPortfolioManagerShadowReview } from "./portfolio-manager-shadow-store.js";

const HORIZON_DAYS = Object.freeze({
  "agent-1": 30,
  "agent-2": 90,
  "agent-3": 365,
});

const SPECIALIST_IDS = Object.freeze(["agent-1", "agent-2", "agent-3"]);

function dollars(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number * 100) / 100 : 0;
}

function iso(value) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function allocationByAgent(lots, holdings) {
  const holdingsByTicker = new Map(holdings.map((holding) => [holding.ticker, holding]));
  const result = Object.fromEntries(SPECIALIST_IDS.map((id) => [id, 0]));
  for (const lot of lots) {
    if (!SPECIALIST_IDS.includes(lot.agentId) || lot.status !== "OPEN" || !(lot.sharesOpen > 0)) continue;
    const holding = holdingsByTicker.get(lot.ticker);
    if (!holding || !(holding.shares > 0) || !(holding.marketValue > 0)) continue;
    result[lot.agentId] += holding.marketValue * (lot.sharesOpen / holding.shares);
  }
  return Object.fromEntries(Object.entries(result).map(([agentId, value]) => [agentId, dollars(value)]));
}

/**
 * Builds an Agent 4 review request from the proposal just persisted by the
 * existing specialist pipeline. This is an observer only: it has no proposal
 * writer, approval signature, order intent, or broker dependency.
 */
export function buildAgent4ShadowReviewRequest({ proposal, recommendation, context, policy, now = new Date() }) {
  const decidedAt = iso(now);
  const equity = dollars(context.totalPortfolioValue);
  if (!(equity > 0)) throw new Error("Agent 4 shadow review requires a positive portfolio equity snapshot.");

  const lots = context.lots ?? [];
  const holdings = context.heldAllocation ?? [];
  const allocated = allocationByAgent(lots, holdings);
  const equalBudget = dollars(equity / SPECIALIST_IDS.length);
  const citedLots = proposal.side === "SELL"
    ? lots.filter((lot) => lot.agentId === proposal.agentId && lot.ticker === proposal.ticker && lot.status === "OPEN" && lot.sharesOpen > 0)
    : [];
  const specialistProposal = {
    intentId: `proposal:${proposal.id}`,
    agentId: proposal.agentId,
    ticker: proposal.ticker,
    side: proposal.side,
    amountDollars: proposal.amountDollars,
    maxPrice: proposal.maxPrice,
    thesis: recommendation.thesis,
    killCriteria: recommendation.killCriteria,
    horizonDays: HORIZON_DAYS[proposal.agentId] ?? null,
    evidenceSnapshotId: `proposal:${proposal.id}:queue`,
    citedLotIds: citedLots.map((lot) => lot.lotId),
  };
  const capturedAt = decidedAt;
  return {
    proposalId: proposal.id,
    originatorId: proposal.agentId,
    specialistProposal,
    reviewedProposal: structuredClone(specialistProposal),
    policy,
    allocationSnapshot: {
      id: `allocation:${proposal.id}:${randomUUID()}`,
      policyVersion: policy.version,
      capturedAt,
      portfolioEquityDollars: equity,
      budgets: SPECIALIST_IDS.map((agentId) => ({
        agentId,
        budgetDollars: equalBudget,
        allocatedDollars: allocated[agentId],
        previousBudgetDollars: equalBudget,
        // Agent 4 begins with no claimed performance evidence. Later score and
        // outcome work replaces these zeroes with point-in-time measurements.
        evaluatedProposalCount: 0,
        filledTradeCount: 0,
        evidenceWindowStart: new Date(Date.parse(capturedAt) - policy.evidenceWindowDays * 86_400_000).toISOString(),
        evidenceWindowEnd: capturedAt,
      })),
    },
    portfolioSnapshot: {
      id: `portfolio:${proposal.id}:${randomUUID()}`,
      policyVersion: policy.version,
      capturedAt,
      portfolioEquityDollars: equity,
      // The queued proposal is not reserved in this pre-decision snapshot; the
      // evaluator tests whether accepting this exact amount would remain safe.
      cashAvailableDollars: dollars(context.cashAvailableBeforeProposal),
      grossExposureDollars: dollars(holdings.reduce((sum, holding) => sum + dollars(holding.marketValue), 0)),
      tickerExposures: holdings
        .filter((holding) => holding.ticker && dollars(holding.marketValue) > 0)
        .map((holding) => ({ ticker: holding.ticker, marketValueDollars: dollars(holding.marketValue) })),
    },
    sellLotOwnership: citedLots.map((lot) => ({
      lotId: lot.lotId,
      ticker: lot.ticker,
      ownerAgentId: lot.agentId,
      sharesOpen: lot.sharesOpen,
    })),
    decidedAt,
  };
}

/** Persist an Agent 4 shadow observation when the reviewed policy is active. */
export async function recordAgent4ShadowReview(input) {
  if (!Array.isArray(input.context?.lots)) return { status: "ownership_snapshot_unavailable" };
  const policy = await getActiveShadowAllocationPolicy();
  if (!policy) return { status: "not_configured" };
  const request = buildAgent4ShadowReviewRequest({ ...input, policy });
  const decision = await persistPortfolioManagerShadowReview(request);
  return { status: "recorded", decision };
}
