import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MANDATE_POLICIES,
  MANDATE_POLICY_VERSION,
  mandatePolicyFor,
} from "../config/agents/mandate-policy.js";
import {
  evaluateMandateAdd,
  evaluateMandateEntry,
  evaluateMandateHardGates,
  evaluateMandateHolding,
  evaluateMandatePolicy,
  evaluateMandateScore,
  evaluateMandateSizing,
} from "../lib/mandate-policy.js";

const AS_OF = "2026-07-20T21:00:00.000Z";
const SESSION = "2026-07-20T20:00:00.000Z";

function record(value, {
  state = "fresh",
  source = "fixture",
  observedAt = AS_OF,
  retrievedAt = AS_OF,
} = {}) {
  return { value, state, source, observedAt, retrievedAt };
}

function notApplicable() {
  return record(null, { state: "not_applicable" });
}

function scoreMetric(metricId, points, maxPoints) {
  return {
    metricId,
    value: points,
    unit: "score_points",
    points,
    maxPoints,
    source: "fixture",
    sourceDocumentId: "fixture-document",
    sourceFiledAt: AS_OF,
    sourceAsOf: AS_OF,
    retrievedAt: AS_OF,
    freshnessState: "fresh",
    peerCount: 12,
    calculationMethod: "fixture",
    thesisCritical: true,
    missingReason: null,
  };
}

function scoreObservation(agentId, total = 90, {
  maxAvailable = 100,
  thinPeerSet = false,
  actionable = true,
  observedAt = AS_OF,
  mandateId = MANDATE_POLICIES[agentId]?.mandateId,
  mandateVersion = MANDATE_POLICIES[agentId]?.mandateVersion,
} = {}) {
  const rawPoints = (total / 100) * maxAvailable;
  const metrics = [
    scoreMetric("earnings_quality", rawPoints / 2, maxAvailable / 2),
    scoreMetric("growth", rawPoints / 2, maxAvailable / 2),
  ];
  return {
    id: `observation-${agentId}`,
    runId: "run-1",
    observedAt,
    agentId,
    mandateId,
    mandateVersion,
    mandateUniverseVersion: "eligible-us-operating-common-equities-v3",
    productionUniversePolicyVersion: "fixture-universe-v1",
    scoringConfigVersion: "mandate-v3-scoring-1+sha256:fixture",
    codeRevision: "fixture-revision",
    ticker: "AAA",
    universeSnapshotId: "universe-fixture",
    eligible: true,
    eligibilityReasonCodes: [],
    score: total,
    uncappedScore: total,
    rawPoints,
    maxAvailablePoints: maxAvailable,
    complete: maxAvailable === 100,
    actionable,
    coverageMask: ["earnings_quality", "growth"],
    missingMetrics: [],
    criticalMissingMetrics: [],
    fallbackMethod: thinPeerSet ? "absolute" : "peer_relative",
    thinPeerSet,
    peerSetId: "peer-fixture",
    peerSetLevel: thinPeerSet ? "none" : "industry",
    peerCount: thinPeerSet ? 0 : 12,
    specialSectorKey: null,
    scoreCause: "filing",
    inputSnapshotId: "evidence-fixture",
    metrics,
  };
}

function commonEntry() {
  return {
    securityEligible: record(true),
    averageDollarVolume: record(20_000_000),
    balanceSheetEntryPass: record(true),
    companyDisclosureState: record("clear"),
    criticalCredibilityEvent: record(false),
    spyClose: record(600),
    spy200DayAverage: record(550),
    treasuryYieldChangeBps30TradingDays: record(20),
  };
}

function agentOneEntry(overrides = {}) {
  return {
    ...commonEntry(),
    marketCapitalization: record(2_000_000_000),
    currentPrice: record(110),
    price200DayAverage: record(100),
    entryRelativeVolume30Day: record(1.2),
    ...overrides,
  };
}

