/** Executable transcription of analyst mandates v3 §5 (standard-sector rows). */

const all = (...conditions) => ({ all: conditions });
const any = (...conditions) => ({ any: conditions });
const f = (field, bounds) => ({ field, ...bounds });
const rule = (fraction, when) => ({ fraction, when });

const marginTrend = {
  rules: [
    rule(1, f("marginChangeBps", { gte: 200 })),
    rule(0.75, f("marginChangeBps", { gte: 100 })),
    rule(0.5, f("marginChangeBps", { gte: -99, lte: 99 })),
    rule(0, all(f("marginChangeBps", { lte: -100 }), f("documentedInvestmentExplanation", { eq: false }))),
  ],
};

const balanceSheet = {
  rules: [
    rule(1, any(
      all(f("isProfitable", { eq: true }), f("netCash", { eq: true })),
      all(f("isProfitable", { eq: true }), f("netDebtEbitda", { lt: 1 }), f("interestCoverage", { gt: 8 })),
      all(f("isPreProfit", { eq: true }), f("cashRunwayQuarters", { gte: 12 })),
    )),
    rule(0.75, any(
      all(f("isProfitable", { eq: true }), f("netDebtEbitda", { gte: 1, lte: 2 }), f("interestCoverage", { gt: 5 })),
      all(f("isPreProfit", { eq: true }), f("cashRunwayQuarters", { gte: 9, lte: 11 })),
    )),
    rule(0.5, any(
      all(f("isProfitable", { eq: true }), f("netDebtEbitda", { gt: 2, lte: 3 }), f("interestCoverage", { gt: 3 })),
      all(f("isPreProfit", { eq: true }), f("cashRunwayQuarters", { gte: 6, lte: 8 })),
    )),
    rule(0, any(
      f("netDebtEbitda", { gt: 3 }),
      f("interestCoverage", { lt: 3 }),
      f("cashRunwayQuarters", { lt: 6 }),
    )),
  ],
};

const institutionalOwnership = {
  rules: [
    rule(1, any(f("ownershipChangePoints", { gte: 5 }), f("clearMultiQuarterAccumulation", { eq: true }))),
    rule(0.75, f("ownershipChangePoints", { gte: 2 })),
    rule(0.5, f("ownershipChangePoints", { gte: -2, lte: 2 })),
    rule(0, f("ownershipChangePoints", { lt: -2 })),
  ],
};

const thirteenF = {
  rules: [
    rule(1, all(
      f("usableQuarters", { gte: 2 }),
      f("latestQuarterChangePct", { gt: 0 }),
      f("priorQuarterChangePct", { gt: 0 }),
      f("cumulativeTwoQuarterChangePct", { gte: 5 }),
    )),
    rule(0.75, all(
      f("latestQuarterChangePct", { gte: 2 }),
      any(f("usableQuarters", { eq: 1 }), f("priorQuarterChangePct", { gte: 0 })),
    )),
    rule(0.5, all(f("latestQuarterChangePct", { gte: -2, lte: 2 }), f("cumulativeTwoQuarterChangePct", { gte: -2, lte: 2 }))),
    rule(0, any(f("latestQuarterChangePct", { lt: -2 }), f("cumulativeTwoQuarterChangePct", { lt: 0 }))),
  ],
};

