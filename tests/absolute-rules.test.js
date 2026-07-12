import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateCondition, scoreAbsoluteRuleTable, scoreAbsoluteEvidence } from "../lib/absolute-rules.js";
import { ABSOLUTE_RULE_TABLES, SPECIAL_SECTOR_RULE_TABLES, absoluteRuleTableFor } from "../config/scoring/absolute-thresholds.js";
import { AGENT_SCORING } from "../config/scoring/mandate-v2.js";

const fraction = (agentId, metricId, input) => scoreAbsoluteRuleTable(input, ABSOLUTE_RULE_TABLES[agentId][metricId]).fraction;

test("condition evaluator supports nested all/any and preserves unknown evidence", () => {
  const condition = { all: [{ field: "a", gte: 2 }, { any: [{ field: "b", eq: true }, { field: "c", lt: 0 }] }] };
  assert.equal(evaluateCondition({ a: 2, b: true }, condition), true);
  assert.equal(evaluateCondition({ a: 1 }, condition), false);
  assert.equal(evaluateCondition({ a: 2 }, condition), null);
});

test("a missing higher-band input fails closed instead of falling through", () => {
  const table = { rules: [
    { fraction: 1, when: { all: [{ field: "growth", gte: 20 }, { field: "accel", gte: 5 }] } },
    { fraction: 0.5, when: { field: "growth", gte: 10 } },
  ] };
  assert.deepEqual(scoreAbsoluteRuleTable({ growth: 25 }, table), { fraction: null, missing: true, matchedBand: null });
  assert.equal(scoreAbsoluteRuleTable({ growth: 25, accel: 1 }, table).fraction, 0.5);
});

test("all standard non-valuation mandate metrics have executable tables", () => {
  for (const agentId of ["agent-1", "agent-2", "agent-3"]) {
    const expected = Object.values(AGENT_SCORING[agentId].categories)
      .flatMap((category) => Object.keys(category.metrics))
      .filter((metric) => metric !== "peerValuation")
      .sort();
    assert.deepEqual(Object.keys(ABSOLUTE_RULE_TABLES[agentId]).sort(), expected, agentId);
  }
});

test("Agent One scalar and acceleration boundaries match §5", () => {
  assert.deepEqual([5, 2, 0, -0.01].map((beatPct) => fraction("agent-1", "revBeat", { beatPct })), [1, 0.75, 0.5, 0]);
  assert.deepEqual([
    { currentGrowthPct: 20, accelerationPoints: 5 },
    { currentGrowthPct: 15, accelerationPoints: 2 },
    { currentGrowthPct: 10, accelerationPoints: 0 },
    { currentGrowthPct: 20, accelerationPoints: -0.01 },
  ].map((x) => fraction("agent-1", "revGrowth", x)), [1, 0.75, 0.5, 0]);
  assert.deepEqual([
    { epsGrowthPct: 20, accelerationPoints: 5 },
    { epsGrowthPct: 15, accelerationPoints: 2 },
    { epsGrowthPct: 10, accelerationPoints: 0 },
    { epsGrowthPct: -0.01, accelerationPoints: 0 },
  ].map((x) => fraction("agent-1", "epsTrajectory", x)), [1, 0.75, 0.5, 0]);
});