function agentTwoEntry(overrides = {}) {
  return {
    ...commonEntry(),
    marketCapitalization: record(2_000_000_000),
    currentPrice: record(120),
    price50DayAverage: record(110),
    price200DayAverage: record(100),
    entryRelativeVolume30Day: record(1.2),
    revenueGrowthQuarterlyHistory: record([10, 12, 13, 15]),
    epsGrowthQuarterlyHistory: record([10, 12]),
    estimateConsensusHistory: record([
      { asOf: "2026-06-01T21:00:00.000Z", value: 10 },
      { asOf: "2026-07-01T21:00:00.000Z", value: 10.2 },
      { asOf: AS_OF, value: 10.5 },
    ]),
    ...overrides,
  };
}

function agentThreeEntry(overrides = {}) {
  return {
    ...commonEntry(),
    valuationCascade: record({
      value: 15,
      absoluteMeasure: "forwardPE",
      companyHistory: [],
      companyHistoryCoverage: {},
      sectorValues: [],
    }),
    ...overrides,
  };
}

function commonHolding() {
  return {
    lastCompletedSessionAt: record(SESSION),
    lastDailyMonitorAt: record(SESSION),
    lastWeeklyRescoreAt: record("2026-07-17T20:00:00.000Z"),
    latestEarningsAt: notApplicable(),
    lastEarningsReunderwriteAt: notApplicable(),
    latestMaterialEventAt: notApplicable(),
    lastMaterialEventReunderwriteAt: notApplicable(),
    criticalCredibilityEvent: record(false),
  };
}

function agentOneHolding(overrides = {}) {
  return {
    ...commonHolding(),
    atrFrom20SessionHigh: record(0),
    relativeStrengthBroken: record(false),
    epsTrendImproving: record(false),
    fundamentalFullExitTrigger: record(false),
    momentumDeteriorationTrigger: record(false),
    tradingDaysSinceEntry: record(5),
    thesisProgress: record(true),
    datedCatalystWithin10TradingDays: record(false),
    convictionTierDrop: record(0),
    ...overrides,
  };
}

function agentTwoHolding(overrides = {}) {
  return {
    ...commonHolding(),
    consecutiveClosesBelow50Day: record(0),
    relativeStrengthDecliningWeeks: record(0),
    priceBelow200DayAverage: record(false),
    consecutiveRevenueDecelerationQuarters: record(0),
    consecutiveEpsDecelerationQuarters: record(0),
    guidanceTrajectoryReset: record(false),
    quartersFlatOrUnderperformingSpy: record(0),
    datedCatalystPresent: record(false),
    convictionTierDrop: record(0),
    ...overrides,
  };
}

function agentThreeHolding(overrides = {}) {
  return {
    ...commonHolding(),
    lastAnnualReunderwriteAt: record("2026-06-30T20:00:00.000Z"),
    structuralFullExitTrigger: record(false),
    businessEvidenceScoreExValuation: record(80),
    currentWeightPct: record(15),
    valuationHistoricalPercentile: record(0.5),
    ...overrides,
  };
}

function codes(result) {
  return result.blockers.map((entry) => entry.code);
}

test("all specialists expose the same deterministic capability surface", () => {
  const agents = Object.keys(MANDATE_POLICIES);
  assert.deepEqual(agents, ["agent-1", "agent-2", "agent-3"]);
  for (const agentId of agents) {
    const policy = mandatePolicyFor(agentId);
    assert.equal(policy.evidenceSemantics.missingBehavior, "block");
    assert.equal(policy.evidenceSemantics.staleBehavior, "block");
    assert.equal(policy.evidenceSemantics.conflictBehavior, "block");
    assert.equal(policy.score.minimumAvailablePoints, 80);
    assert.equal(policy.cadence.dailyMonitor, "each_completed_session");
    assert.equal(policy.cadence.earningsReunderwrite, true);
    assert.equal(policy.cadence.materialEventReunderwrite, true);
  }
  assert.equal(MANDATE_POLICY_VERSION, "specialist-mandate-policy-v1");
  assert.throws(() => mandatePolicyFor("agent-4"), /Unknown specialist mandate agent/);
});