export const ABSOLUTE_RULE_TABLES = Object.freeze({
  "agent-1": Object.freeze({
    revBeat: {
      rules: [rule(1, f("beatPct", { gte: 5 })), rule(0.75, f("beatPct", { gte: 2 })), rule(0.5, f("beatPct", { gte: 0 })), rule(0, f("beatPct", { lt: 0 }))],
    },
    revGrowth: {
      rules: [
        rule(1, all(f("currentGrowthPct", { gte: 20 }), f("accelerationPoints", { gte: 5 }))),
        rule(0.75, all(f("currentGrowthPct", { gte: 15 }), f("accelerationPoints", { gte: 2 }))),
        rule(0.5, all(f("currentGrowthPct", { gte: 10 }), f("accelerationPoints", { gte: 0 }))),
        rule(0, any(f("currentGrowthPct", { lt: 10 }), f("accelerationPoints", { lt: 0 }))),
      ],
    },
    epsTrajectory: {
      rules: [
        rule(1, all(f("epsGrowthPct", { gte: 20 }), f("accelerationPoints", { gte: 5 }))),
        rule(0.75, all(f("epsGrowthPct", { gte: 15 }), f("accelerationPoints", { gte: 2 }))),
        rule(0.5, all(f("epsGrowthPct", { gte: 10 }), f("accelerationPoints", { gte: 0 }))),
        rule(0, any(f("epsGrowthPct", { lt: 0 }), f("accelerationPoints", { lt: 0 }))),
      ],
    },
    estimateRevisions: {
      rules: [
        rule(1, all(f("consensusChangePct", { gte: 5 }), f("positiveNegativeRatio", { gte: 2 }))),
        rule(0.75, all(f("consensusChangePct", { gte: 2 }), f("positiveBreadthPct", { gte: 60 }))),
        rule(0.5, all(f("consensusChangePct", { gte: 0 }), f("positiveBreadthPct", { gte: 50 }))),
        rule(0, f("consensusChangePct", { lt: 0 })),
      ],
    },
    marginTrend,
    balanceSheet,
    instOwnershipDir: institutionalOwnership,
    thirteenF,
  }),
  "agent-2": Object.freeze({
    revBeat: {
      rules: [
        rule(1, all(f("beatsInLatestThree", { eq: 3 }), f("minimumBeatPct", { gte: 2 }))),
        rule(0.75, all(f("beatsInLatestThree", { gte: 2 }), f("latestBeatPct", { gte: 2 }))),
        rule(0.5, all(f("latestBeatPct", { gte: 0 }), f("missesInLatestThree", { lte: 1 }))),
        rule(0, any(f("latestBeatPct", { lt: 0 }), f("missesInLatestThree", { gte: 2 }))),
      ],
    },
    revGrowth: {
      rules: [
        rule(1, all(f("currentGrowthPct", { gte: 20 }), f("positiveQuartersInLatestFour", { gte: 3 }))),
        rule(0.75, all(f("currentGrowthPct", { gte: 15 }), f("positiveMultiQuarterPersistence", { eq: true }))),
        rule(0.5, all(f("currentGrowthPct", { gte: 10 }), f("nonDecelerating", { eq: true }))),
        rule(0, any(f("currentGrowthPct", { lt: 10 }), f("consecutiveMaterialDecelerations", { gte: 2 }))),
      ],
    },
    epsTrajectory: {
      rules: [
        rule(1, all(f("epsGrowthPct", { gte: 20 }), f("consecutiveQualifyingQuarters", { gte: 2 }), f("nonDecelerating", { eq: true }))),
        rule(0.75, all(f("epsGrowthPct", { gte: 15 }), f("consecutiveQualifyingQuarters", { gte: 2 }))),
        rule(0.5, all(f("epsGrowthPct", { gte: 10 }), f("consecutiveDeterioratingQuarters", { lt: 2 }))),
        rule(0, any(f("epsGrowthPct", { lt: 0 }), f("consecutiveDeterioratingQuarters", { gte: 2 }))),
      ],
    },
    estimateRevisions: {
      rules: [
        rule(1, all(f("consensusChangePct60d", { gte: 5 }), f("positiveBreadthPct", { gte: 70 }), f("net30dReversal", { eq: false }))),
        rule(0.75, all(f("consensusChangePct60d", { gte: 2 }), f("positiveBreadthPct", { gte: 60 }))),
        rule(0.5, all(f("consensusChangePct60d", { gte: 0 }), f("positiveBreadthPct", { gte: 50 }))),
        rule(0, f("consensusChangePct60d", { lt: 0 })),
      ],
    },
    marginTrend,
    balanceSheet,
    instOwnershipDir: institutionalOwnership,
    thirteenF,
  }),
  "agent-3": Object.freeze({
    revGrowth: {
      rules: [
        rule(1, all(f("revenueCagr3yPct", { gte: 15 }), f("positiveGrowthYears", { eq: 3 }), f("minimumAnnualGrowthPct", { gte: 10 }), f("maxAnnualGrowthSpreadPoints", { lte: 15 }))),
        rule(0.75, any(
          all(f("revenueCagr3yPct", { gte: 10 }), f("revenueCagr3yPct", { lt: 15 }), f("positiveGrowthYears", { eq: 3 })),
          all(f("revenueCagr3yPct", { gte: 15 }), f("volatileYears", { eq: 1 })),
        )),
        rule(0.5, all(f("revenueCagr3yPct", { gte: 5 }), f("positiveGrowthYears", { gte: 2 }))),
        rule(0, any(f("revenueCagr3yPct", { lt: 5 }), f("negativeGrowthYears", { gte: 2 }), f("materiallyErraticGrowth", { eq: true }))),
      ],
    },
    revBeat: {
      rules: [
        rule(1, all(f("latestBeatPct", { gte: 3 }), f("yoyGrowthNonDecelerating", { eq: true }))),
        rule(0.75, f("latestBeatPct", { gte: 1 })),
        rule(0.5, all(f("latestBeatPct", { gte: -1, lte: 1 }), f("positiveYoyGrowth", { eq: true }))),
        rule(0, any(f("latestBeatPct", { lt: -1 }), f("materialDeterioration", { eq: true }))),
      ],
    },
    epsTrajectory: {
      rules: [
        rule(1, all(f("normalizedEpsCagr3yPct", { gte: 15 }), f("positiveEpsYears", { eq: 3 }), f("worstAnnualDeclinePct", { gte: -10 }))),
        rule(0.75, all(f("normalizedEpsCagr3yPct", { gte: 10 }), f("positiveCumulativeTrajectory", { eq: true }))),
        rule(0.5, all(f("normalizedEpsCagr3yPct", { gte: 5 }), f("persistentTwoYearDecline", { eq: false }))),
        rule(0, any(f("normalizedEpsCagr3yPct", { lt: 5 }), f("persistentDeterioration", { eq: true }))),
      ],
    },
    estimateRevisions: {
      rules: [
        rule(1, all(f("consensusChangePct90d", { gte: 5 }), f("positiveBreadthPct", { gte: 70 }), f("net30dReversal", { eq: false }))),
        rule(0.75, all(f("consensusChangePct90d", { gte: 2 }), f("positiveBreadthPct", { gte: 60 }))),
        rule(0.5, all(f("consensusChangePct90d", { gte: 0 }), f("positiveBreadthPct", { gte: 50 }))),
        rule(0, f("consensusChangePct90d", { lt: 0 })),
      ],
    },
    marginTrend: {
      rules: [
        rule(1, all(f("marginChangeBps3y", { gte: 200 }), f("twoYearContractionSequence", { eq: false }))),
        rule(0.75, f("marginChangeBps3y", { gte: 100 })),
        rule(0.5, f("marginChangeBps3y", { gte: -99, lte: 99 })),
        rule(0, all(f("marginChangeBps3y", { lte: -100 }), f("documentedStructuralInvestmentExplanation", { eq: false }))),
      ],
    },
    balanceSheet: {
      rules: [
        rule(1, all(f("latestNetDebtEbitda", { lt: 1 }), f("medianNetDebtEbitda3y", { lt: 1 }), f("latestInterestCoverage", { gt: 8 }), f("medianInterestCoverage3y", { gt: 8 }), f("anyYearBelowNextBand", { eq: false }))),
        rule(0.75, all(f("latestNetDebtEbitda", { gte: 1, lte: 2 }), f("medianNetDebtEbitda3y", { gte: 1, lte: 2 }), f("latestInterestCoverage", { gt: 5 }), f("medianInterestCoverage3y", { gt: 5 }))),
        rule(0.5, all(f("latestNetDebtEbitda", { gt: 2, lte: 3 }), f("medianNetDebtEbitda3y", { gt: 2, lte: 3 }), f("latestInterestCoverage", { gt: 3 }), f("medianInterestCoverage3y", { gt: 3 }))),
        rule(0, any(f("latestNetDebtEbitda", { gt: 3 }), f("latestInterestCoverage", { lt: 3 }), f("materialMultiYearDeterioration", { eq: true }))),
      ],
    },
    instOwnershipDir: institutionalOwnership,
    thirteenF,
  }),
});