test("Agent One revisions, margins, balance sheet, ownership and 13F match §5", () => {
  assert.deepEqual([
    { consensusChangePct: 5, positiveNegativeRatio: 2, positiveBreadthPct: 70 },
    { consensusChangePct: 2, positiveNegativeRatio: 1, positiveBreadthPct: 60 },
    { consensusChangePct: 0, positiveNegativeRatio: 1, positiveBreadthPct: 50 },
    { consensusChangePct: -0.01, positiveNegativeRatio: 0, positiveBreadthPct: 40 },
  ].map((x) => fraction("agent-1", "estimateRevisions", x)), [1, 0.75, 0.5, 0]);
  assert.deepEqual([200, 100, -99, -100].map((marginChangeBps) => fraction("agent-1", "marginTrend", { marginChangeBps, documentedInvestmentExplanation: false })), [1, 0.75, 0.5, 0]);
  assert.deepEqual([
    { isProfitable: true, isPreProfit: false, netCash: true, netDebtEbitda: 0, interestCoverage: 9 },
    { isProfitable: true, isPreProfit: false, netCash: false, netDebtEbitda: 1, interestCoverage: 6 },
    { isProfitable: true, isPreProfit: false, netCash: false, netDebtEbitda: 2.5, interestCoverage: 4 },
    { isProfitable: true, isPreProfit: false, netCash: false, netDebtEbitda: 3.1, interestCoverage: 2.9 },
  ].map((x) => fraction("agent-1", "balanceSheet", x)), [1, 0.75, 0.5, 0]);
  assert.deepEqual([
    { ownershipChangePoints: 5, clearMultiQuarterAccumulation: false },
    { ownershipChangePoints: 2, clearMultiQuarterAccumulation: false },
    { ownershipChangePoints: 0, clearMultiQuarterAccumulation: false },
    { ownershipChangePoints: -2.1, clearMultiQuarterAccumulation: false },
  ].map((x) => fraction("agent-1", "instOwnershipDir", x)), [1, 0.75, 0.5, 0]);
  assert.deepEqual([
    { usableQuarters: 2, latestQuarterChangePct: 3, priorQuarterChangePct: 2, cumulativeTwoQuarterChangePct: 5 },
    { usableQuarters: 1, latestQuarterChangePct: 5, priorQuarterChangePct: null, cumulativeTwoQuarterChangePct: 5 },
    { usableQuarters: 2, latestQuarterChangePct: 0, priorQuarterChangePct: 0, cumulativeTwoQuarterChangePct: 0 },
    { usableQuarters: 2, latestQuarterChangePct: -2.1, priorQuarterChangePct: 0, cumulativeTwoQuarterChangePct: -2.1 },
  ].map((x) => fraction("agent-1", "thirteenF", x)), [1, 0.75, 0.5, 0]);
});

test("Agent Two persistence-specific bands match §5", () => {
  assert.deepEqual([
    { beatsInLatestThree: 3, minimumBeatPct: 2, latestBeatPct: 2, missesInLatestThree: 0 },
    { beatsInLatestThree: 2, minimumBeatPct: 0, latestBeatPct: 2, missesInLatestThree: 1 },
    { beatsInLatestThree: 2, minimumBeatPct: 0, latestBeatPct: 0, missesInLatestThree: 1 },
    { beatsInLatestThree: 1, minimumBeatPct: -1, latestBeatPct: -0.1, missesInLatestThree: 2 },
  ].map((x) => fraction("agent-2", "revBeat", x)), [1, 0.75, 0.5, 0]);
  assert.deepEqual([
    { currentGrowthPct: 20, positiveQuartersInLatestFour: 3, positiveMultiQuarterPersistence: true, nonDecelerating: true, consecutiveMaterialDecelerations: 0 },
    { currentGrowthPct: 15, positiveQuartersInLatestFour: 2, positiveMultiQuarterPersistence: true, nonDecelerating: true, consecutiveMaterialDecelerations: 0 },
    { currentGrowthPct: 10, positiveQuartersInLatestFour: 2, positiveMultiQuarterPersistence: true, nonDecelerating: true, consecutiveMaterialDecelerations: 0 },
    { currentGrowthPct: 9.9, positiveQuartersInLatestFour: 2, positiveMultiQuarterPersistence: false, nonDecelerating: false, consecutiveMaterialDecelerations: 2 },
  ].map((x) => fraction("agent-2", "revGrowth", x)), [1, 0.75, 0.5, 0]);
  assert.deepEqual([
    { epsGrowthPct: 20, consecutiveQualifyingQuarters: 2, nonDecelerating: true, consecutiveDeterioratingQuarters: 0 },
    { epsGrowthPct: 15, consecutiveQualifyingQuarters: 2, nonDecelerating: false, consecutiveDeterioratingQuarters: 1 },
    { epsGrowthPct: 10, consecutiveQualifyingQuarters: 1, nonDecelerating: false, consecutiveDeterioratingQuarters: 1 },
    { epsGrowthPct: -1, consecutiveQualifyingQuarters: 0, nonDecelerating: false, consecutiveDeterioratingQuarters: 2 },
  ].map((x) => fraction("agent-2", "epsTrajectory", x)), [1, 0.75, 0.5, 0]);
});

