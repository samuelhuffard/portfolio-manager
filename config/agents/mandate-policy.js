/**
 * Shared deterministic research-policy configuration for specialist Agents 1–3.
 *
 * The interface and lifecycle phases are identical. Only the mandate adapter
 * values differ. This module grants no proposal, approval, execution, ledger, or
 * broker authority; callers must still use the existing supervised pipeline.
 */

export const MANDATE_POLICY_VERSION = "specialist-mandate-policy-v1";

const COMMON_ENTRY_EVIDENCE = Object.freeze([
  "securityEligible",
  "averageDollarVolume",
  "balanceSheetEntryPass",
  "companyDisclosureState",
  "criticalCredibilityEvent",
  "spyClose",
  "spy200DayAverage",
  "treasuryYieldChangeBps30TradingDays",
]);

const COMMON_HOLDING_EVIDENCE = Object.freeze([
  "lastCompletedSessionAt",
  "lastDailyMonitorAt",
  "lastWeeklyRescoreAt",
  "latestEarningsAt",
  "lastEarningsReunderwriteAt",
  "latestMaterialEventAt",
  "lastMaterialEventReunderwriteAt",
  "criticalCredibilityEvent",
]);

const COMMON = Object.freeze({
  evidenceSemantics: Object.freeze({
    requiredRecordFields: Object.freeze(["value", "state", "source", "observedAt", "retrievedAt"]),
    allowedStates: Object.freeze(["fresh", "stale", "unavailable", "unsupported", "policy_unresolved", "conflict", "not_applicable"]),
    actionableState: "fresh",
    missingBehavior: "block",
    staleBehavior: "block",
    conflictBehavior: "block",
    futureEvidenceBehavior: "block",
  }),
  score: Object.freeze({
    minimumAvailablePoints: 80,
    thinPeerConvictionCap: 84,
  }),
  cadence: Object.freeze({
    dailyMonitor: "each_completed_session",
    weeklyRescoreBusinessDays: 5,
    earningsReunderwrite: true,
    materialEventReunderwrite: true,
  }),
});