test("missing, stale, conflicting, malformed, and future evidence fail closed identically", () => {
  const fixtures = {
    "agent-1": agentOneEntry(),
    "agent-2": agentTwoEntry(),
    "agent-3": agentThreeEntry(),
  };
  for (const [agentId, base] of Object.entries(fixtures)) {
    const missing = { ...base };
    delete missing.balanceSheetEntryPass;
    assert.equal(evaluateMandateEntry({ agentId, evidence: missing, asOf: AS_OF, scoreObservation: scoreObservation(agentId) }).eligible, false);

    const stale = { ...base, balanceSheetEntryPass: record(true, { state: "stale" }) };
    assert.ok(codes(evaluateMandateEntry({ agentId, evidence: stale, asOf: AS_OF, scoreObservation: scoreObservation(agentId) }))
      .includes("evidence_not_actionable:balanceSheetEntryPass:stale"));

    const conflict = { ...base, balanceSheetEntryPass: record(true, { state: "conflict" }) };
    assert.ok(codes(evaluateMandateEntry({ agentId, evidence: conflict, asOf: AS_OF, scoreObservation: scoreObservation(agentId) }))
      .includes("evidence_not_actionable:balanceSheetEntryPass:conflict"));

    const future = {
      ...base,
      balanceSheetEntryPass: record(true, {
        observedAt: "2026-07-21T21:00:00.000Z",
        retrievedAt: "2026-07-21T21:00:00.000Z",
      }),
    };
    assert.ok(codes(evaluateMandateEntry({ agentId, evidence: future, asOf: AS_OF, scoreObservation: scoreObservation(agentId) }))
      .includes("evidence_from_future:balanceSheetEntryPass"));
  }
});

test("the common score boundary rejects generic, incomplete, and below-mandate scores", () => {
  assert.ok(codes(evaluateMandateScore({ agentId: "agent-1" })).includes("mandate_score_missing"));
  assert.ok(codes(evaluateMandateScore({
    agentId: "agent-1",
    scoreObservation: { score: 90, maxAvailablePoints: 100, actionable: true },
  })).includes("mandate_score_observation_invalid"));
  assert.ok(codes(evaluateMandateScore({
    agentId: "agent-1",
    scoreObservation: scoreObservation("agent-2"),
  })).includes("mandate_score_identity_mismatch"));
  assert.ok(codes(evaluateMandateScore({
    agentId: "agent-2",
    scoreObservation: scoreObservation("agent-2", 90, { maxAvailable: 79, actionable: false }),
  })).includes("mandate_score_insufficient_coverage"));
  assert.ok(codes(evaluateMandateScore({
    agentId: "agent-3",
    scoreObservation: scoreObservation("agent-3", 64),
  })).includes("mandate_score_below_entry_floor"));
  assert.ok(codes(evaluateMandateScore({
    agentId: "agent-3",
    scoreObservation: scoreObservation("agent-3", 85, { thinPeerSet: true }),
  })).includes("mandate_score_exceeds_thin_peer_cap"));
  assert.ok(codes(evaluateMandateScore({
    agentId: "agent-1",
    scoreObservation: scoreObservation("agent-1", 90, {
      observedAt: "2026-07-21T21:00:00.000Z",
    }),
    asOf: AS_OF,
  })).includes("mandate_score_from_future"));
});

test("hard-gates-only path permits supervised research but never relabels an incomplete score", () => {
  const result = evaluateMandateHardGates({
    agentId: "agent-2",
    evidence: agentTwoEntry(),
    asOf: AS_OF,
  });
  assert.equal(result.researchEligible, true);
  assert.equal(result.proposalEligible, false);
  assert.equal(result.eligible, false);
  assert.equal(result.status, "research_only");
  assert.deepEqual(result.hardGateBlockers, []);
  assert.ok(result.scoreBlockers.some((entry) => entry.code === "mandate_score_missing"));
});