test("Agent Two revision windows match §5", () => {
  assert.deepEqual([
    { consensusChangePct60d: 5, positiveBreadthPct: 70, net30dReversal: false },
    { consensusChangePct60d: 2, positiveBreadthPct: 60, net30dReversal: true },
    { consensusChangePct60d: 0, positiveBreadthPct: 50, net30dReversal: true },
    { consensusChangePct60d: -0.1, positiveBreadthPct: 40, net30dReversal: true },
  ].map((x) => fraction("agent-2", "estimateRevisions", x)), [1, 0.75, 0.5, 0]);
});

test("Agent Three long-horizon revenue and EPS bands match §5", () => {
  assert.deepEqual([
    { revenueCagr3yPct: 15, positiveGrowthYears: 3, minimumAnnualGrowthPct: 10, maxAnnualGrowthSpreadPoints: 15, volatileYears: 0, negativeGrowthYears: 0, materiallyErraticGrowth: false },
    { revenueCagr3yPct: 10, positiveGrowthYears: 3, minimumAnnualGrowthPct: 5, maxAnnualGrowthSpreadPoints: 20, volatileYears: 0, negativeGrowthYears: 0, materiallyErraticGrowth: false },
    { revenueCagr3yPct: 5, positiveGrowthYears: 2, minimumAnnualGrowthPct: 0, maxAnnualGrowthSpreadPoints: 20, volatileYears: 1, negativeGrowthYears: 1, materiallyErraticGrowth: false },
    { revenueCagr3yPct: 4.9, positiveGrowthYears: 1, minimumAnnualGrowthPct: -5, maxAnnualGrowthSpreadPoints: 30, volatileYears: 2, negativeGrowthYears: 2, materiallyErraticGrowth: true },
  ].map((x) => fraction("agent-3", "revGrowth", x)), [1, 0.75, 0.5, 0]);
  assert.deepEqual([
    { normalizedEpsCagr3yPct: 15, positiveEpsYears: 3, worstAnnualDeclinePct: -10, positiveCumulativeTrajectory: true, persistentTwoYearDecline: false, persistentDeterioration: false },
    { normalizedEpsCagr3yPct: 10, positiveEpsYears: 2, worstAnnualDeclinePct: -20, positiveCumulativeTrajectory: true, persistentTwoYearDecline: false, persistentDeterioration: false },
    { normalizedEpsCagr3yPct: 5, positiveEpsYears: 2, worstAnnualDeclinePct: -20, positiveCumulativeTrajectory: true, persistentTwoYearDecline: false, persistentDeterioration: false },
    { normalizedEpsCagr3yPct: 4.9, positiveEpsYears: 1, worstAnnualDeclinePct: -30, positiveCumulativeTrajectory: false, persistentTwoYearDecline: true, persistentDeterioration: true },
  ].map((x) => fraction("agent-3", "epsTrajectory", x)), [1, 0.75, 0.5, 0]);
});