export const MANDATE_POLICIES = Object.freeze({
  "agent-1": Object.freeze({
    ...COMMON,
    agentId: "agent-1",
    mandateId: "agent_one",
    mandateVersion: "3.0",
    horizon: "days_to_weeks",
    entryEvidence: Object.freeze([
      ...COMMON_ENTRY_EVIDENCE,
      "marketCapitalization",
      "currentPrice",
      "price200DayAverage",
      "entryRelativeVolume30Day",
    ]),
    holdingEvidence: Object.freeze([
      ...COMMON_HOLDING_EVIDENCE,
      "atrFrom20SessionHigh",
      "relativeStrengthBroken",
      "epsTrendImproving",
      "fundamentalFullExitTrigger",
      "momentumDeteriorationTrigger",
      "tradingDaysSinceEntry",
      "thesisProgress",
      "datedCatalystWithin10TradingDays",
      "convictionTierDrop",
    ]),
    score: Object.freeze({
      ...COMMON.score,
      minimumEntryScore: 45,
      tiers: Object.freeze([
        Object.freeze({ min: 85, max: 100, name: "tier_1", targetWeight: Object.freeze([10, 15]) }),
        Object.freeze({ min: 65, max: 84, name: "tier_2", targetWeight: Object.freeze([5, 10]) }),
        Object.freeze({ min: 45, max: 64, name: "tier_3", targetWeight: Object.freeze([2, 5]) }),
      ]),
    }),
    macro: Object.freeze({ dualRedBlocks: true, singleRedTierCap: "tier_2" }),
    entry: Object.freeze({
      minimumAverageDollarVolume: 10_000_000,
      microCapCeiling: 300_000_000,
      microCapMinimumAverageDollarVolume: 3_000_000,
      minimumRelativeVolume: 1.2,
      priceStructure: "above_200_day",
      maximumPositionWeightPct: 15,
      maximumSectorWeightPct: 75,
      minimumAttributedCashReservePct: 5,
    }),
    cadence: Object.freeze({
      ...COMMON.cadence,
      deadTradeReviewTradingDays: 20,
      deadTradeTrimTradingDays: 30,
      deadTradeExitTradingDays: 40,
    }),
    add: Object.freeze({
      averagingDown: "prohibited",
      lifetimeAdds: null,
      maximumPositionWeightPct: 15,
    }),
  }),
  "agent-2": Object.freeze({
    ...COMMON,
    agentId: "agent-2",
    mandateId: "agent_two",
    mandateVersion: "3.0",
    horizon: "weeks_to_two_quarters",
    entryEvidence: Object.freeze([
      ...COMMON_ENTRY_EVIDENCE,
      "marketCapitalization",
      "currentPrice",
      "price50DayAverage",
      "price200DayAverage",
      "entryRelativeVolume30Day",
      "revenueGrowthQuarterlyHistory",
      "epsGrowthQuarterlyHistory",
      "estimateConsensusHistory",
    ]),
    holdingEvidence: Object.freeze([
      ...COMMON_HOLDING_EVIDENCE,
      "consecutiveClosesBelow50Day",
      "relativeStrengthDecliningWeeks",
      "priceBelow200DayAverage",
      "consecutiveRevenueDecelerationQuarters",
      "consecutiveEpsDecelerationQuarters",
      "guidanceTrajectoryReset",
      "quartersFlatOrUnderperformingSpy",
      "datedCatalystPresent",
      "convictionTierDrop",
    ]),
    score: Object.freeze({
      ...COMMON.score,
      minimumEntryScore: 45,
      tiers: Object.freeze([
        Object.freeze({ min: 85, max: 100, name: "tier_1", targetWeight: Object.freeze([8, 12]) }),
        Object.freeze({ min: 65, max: 84, name: "tier_2", targetWeight: Object.freeze([4, 8]) }),
        Object.freeze({ min: 45, max: 64, name: "tier_3", targetWeight: Object.freeze([2, 4]) }),
      ]),
    }),
    macro: Object.freeze({ dualRedBlocks: true, singleRedTierCap: "tier_2" }),
    entry: Object.freeze({
      minimumMarketCapitalization: 300_000_000,
      minimumAverageDollarVolume: 10_000_000,
      minimumRelativeVolume: 1.2,
      priceStructure: "price_above_50_and_200_and_50_above_200",
      maximumPositionWeightPct: 12,
      maximumSectorWeightPct: 60,
      minimumAttributedCashReservePct: 5,
      minimumPositiveRevenueQuartersOfFour: 3,
      minimumEpsHistoryQuarters: 2,
      minimumEstimateSnapshots: 3,
      minimumEstimateHistoryDays: 30,
    }),
    cadence: COMMON.cadence,
    add: Object.freeze({
      averagingDown: "prohibited",
      lifetimeAdds: null,
      maximumPositionWeightPct: 12,
    }),
  }),
  "agent-3": Object.freeze({
    ...COMMON,
    agentId: "agent-3",
    mandateId: "agent_three",
    mandateVersion: "3.0",
    horizon: "years",
    entryEvidence: Object.freeze([
      ...COMMON_ENTRY_EVIDENCE,
      "valuationCascade",
    ]),
    holdingEvidence: Object.freeze([
      ...COMMON_HOLDING_EVIDENCE,
      "lastAnnualReunderwriteAt",
      "structuralFullExitTrigger",
      "businessEvidenceScoreExValuation",
      "currentWeightPct",
      "valuationHistoricalPercentile",
    ]),
    score: Object.freeze({
      ...COMMON.score,
      minimumEntryScore: 65,
      tiers: Object.freeze([
        Object.freeze({ min: 85, max: 100, name: "tier_1", targetWeight: Object.freeze([10, 15]) }),
        Object.freeze({ min: 65, max: 84, name: "tier_2", targetWeight: Object.freeze([5, 10]) }),
      ]),
    }),
    macro: Object.freeze({ dualRedBlocks: false, singleRedTierCap: null }),
    entry: Object.freeze({
      minimumAverageDollarVolume: 10_000_000,
      minimumValuationFraction: 0.5,
      thinPeerMinimumValuationFraction: 0.75,
      maximumPositionWeightPct: 15,
      maximumSectorWeightPct: 60,
      minimumAttributedCashReservePct: null,
    }),
    cadence: Object.freeze({
      ...COMMON.cadence,
      annualReunderwriteDays: 365,
    }),
    add: Object.freeze({
      averagingDown: "controlled_exception",
      lifetimeAdds: 1,
      maximumPositionWeightPct: 15,
      minimumFreshReunderwriteScore: 65,
    }),
  }),
});

export function mandatePolicyFor(agentId) {
  const policy = MANDATE_POLICIES[agentId];
  if (!policy) throw new Error(`Unknown specialist mandate agent: ${agentId}`);
  return policy;
}