test("macro boundary is identical for Agents 1/2 and informational for Agent 3", () => {
  const dualRed = {
    spyClose: record(500),
    spy200DayAverage: record(500),
    treasuryYieldChangeBps30TradingDays: record(50.01),
  };
  for (const [agentId, evidence] of [
    ["agent-1", agentOneEntry(dualRed)],
    ["agent-2", agentTwoEntry(dualRed)],
  ]) {
    const result = evaluateMandateEntry({ agentId, evidence, asOf: AS_OF, scoreObservation: scoreObservation(agentId) });
    assert.equal(result.macro.dualRed, true);
    assert.ok(codes(result).includes("macro_dual_red"));
  }
  const longTerm = evaluateMandateEntry({
    agentId: "agent-3",
    evidence: agentThreeEntry(dualRed),
    asOf: AS_OF,
    scoreObservation: scoreObservation("agent-3"),
  });
  assert.equal(longTerm.macro.dualRed, true);
  assert.equal(longTerm.eligible, true);

  const exactBoundary = evaluateMandateEntry({
    agentId: "agent-2",
    evidence: agentTwoEntry({
      spyClose: record(600),
      spy200DayAverage: record(550),
      treasuryYieldChangeBps30TradingDays: record(50),
    }),
    asOf: AS_OF,
    scoreObservation: scoreObservation("agent-3"),
  });
  assert.equal(exactBoundary.macro.rates, "green");
});

test("Agent 1 enforces v3 conditional liquidity, price, and relative-volume gates", () => {
  const qualifyingMicrocap = evaluateMandateEntry({
    agentId: "agent-1",
    evidence: agentOneEntry({
      marketCapitalization: record(299_999_999),
      averageDollarVolume: record(3_000_000),
    }),
    asOf: AS_OF,
    scoreObservation: scoreObservation("agent-1"),
  });
  assert.equal(qualifyingMicrocap.eligible, true);

  const ordinaryTooThin = evaluateMandateEntry({
    agentId: "agent-1",
    evidence: agentOneEntry({
      marketCapitalization: record(300_000_000),
      averageDollarVolume: record(9_999_999),
    }),
    asOf: AS_OF,
    scoreObservation: scoreObservation("agent-1"),
  });
  assert.ok(codes(ordinaryTooThin).includes("average_dollar_volume_below_mandate_floor"));

  const structure = evaluateMandateEntry({
    agentId: "agent-1",
    evidence: agentOneEntry({
      currentPrice: record(100),
      price200DayAverage: record(100),
      entryRelativeVolume30Day: record(1.199),
    }),
    asOf: AS_OF,
    scoreObservation: scoreObservation("agent-1"),
  });
  assert.ok(codes(structure).includes("price_not_above_200_day"));
  assert.ok(codes(structure).includes("relative_volume_below_entry_floor"));
});

test("Agent 2 deterministically enforces established trend and records persistence coverage", () => {
  const pass = evaluateMandateEntry({
    agentId: "agent-2",
    evidence: agentTwoEntry(),
    asOf: AS_OF,
    scoreObservation: scoreObservation("agent-2"),
  });
  assert.equal(pass.eligible, true);
  assert.equal(pass.diagnostics.persistence.revenuePositiveQuartersOfFour, 4);
  assert.equal(pass.diagnostics.persistence.estimateRevisionStatus, "active");

  const equal50 = evaluateMandateEntry({
    agentId: "agent-2",
    evidence: agentTwoEntry({ currentPrice: record(110) }),
    asOf: AS_OF,
    scoreObservation: scoreObservation("agent-2"),
  });
  assert.ok(codes(equal50).includes("established_trend_not_confirmed"));

  const shortHistory = evaluateMandateEntry({
    agentId: "agent-2",
    evidence: agentTwoEntry({ revenueGrowthQuarterlyHistory: record([10, 12, 13]) }),
    asOf: AS_OF,
    scoreObservation: scoreObservation("agent-2"),
  });
  assert.ok(codes(shortHistory).includes("evidence_insufficient_history:revenueGrowthQuarterlyHistory"));
});