test("Agent Three beat, revisions, margins, and balance-sheet bands match §5", () => {
  assert.deepEqual([
    { latestBeatPct: 3, yoyGrowthNonDecelerating: true, positiveYoyGrowth: true, materialDeterioration: false },
    { latestBeatPct: 1, yoyGrowthNonDecelerating: false, positiveYoyGrowth: true, materialDeterioration: false },
    { latestBeatPct: 0, yoyGrowthNonDecelerating: false, positiveYoyGrowth: true, materialDeterioration: false },
    { latestBeatPct: -1.1, yoyGrowthNonDecelerating: false, positiveYoyGrowth: false, materialDeterioration: true },
  ].map((x) => fraction("agent-3", "revBeat", x)), [1, 0.75, 0.5, 0]);
  assert.deepEqual([
    { consensusChangePct90d: 5, positiveBreadthPct: 70, net30dReversal: false },
    { consensusChangePct90d: 2, positiveBreadthPct: 60, net30dReversal: true },
    { consensusChangePct90d: 0, positiveBreadthPct: 50, net30dReversal: true },
    { consensusChangePct90d: -0.1, positiveBreadthPct: 40, net30dReversal: true },
  ].map((x) => fraction("agent-3", "estimateRevisions", x)), [1, 0.75, 0.5, 0]);
  assert.deepEqual([
    { marginChangeBps3y: 200, twoYearContractionSequence: false, documentedStructuralInvestmentExplanation: false },
    { marginChangeBps3y: 100, twoYearContractionSequence: true, documentedStructuralInvestmentExplanation: false },
    { marginChangeBps3y: -99, twoYearContractionSequence: true, documentedStructuralInvestmentExplanation: false },
    { marginChangeBps3y: -100, twoYearContractionSequence: true, documentedStructuralInvestmentExplanation: false },
  ].map((x) => fraction("agent-3", "marginTrend", x)), [1, 0.75, 0.5, 0]);
  assert.deepEqual([
    { latestNetDebtEbitda: 0.5, medianNetDebtEbitda3y: 0.5, latestInterestCoverage: 9, medianInterestCoverage3y: 9, anyYearBelowNextBand: false, materialMultiYearDeterioration: false },
    { latestNetDebtEbitda: 1, medianNetDebtEbitda3y: 1, latestInterestCoverage: 6, medianInterestCoverage3y: 6, anyYearBelowNextBand: true, materialMultiYearDeterioration: false },
    { latestNetDebtEbitda: 2.5, medianNetDebtEbitda3y: 2.5, latestInterestCoverage: 4, medianInterestCoverage3y: 4, anyYearBelowNextBand: true, materialMultiYearDeterioration: false },
    { latestNetDebtEbitda: 3.1, medianNetDebtEbitda3y: 3.1, latestInterestCoverage: 2.9, medianInterestCoverage3y: 2.9, anyYearBelowNextBand: true, materialMultiYearDeterioration: true },
  ].map((x) => fraction("agent-3", "balanceSheet", x)), [1, 0.75, 0.5, 0]);
});

test("absolute evidence converts a matched fraction into mandate points", () => {
  const result = scoreAbsoluteEvidence({ beatPct: 2 }, { points: 10 }, ABSOLUTE_RULE_TABLES["agent-1"].revBeat);
  assert.equal(result.points, 7.5);
  assert.equal(result.method, "absolute");
});

test("Banks special-sector growth, NIM, CET1 and credit-quality bands match §5", () => {
  const bank = SPECIAL_SECTOR_RULE_TABLES.banks;
  assert.deepEqual([10, 6, 2, 1.99].map((bankRevenueGrowthPct) => scoreAbsoluteRuleTable({ bankRevenueGrowthPct }, bank.revGrowth).fraction), [1, 0.75, 0.5, 0]);
  assert.deepEqual([12, 8, 3, 2.99].map((adjustedEpsOrTbvpsGrowthPct) => scoreAbsoluteRuleTable({ adjustedEpsOrTbvpsGrowthPct }, bank.epsTrajectory).fraction), [1, 0.75, 0.5, 0]);
  assert.deepEqual([20, 10, -9, -10].map((netInterestMarginChangeBps) => scoreAbsoluteRuleTable({ netInterestMarginChangeBps }, bank.marginTrend).fraction), [1, 0.75, 0.5, 0]);
  assert.deepEqual([
    { cet1Pct: 12, creditQualityStableOrImproving: true, materialCreditDeterioration: false },
    { cet1Pct: 10.5, creditQualityStableOrImproving: false, materialCreditDeterioration: false },
    { cet1Pct: 9, creditQualityStableOrImproving: false, materialCreditDeterioration: false },
    { cet1Pct: 8.99, creditQualityStableOrImproving: false, materialCreditDeterioration: true },
  ].map((x) => scoreAbsoluteRuleTable(x, bank.balanceSheet).fraction), [1, 0.75, 0.5, 0]);
});

test("Insurers special-sector premium, underwriting, and reserve bands match §5", () => {
  const insurers = SPECIAL_SECTOR_RULE_TABLES.insurers;
  assert.deepEqual([10, 6, 2, 1.99].map((netPremiumGrowthPct) => scoreAbsoluteRuleTable({ netPremiumGrowthPct }, insurers.revGrowth).fraction), [1, 0.75, 0.5, 0]);
  assert.deepEqual([90, 95, 100, 100.01].map((combinedRatioPct) => scoreAbsoluteRuleTable({ combinedRatioApplicable: true, combinedRatioPct }, insurers.epsTrajectory).fraction), [1, 0.75, 0.5, 0]);
  assert.deepEqual([12, 8, 3, 2.99].map((adjustedEpsOrBvpsGrowthPct) => scoreAbsoluteRuleTable({ combinedRatioApplicable: false, adjustedEpsOrBvpsGrowthPct }, insurers.epsTrajectory).fraction), [1, 0.75, 0.5, 0]);
  assert.deepEqual([
    { rbcAboveTarget: true, rbcComfortablyAboveTarget: true, rbcNearTarget: false, rbcBelowTarget: false, reserveDevelopment: "favorable" },
    { rbcAboveTarget: true, rbcComfortablyAboveTarget: false, rbcNearTarget: false, rbcBelowTarget: false, reserveDevelopment: "stable" },
    { rbcAboveTarget: false, rbcComfortablyAboveTarget: false, rbcNearTarget: true, rbcBelowTarget: false, reserveDevelopment: "mildly_adverse" },
    { rbcAboveTarget: false, rbcComfortablyAboveTarget: false, rbcNearTarget: false, rbcBelowTarget: true, reserveDevelopment: "materially_adverse" },
  ].map((x) => scoreAbsoluteRuleTable(x, insurers.balanceSheet).fraction), [1, 0.75, 0.5, 0]);
});

test("REIT special-sector NOI, occupancy, and leverage bands match §5", () => {
  const reits = SPECIAL_SECTOR_RULE_TABLES.reits;
  assert.deepEqual([8, 5, 2, 1.99].map((sameStoreNoiOrFfoGrowthPct) => scoreAbsoluteRuleTable({ sameStoreNoiOrFfoGrowthPct }, reits.revGrowth).fraction), [1, 0.75, 0.5, 0]);
  assert.deepEqual([
    { occupancyPct: 95, leasingSpreadsStableOrImproving: true, leasingSpreadsMateriallyDeteriorating: false },
    { occupancyPct: 92, leasingSpreadsStableOrImproving: false, leasingSpreadsMateriallyDeteriorating: false },
    { occupancyPct: 88, leasingSpreadsStableOrImproving: false, leasingSpreadsMateriallyDeteriorating: false },
    { occupancyPct: 87.99, leasingSpreadsStableOrImproving: false, leasingSpreadsMateriallyDeteriorating: true },
  ].map((x) => scoreAbsoluteRuleTable(x, reits.epsTrajectory).fraction), [1, 0.75, 0.5, 0]);
  assert.deepEqual([
    { netDebtEbitda: 4.9, fixedChargeCoverage: 4.1 },
    { netDebtEbitda: 5, fixedChargeCoverage: 3.1 },
    { netDebtEbitda: 6, fixedChargeCoverage: 2.1 },
    { netDebtEbitda: 7.1, fixedChargeCoverage: 1.9 },
  ].map((x) => scoreAbsoluteRuleTable(x, reits.balanceSheet).fraction), [1, 0.75, 0.5, 0]);
});

test("special-sector selection is deterministic and falls back to the agent table", () => {
  assert.equal(absoluteRuleTableFor("agent-1", "revGrowth", "banks"), SPECIAL_SECTOR_RULE_TABLES.banks.revGrowth);
  assert.equal(absoluteRuleTableFor("agent-1", "revBeat", "banks"), ABSOLUTE_RULE_TABLES["agent-1"].revBeat);
  assert.equal(absoluteRuleTableFor("agent-1", "unknown", "banks"), null);
});