test("Agent 3 uses the valuation cascade and tightens its hard gate for thin peers", () => {
  const absolutePass = evaluateMandateEntry({
    agentId: "agent-3",
    evidence: agentThreeEntry(),
    asOf: AS_OF,
    scoreObservation: scoreObservation("agent-3"),
  });
  assert.equal(absolutePass.eligible, true);
  assert.equal(absolutePass.diagnostics.valuation.source, "universal_absolute");

  const expensive = evaluateMandateEntry({
    agentId: "agent-3",
    evidence: agentThreeEntry({
      valuationCascade: record({
        value: 24,
        absoluteMeasure: "forwardPE",
        companyHistory: [],
        companyHistoryCoverage: {},
        sectorValues: [],
      }),
    }),
    asOf: AS_OF,
    scoreObservation: scoreObservation("agent-3"),
  });
  assert.equal(expensive.diagnostics.valuation.fraction, 0.5);
  assert.equal(expensive.eligible, true);

  const thinPeer = evaluateMandateEntry({
    agentId: "agent-3",
    evidence: agentThreeEntry({
      valuationCascade: record({
        value: 24,
        absoluteMeasure: "forwardPE",
        companyHistory: [],
        companyHistoryCoverage: {},
        sectorValues: [],
      }),
    }),
    asOf: AS_OF,
    scoreObservation: scoreObservation("agent-3", 84, { thinPeerSet: true }),
  });
  assert.ok(codes(thinPeer).includes("hard_valuation_gate_failed"));

  const unsupportedMeasure = evaluateMandateEntry({
    agentId: "agent-3",
    evidence: agentThreeEntry({
      valuationCascade: record({
        value: 15,
        absoluteMeasure: "inventedMultiple",
        companyHistory: [],
        companyHistoryCoverage: {},
        sectorValues: [],
      }),
    }),
    asOf: AS_OF,
    scoreObservation: scoreObservation("agent-3"),
  });
  assert.ok(codes(unsupportedMeasure).includes("valuation_measure_unsupported"));
});

test("common sizing adapter enforces tier, position, sector, and mandate cash caps", () => {
  for (const [agentId, projectedCashPct, entryEvidence] of [
    ["agent-1", 5, agentOneEntry()],
    ["agent-2", 5, agentTwoEntry()],
    ["agent-3", null, agentThreeEntry()],
  ]) {
    const evidence = {
      ...entryEvidence,
      requestedWeightPct: record(agentId === "agent-2" ? 12 : 15),
      projectedPositionWeightPct: record(agentId === "agent-2" ? 12 : 15),
      projectedSectorWeightPct: record(agentId === "agent-1" ? 75 : 60),
      ...(projectedCashPct == null ? {} : { projectedAttributedCashPct: record(projectedCashPct) }),
    };
    const pass = evaluateMandateSizing({
      agentId,
      evidence,
      asOf: AS_OF,
      scoreObservation: scoreObservation(agentId, 90),
    });
    assert.equal(pass.eligible, true);
    assert.ok(pass.evidenceLineage.length >= 3);
  }

  const blocked = evaluateMandateSizing({
    agentId: "agent-2",
    evidence: {
      ...agentTwoEntry(),
      requestedWeightPct: record(12.01),
      projectedPositionWeightPct: record(12.01),
      projectedSectorWeightPct: record(60.01),
      projectedAttributedCashPct: record(4.99),
    },
    asOf: AS_OF,
    scoreObservation: scoreObservation("agent-2", 90),
  });
  assert.ok(codes(blocked).includes("requested_weight_above_conviction_tier"));
  assert.ok(codes(blocked).includes("projected_position_above_mandate_cap"));
  assert.ok(codes(blocked).includes("projected_sector_above_mandate_cap"));
  assert.ok(codes(blocked).includes("projected_cash_below_mandate_reserve"));

  const macroCapped = evaluateMandateSizing({
    agentId: "agent-2",
    evidence: {
      ...agentTwoEntry({
        spyClose: record(500),
        spy200DayAverage: record(550),
      }),
      requestedWeightPct: record(12),
      projectedPositionWeightPct: record(12),
      projectedSectorWeightPct: record(30),
      projectedAttributedCashPct: record(10),
    },
    asOf: AS_OF,
    scoreObservation: scoreObservation("agent-2", 90),
  });
  assert.equal(macroCapped.entry.tier.name, "tier_2");
  assert.ok(codes(macroCapped).includes("requested_weight_above_conviction_tier"));
});

test("all three holding adapters enforce the same monitor and event cadence", () => {
  for (const [agentId, fixture] of [
    ["agent-1", agentOneHolding()],
    ["agent-2", agentTwoHolding()],
    ["agent-3", agentThreeHolding()],
  ]) {
    const staleMonitor = {
      ...fixture,
      lastDailyMonitorAt: record("2026-07-17T20:00:00.000Z"),
      latestEarningsAt: record("2026-07-18T20:00:00.000Z"),
      lastEarningsReunderwriteAt: record("2026-07-17T20:00:00.000Z"),
    };
    const result = evaluateMandateHolding({ agentId, evidence: staleMonitor, asOf: AS_OF });
    assert.ok(result.dueReviews.includes("daily_monitor"));
    assert.ok(result.dueReviews.includes("earnings_reunderwrite"));
    assert.equal(result.additionsFrozen, true);
  }
});

test("Agent 1 applies ATR and dead-trade clock boundaries deterministically", () => {
  const review = evaluateMandateHolding({
    agentId: "agent-1",
    evidence: agentOneHolding({ atrFrom20SessionHigh: record(1.5) }),
    asOf: AS_OF,
  });
  assert.equal(review.action, "REVIEW_REQUIRED");
  assert.ok(review.reasonCodes.includes("atr_1_5_review_ladder"));

  const trim = evaluateMandateHolding({
    agentId: "agent-1",
    evidence: agentOneHolding({
      atrFrom20SessionHigh: record(2),
      relativeStrengthBroken: record(true),
    }),
    asOf: AS_OF,
  });
  assert.equal(trim.action, "SELL_PARTIAL");

  const exit = evaluateMandateHolding({
    agentId: "agent-1",
    evidence: agentOneHolding({
      tradingDaysSinceEntry: record(40),
      thesisProgress: record(false),
      datedCatalystWithin10TradingDays: record(false),
    }),
    asOf: AS_OF,
  });
  assert.equal(exit.action, "SELL_FULL");
  assert.ok(exit.reasonCodes.includes("dead_trade_40_day_exit"));
});

test("Agent 2 applies trend-break, repeated deterioration, and dead-money exits", () => {
  const trim = evaluateMandateHolding({
    agentId: "agent-2",
    evidence: agentTwoHolding({
      consecutiveClosesBelow50Day: record(5),
      relativeStrengthDecliningWeeks: record(4),
    }),
    asOf: AS_OF,
  });
  assert.equal(trim.action, "SELL_PARTIAL");

  const full = evaluateMandateHolding({
    agentId: "agent-2",
    evidence: agentTwoHolding({
      consecutiveClosesBelow50Day: record(5),
      relativeStrengthDecliningWeeks: record(4),
      priceBelow200DayAverage: record(true),
    }),
    asOf: AS_OF,
  });
  assert.equal(full.action, "SELL_FULL");
  assert.ok(full.reasonCodes.includes("confirmed_50_200_day_trend_break"));

  const deadMoney = evaluateMandateHolding({
    agentId: "agent-2",
    evidence: agentTwoHolding({
      quartersFlatOrUnderperformingSpy: record(2),
      datedCatalystPresent: record(false),
    }),
    asOf: AS_OF,
  });
  assert.equal(deadMoney.action, "SELL_FULL");
  assert.ok(deadMoney.reasonCodes.includes("two_quarter_dead_money"));
});

test("Agent 3 enforces annual/event re-underwrite and structural-only exit posture", () => {
  const annual = evaluateMandateHolding({
    agentId: "agent-3",
    evidence: agentThreeHolding({
      lastAnnualReunderwriteAt: record("2025-07-20T20:00:00.000Z"),
    }),
    asOf: AS_OF,
  });
  assert.ok(annual.dueReviews.includes("annual_reunderwrite"));
  assert.equal(annual.action, "REVIEW_REQUIRED");

  const lowScore = evaluateMandateHolding({
    agentId: "agent-3",
    evidence: agentThreeHolding({ businessEvidenceScoreExValuation: record(64.99) }),
    asOf: AS_OF,
  });
  assert.equal(lowScore.action, "REVIEW_REQUIRED");
  assert.ok(lowScore.reasonCodes.includes("annual_or_event_reunderwrite_below_65"));

  const drift = evaluateMandateHolding({
    agentId: "agent-3",
    evidence: agentThreeHolding({ currentWeightPct: record(25.01) }),
    asOf: AS_OF,
  });
  assert.equal(drift.action, "SELL_PARTIAL");

  const structural = evaluateMandateHolding({
    agentId: "agent-3",
    evidence: agentThreeHolding({ structuralFullExitTrigger: record(true) }),
    asOf: AS_OF,
  });
  assert.equal(structural.action, "SELL_FULL");
});

test("Agent 1/2 prohibit averaging down while Agent 3 enforces durable lifetime one-add accounting", () => {
  for (const [agentId, entryEvidence] of [
    ["agent-1", agentOneEntry()],
    ["agent-2", agentTwoEntry()],
  ]) {
    const result = evaluateMandateAdd({
      agentId,
      evidence: {
        ...entryEvidence,
        isExistingPosition: record(true),
        isUnderwater: record(true),
        projectedWeightPct: record(10),
      },
      asOf: AS_OF,
      scoreObservation: scoreObservation(agentId),
    });
    assert.ok(codes(result).includes("averaging_down_prohibited"));
  }

  const controlled = {
    ...agentThreeEntry(),
    isExistingPosition: record(true),
    isUnderwater: record(true),
    projectedWeightPct: record(15),
    priorFilledAddIds: record([]),
    fullReunderwriteAt: record(SESSION),
    thesisIntact: record(true),
    declineCause: record("market"),
    criticalDataComplete: record(true),
    liquidityExitCapacityWarning: record(false),
    companyNondisclosure: record(false),
  };
  const first = evaluateMandateAdd({
    agentId: "agent-3",
    evidence: controlled,
    asOf: AS_OF,
    scoreObservation: scoreObservation("agent-3", 70),
    proposedAddId: "add-1",
  });
  assert.equal(first.eligible, true);
  assert.equal(first.priorFilledAddCount, 0);

  const second = evaluateMandateAdd({
    agentId: "agent-3",
    evidence: { ...controlled, priorFilledAddIds: record(["add-1"]) },
    asOf: AS_OF,
    scoreObservation: scoreObservation("agent-3", 70),
    proposedAddId: "add-2",
  });
  assert.ok(codes(second).includes("lifetime_add_limit_reached"));

  const missingHistory = { ...controlled };
  delete missingHistory.priorFilledAddIds;
  const blocked = evaluateMandateAdd({
    agentId: "agent-3",
    evidence: missingHistory,
    asOf: AS_OF,
    scoreObservation: scoreObservation("agent-3", 70),
  });
  assert.equal(blocked.eligible, false);
  assert.ok(codes(blocked).includes("evidence_missing:priorFilledAddIds"));
});

test("dispatcher preserves one interface and fails closed on unknown phases", () => {
  const result = evaluateMandatePolicy({
    phase: "entry",
    agentId: "agent-1",
    evidence: agentOneEntry(),
    asOf: AS_OF,
    scoreObservation: scoreObservation("agent-1"),
  });
  assert.equal(result.eligible, true);
  assert.throws(() => evaluateMandatePolicy({ phase: "execute", agentId: "agent-1" }), /Unknown mandate policy phase/);
});
