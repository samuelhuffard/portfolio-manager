/**
 * One deterministic specialist research-policy interface for Agents 1–3.
 *
 * Pure and side-effect free. It consumes timestamped evidence, calls the shared
 * mandate scorer, and returns research eligibility/review results only. It does
 * not create proposals, approve actions, size orders, touch ledgers, or execute.
 */

import { ABSOLUTE_VALUATION_TABLES } from "../config/scoring/mandate-v2.js";
import { MandateScoreObservationSchema } from "../contracts/research-observation.js";
import {
  MANDATE_POLICY_VERSION,
  MANDATE_POLICIES,
  mandatePolicyFor,
} from "../config/agents/mandate-policy.js";
import { scoreMandateCandidate } from "./mandate-score.js";
import { scoreValuationCascade } from "./peer-scoring.js";

const DAY_MS = 86_400_000;
const EVIDENCE_STATES = new Set(MANDATE_POLICIES["agent-1"].evidenceSemantics.allowedStates);
const NON_ACTIONABLE_STATES = new Set(["stale", "unavailable", "unsupported", "policy_unresolved", "conflict"]);
const ISO_WITH_ZONE = /^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/;

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function validInstant(value) {
  return typeof value === "string" && ISO_WITH_ZONE.test(value) && Number.isFinite(Date.parse(value));
}

function sortedUnique(values) {
  return [...new Set(values)].sort();
}

function normalizeBlockers(blockers) {
  const byCode = new Map();
  for (const blocker of blockers) {
    if (!byCode.has(blocker.code)) byCode.set(blocker.code, blocker);
  }
  return [...byCode.values()].sort((left, right) => left.code.localeCompare(right.code));
}

function blocker(code, evidenceId = null, state = null, detail = null) {
  return {
    code,
    evidenceId,
    state,
    ...(detail == null ? {} : { detail }),
  };
}

function evidenceReader(evidence, asOf) {
  const values = {};
  const records = {};
  const blockers = [];
  const asOfMs = Date.parse(asOf);

  function read(evidenceId, { allowNotApplicable = false } = {}) {
    if (Object.hasOwn(records, evidenceId)) {
      return records[evidenceId].ok ? records[evidenceId].value : null;
    }
    const record = evidence?.[evidenceId];
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      blockers.push(blocker(`evidence_missing:${evidenceId}`, evidenceId, "missing"));
      records[evidenceId] = { ok: false, value: null, record: null };
      return null;
    }
    const { state, source, observedAt, retrievedAt } = record;
    if (!EVIDENCE_STATES.has(state)
      || typeof source !== "string"
      || source.trim() !== source
      || source.length === 0
      || !validInstant(observedAt)
      || !validInstant(retrievedAt)) {
      blockers.push(blocker(`evidence_invalid_record:${evidenceId}`, evidenceId, state ?? "invalid"));
      records[evidenceId] = { ok: false, value: null, record };
      return null;
    }
    const observedMs = Date.parse(observedAt);
    const retrievedMs = Date.parse(retrievedAt);
    if (observedMs > retrievedMs) {
      blockers.push(blocker(`evidence_invalid_chronology:${evidenceId}`, evidenceId, state));
      records[evidenceId] = { ok: false, value: null, record };
      return null;
    }
    if (retrievedMs > asOfMs || observedMs > asOfMs) {
      blockers.push(blocker(`evidence_from_future:${evidenceId}`, evidenceId, state));
      records[evidenceId] = { ok: false, value: null, record };
      return null;
    }
    if (state === "not_applicable") {
      if (!allowNotApplicable || record.value !== null) {
        blockers.push(blocker(`evidence_invalid_not_applicable:${evidenceId}`, evidenceId, state));
        records[evidenceId] = { ok: false, value: null, record };
        return null;
      }
      records[evidenceId] = { ok: true, value: null, notApplicable: true, record };
      values[evidenceId] = null;
      return null;
    }
    if (NON_ACTIONABLE_STATES.has(state)) {
      blockers.push(blocker(`evidence_not_actionable:${evidenceId}:${state}`, evidenceId, state));
      records[evidenceId] = { ok: false, value: null, record };
      return null;
    }
    if (state !== "fresh" || record.value == null) {
      blockers.push(blocker(`evidence_invalid_value:${evidenceId}`, evidenceId, state));
      records[evidenceId] = { ok: false, value: null, record };
      return null;
    }
    records[evidenceId] = { ok: true, value: record.value, record };
    values[evidenceId] = record.value;
    return record.value;
  }

  return { read, values, records, blockers };
}

function evidenceLineage(reader) {
  return Object.entries(reader.records)
    .filter(([, entry]) => entry.record)
    .map(([evidenceId, entry]) => ({
      evidenceId,
      state: entry.record.state,
      source: entry.record.source,
      observedAt: entry.record.observedAt,
      retrievedAt: entry.record.retrievedAt,
    }))
    .sort((left, right) => left.evidenceId.localeCompare(right.evidenceId));
}

function requireBoolean(value, evidenceId, blockers) {
  if (typeof value !== "boolean") {
    blockers.push(blocker(`evidence_wrong_type:${evidenceId}`, evidenceId, "fresh", "expected_boolean"));
    return null;
  }
  return value;
}

function requireFinite(value, evidenceId, blockers) {
  if (!finite(value)) {
    blockers.push(blocker(`evidence_wrong_type:${evidenceId}`, evidenceId, "fresh", "expected_finite_number"));
    return null;
  }
  return value;
}

function requireInstantValue(value, evidenceId, blockers, { nullable = false } = {}) {
  if (nullable && value === null) return null;
  if (!validInstant(value)) {
    blockers.push(blocker(`evidence_wrong_type:${evidenceId}`, evidenceId, "fresh", "expected_zoned_iso_instant"));
    return null;
  }
  return value;
}

function scoreTier(policy, score) {
  return policy.score.tiers.find((tier) => score >= tier.min && score <= tier.max) ?? null;
}

function cappedTier(policy, tier, tierCap) {
  if (!tier || !tierCap) return tier;
  const capIndex = policy.score.tiers.findIndex((entry) => entry.name === tierCap);
  const tierIndex = policy.score.tiers.findIndex((entry) => entry.name === tier.name);
  return capIndex >= 0 && tierIndex >= 0 && tierIndex < capIndex
    ? policy.score.tiers[capIndex]
    : tier;
}

/**
 * Run the existing deterministic mandate scorer through a common validation
 * boundary. A caller may pass a stored score observation instead, but a generic
 * daily quant score is intentionally not accepted as a mandate score.
 */
export function evaluateMandateScore({
  agentId,
  scoringInput = null,
  scoreObservation = null,
  asOf = null,
}) {
  const policy = mandatePolicyFor(agentId);
  const blockers = [];
  let score;

  if (scoringInput) {
    score = scoreMandateCandidate({ ...scoringInput, agentId });
  } else if (scoreObservation && typeof scoreObservation === "object") {
    const parsed = MandateScoreObservationSchema.safeParse(scoreObservation);
    if (!parsed.success) {
      blockers.push(blocker("mandate_score_observation_invalid"));
      score = null;
    } else if (
      parsed.data.agentId !== agentId
      || parsed.data.mandateId !== policy.mandateId
      || parsed.data.mandateVersion !== policy.mandateVersion
    ) {
      blockers.push(blocker("mandate_score_identity_mismatch"));
      score = null;
    } else if (asOf != null && (!validInstant(asOf) || Date.parse(parsed.data.observedAt) > Date.parse(asOf))) {
      blockers.push(blocker("mandate_score_from_future"));
      score = null;
    } else {
      score = {
        ...parsed.data,
        total: parsed.data.score,
        maxAvailable: parsed.data.maxAvailablePoints,
      };
    }
  } else {
    blockers.push(blocker("mandate_score_missing"));
    score = null;
  }

  if (score) {
    if (score.maxAvailable < policy.score.minimumAvailablePoints) {
      blockers.push(blocker("mandate_score_insufficient_coverage"));
    }
    if (score.criticalMissingMetrics?.length) {
      blockers.push(blocker("mandate_score_critical_evidence_missing"));
    }
    if (score.actionable !== true) {
      blockers.push(blocker("mandate_score_not_actionable"));
    }
    if (score.thinPeerSet === true && score.total > policy.score.thinPeerConvictionCap) {
      blockers.push(blocker("mandate_score_exceeds_thin_peer_cap"));
    }
    if (score.total < policy.score.minimumEntryScore) {
      blockers.push(blocker("mandate_score_below_entry_floor"));
    }
  }

  return {
    policyVersion: MANDATE_POLICY_VERSION,
    agentId,
    mandateId: policy.mandateId,
    score,
    tier: score ? scoreTier(policy, score.total) : null,
    eligible: blockers.length === 0,
    blockers: normalizeBlockers(blockers),
  };
}

function evaluateMacro(policy, values, blockers) {
  const spyClose = requireFinite(values.spyClose, "spyClose", blockers);
  const spy200 = requireFinite(values.spy200DayAverage, "spy200DayAverage", blockers);
  const yieldChange = requireFinite(
    values.treasuryYieldChangeBps30TradingDays,
    "treasuryYieldChangeBps30TradingDays",
    blockers,
  );
  if (spyClose == null || spy200 == null || yieldChange == null) {
    return { market: "unknown", rates: "unknown", dualRed: null, tierCap: null };
  }
  const market = spyClose > spy200 ? "green" : "red";
  const rates = yieldChange > 50 ? "red" : "green";
  const dualRed = market === "red" && rates === "red";
  if (dualRed && policy.macro.dualRedBlocks) blockers.push(blocker("macro_dual_red"));
  return {
    market,
    rates,
    dualRed,
    tierCap: !dualRed && (market === "red" || rates === "red") ? policy.macro.singleRedTierCap : null,
  };
}

function validateCommonEntry(policy, values, blockers) {
  const securityEligible = requireBoolean(values.securityEligible, "securityEligible", blockers);
  const balanceSheetPass = requireBoolean(values.balanceSheetEntryPass, "balanceSheetEntryPass", blockers);
  const criticalCredibility = requireBoolean(values.criticalCredibilityEvent, "criticalCredibilityEvent", blockers);
  if (securityEligible === false) blockers.push(blocker("security_ineligible"));
  if (balanceSheetPass === false) blockers.push(blocker("balance_sheet_entry_gate_failed"));
  if (criticalCredibility === true) blockers.push(blocker("critical_credibility_event"));
  if (values.companyDisclosureState !== "clear") {
    blockers.push(blocker(
      values.companyDisclosureState === "company_nondisclosure"
        ? "company_nondisclosure"
        : "company_disclosure_state_invalid",
      "companyDisclosureState",
    ));
  }
  const adv = requireFinite(values.averageDollarVolume, "averageDollarVolume", blockers);
  return { adv };
}

function arrayOfFinite(value, evidenceId, blockers, minimumLength) {
  if (!Array.isArray(value) || value.length < minimumLength || value.some((entry) => !finite(entry))) {
    blockers.push(blocker(`evidence_insufficient_history:${evidenceId}`, evidenceId));
    return null;
  }
  return value;
}

function estimateHistoryState(history, policy, blockers) {
  if (!Array.isArray(history) || history.some((entry) => (
    !entry || typeof entry !== "object" || !validInstant(entry.asOf) || !finite(entry.value)
  ))) {
    blockers.push(blocker("evidence_invalid_history:estimateConsensusHistory", "estimateConsensusHistory"));
    return { state: "invalid", snapshots: 0, spanDays: 0 };
  }
  const ordered = [...history].sort((left, right) => Date.parse(left.asOf) - Date.parse(right.asOf));
  const spanDays = ordered.length > 1
    ? (Date.parse(ordered.at(-1).asOf) - Date.parse(ordered[0].asOf)) / DAY_MS
    : 0;
  const active = ordered.length >= policy.entry.minimumEstimateSnapshots
    && spanDays >= policy.entry.minimumEstimateHistoryDays;
  return {
    state: active ? "active" : "insufficient_history",
    snapshots: ordered.length,
    spanDays,
  };
}

function evaluateAgentEntry(policy, values, scoreResult, blockers) {
  const { adv } = validateCommonEntry(policy, values, blockers);
  const diagnostics = {};

  if (policy.agentId === "agent-1") {
    const marketCap = requireFinite(values.marketCapitalization, "marketCapitalization", blockers);
    const price = requireFinite(values.currentPrice, "currentPrice", blockers);
    const ma200 = requireFinite(values.price200DayAverage, "price200DayAverage", blockers);
    const relativeVolume = requireFinite(values.entryRelativeVolume30Day, "entryRelativeVolume30Day", blockers);
    if (marketCap != null && adv != null) {
      const floor = marketCap < policy.entry.microCapCeiling
        ? policy.entry.microCapMinimumAverageDollarVolume
        : policy.entry.minimumAverageDollarVolume;
      if (adv < floor) blockers.push(blocker("average_dollar_volume_below_mandate_floor"));
    }
    if (price != null && ma200 != null && price <= ma200) blockers.push(blocker("price_not_above_200_day"));
    if (relativeVolume != null && relativeVolume < policy.entry.minimumRelativeVolume) {
      blockers.push(blocker("relative_volume_below_entry_floor"));
    }
  } else if (policy.agentId === "agent-2") {
    const marketCap = requireFinite(values.marketCapitalization, "marketCapitalization", blockers);
    const price = requireFinite(values.currentPrice, "currentPrice", blockers);
    const ma50 = requireFinite(values.price50DayAverage, "price50DayAverage", blockers);
    const ma200 = requireFinite(values.price200DayAverage, "price200DayAverage", blockers);
    const relativeVolume = requireFinite(values.entryRelativeVolume30Day, "entryRelativeVolume30Day", blockers);
    if (marketCap != null && marketCap < policy.entry.minimumMarketCapitalization) {
      blockers.push(blocker("market_capitalization_below_mandate_floor"));
    }
    if (adv != null && adv < policy.entry.minimumAverageDollarVolume) {
      blockers.push(blocker("average_dollar_volume_below_mandate_floor"));
    }
    if (price != null && ma50 != null && ma200 != null
      && !(price > ma50 && price > ma200 && ma50 > ma200)) {
      blockers.push(blocker("established_trend_not_confirmed"));
    }
    if (relativeVolume != null && relativeVolume < policy.entry.minimumRelativeVolume) {
      blockers.push(blocker("relative_volume_below_entry_floor"));
    }
    const revenue = arrayOfFinite(
      values.revenueGrowthQuarterlyHistory,
      "revenueGrowthQuarterlyHistory",
      blockers,
      4,
    );
    const eps = arrayOfFinite(
      values.epsGrowthQuarterlyHistory,
      "epsGrowthQuarterlyHistory",
      blockers,
      policy.entry.minimumEpsHistoryQuarters,
    );
    const estimateHistory = estimateHistoryState(values.estimateConsensusHistory, policy, blockers);
    diagnostics.persistence = {
      revenuePositiveQuartersOfFour: revenue ? revenue.slice(-4).filter((value) => value > 0).length : null,
      revenueConsecutiveDecelerations: revenue
        ? revenue.slice(-3).reduce((count, value, index, sequence) => (
          index > 0 && value < sequence[index - 1] ? count + 1 : count
        ), 0)
        : null,
      epsHistoryQuarters: eps?.length ?? null,
      estimateRevisionStatus: estimateHistory.state,
      estimateSnapshots: estimateHistory.snapshots,
      estimateHistorySpanDays: estimateHistory.spanDays,
    };
  } else {
    if (adv != null && adv < policy.entry.minimumAverageDollarVolume) {
      blockers.push(blocker("average_dollar_volume_below_mandate_floor"));
    }
      const valuationInput = values.valuationCascade;
    if (!valuationInput || typeof valuationInput !== "object" || Array.isArray(valuationInput)) {
      blockers.push(blocker("valuation_cascade_invalid", "valuationCascade"));
    } else {
      const tableGroup = valuationInput.sectorKey ?? "universal";
      const absoluteSpec = ABSOLUTE_VALUATION_TABLES[tableGroup]?.[valuationInput.absoluteMeasure];
      if (!absoluteSpec) {
        blockers.push(blocker("valuation_measure_unsupported", "valuationCascade"));
      } else {
        const valuation = scoreValuationCascade({
          ...valuationInput,
          absoluteSpec,
          absoluteSource: `${tableGroup}_absolute`,
        });
        diagnostics.valuation = valuation;
        if (valuation.missing) {
          blockers.push(blocker("valuation_cascade_unavailable", "valuationCascade"));
        } else {
          // Without a complete mandate score, use the stricter thin-peer fallback
          // threshold. This hard-gates-only path is allowed to continue supervised
          // research, but it must not infer a more permissive peer state.
          const requiredFraction = scoreResult.score?.thinPeerSet !== false
            ? policy.entry.thinPeerMinimumValuationFraction
            : policy.entry.minimumValuationFraction;
          if (valuation.fraction < requiredFraction) {
            blockers.push(blocker("hard_valuation_gate_failed", "valuationCascade"));
          }
        }
      }
    }
  }

  return diagnostics;
}

/**
 * Evaluate a new-entry candidate through one interface for all three mandates.
 */
export function evaluateMandateEntry({
  agentId,
  evidence = {},
  asOf,
  scoringInput = null,
  scoreObservation = null,
}) {
  if (!validInstant(asOf)) throw new TypeError("asOf must be a zoned ISO instant.");
  const policy = mandatePolicyFor(agentId);
  const reader = evidenceReader(evidence, asOf);
  for (const evidenceId of policy.entryEvidence) reader.read(evidenceId);
  const scoreResult = evaluateMandateScore({
    agentId,
    scoringInput,
    scoreObservation,
    asOf,
  });
  const hardGateBlockers = [...reader.blockers];
  const macro = evaluateMacro(policy, reader.values, hardGateBlockers);
  const diagnostics = evaluateAgentEntry(policy, reader.values, scoreResult, hardGateBlockers);
  const normalizedHardGateBlockers = normalizeBlockers(hardGateBlockers);
  const normalizedScoreBlockers = normalizeBlockers(scoreResult.blockers);
  const normalized = normalizeBlockers([...normalizedHardGateBlockers, ...normalizedScoreBlockers]);
  const tier = cappedTier(policy, scoreResult.tier, macro.tierCap);
  const researchEligible = normalizedHardGateBlockers.length === 0;
  const proposalEligible = researchEligible && normalizedScoreBlockers.length === 0;

  return {
    policyVersion: MANDATE_POLICY_VERSION,
    phase: "entry",
    agentId,
    mandateId: policy.mandateId,
    mandateVersion: policy.mandateVersion,
    asOf,
    // `eligible` deliberately means full mandate/proposal eligibility. A caller
    // that only wants to run supervised synthesis must use researchEligible and
    // must preserve the separate non-actionable score state.
    eligible: proposalEligible,
    researchEligible,
    proposalEligible,
    status: proposalEligible ? "eligible" : researchEligible ? "research_only" : "blocked",
    score: scoreResult.score,
    tier,
    targetWeightRangePct: tier?.targetWeight ?? null,
    maximumPositionWeightPct: policy.entry.maximumPositionWeightPct,
    macro,
    diagnostics,
    evidenceRequirements: policy.entryEvidence,
    evidenceLineage: evidenceLineage(reader),
    hardGateBlockers: normalizedHardGateBlockers,
    scoreBlockers: normalizedScoreBlockers,
    blockers: normalized,
  };
}

/**
 * Supported deterministic gates only. This allows equal supervised research
 * machinery to run before every v3 scoring input is available, while keeping
 * proposal eligibility false and the incomplete mandate score explicit.
 */
export function evaluateMandateHardGates({ agentId, evidence = {}, asOf, scoreObservation = null }) {
  return evaluateMandateEntry({
    agentId,
    evidence,
    asOf,
    scoreObservation,
  });
}

/**
 * Evaluate the specialist's requested research size before the shared risk
 * engine is allowed to clamp it further. Agent Four/human may fund below a
 * mandate tier minimum; this function therefore enforces upper bounds only.
 */
export function evaluateMandateSizing({
  agentId,
  evidence = {},
  asOf,
  scoringInput = null,
  scoreObservation = null,
}) {
  if (!validInstant(asOf)) throw new TypeError("asOf must be a zoned ISO instant.");
  const policy = mandatePolicyFor(agentId);
  const entry = evaluateMandateEntry({
    agentId,
    evidence,
    asOf,
    scoringInput,
    scoreObservation,
  });
  const reader = evidenceReader(evidence, asOf);
  const requested = reader.read("requestedWeightPct");
  const projectedPosition = reader.read("projectedPositionWeightPct");
  const projectedSector = reader.read("projectedSectorWeightPct");
  const projectedCash = policy.entry.minimumAttributedCashReservePct == null
    ? null
    : reader.read("projectedAttributedCashPct");
  const blockers = [...entry.blockers, ...reader.blockers];
  const requestedPct = requireFinite(requested, "requestedWeightPct", blockers);
  const positionPct = requireFinite(projectedPosition, "projectedPositionWeightPct", blockers);
  const sectorPct = requireFinite(projectedSector, "projectedSectorWeightPct", blockers);
  const cashPct = policy.entry.minimumAttributedCashReservePct == null
    ? null
    : requireFinite(projectedCash, "projectedAttributedCashPct", blockers);
  const tier = entry.tier;
  if (requestedPct != null && (!tier || requestedPct > tier.targetWeight[1])) {
    blockers.push(blocker("requested_weight_above_conviction_tier"));
  }
  if (positionPct != null && positionPct > policy.entry.maximumPositionWeightPct) {
    blockers.push(blocker("projected_position_above_mandate_cap"));
  }
  if (sectorPct != null && sectorPct > policy.entry.maximumSectorWeightPct) {
    blockers.push(blocker("projected_sector_above_mandate_cap"));
  }
  if (cashPct != null && cashPct < policy.entry.minimumAttributedCashReservePct) {
    blockers.push(blocker("projected_cash_below_mandate_reserve"));
  }
  const normalized = normalizeBlockers(blockers);
  return {
    policyVersion: MANDATE_POLICY_VERSION,
    phase: "sizing",
    agentId,
    mandateId: policy.mandateId,
    mandateVersion: policy.mandateVersion,
    asOf,
    eligible: normalized.length === 0,
    status: normalized.length === 0 ? "eligible" : "blocked",
    tier,
    entry,
    maximumPositionWeightPct: policy.entry.maximumPositionWeightPct,
    maximumSectorWeightPct: policy.entry.maximumSectorWeightPct,
    minimumAttributedCashReservePct: policy.entry.minimumAttributedCashReservePct,
    evidenceLineage: [...entry.evidenceLineage, ...evidenceLineage(reader)]
      .filter((item, index, all) => all.findIndex((candidate) => candidate.evidenceId === item.evidenceId) === index)
      .sort((left, right) => left.evidenceId.localeCompare(right.evidenceId)),
    blockers: normalized,
  };
}

function businessDaysBetween(from, to) {
  const start = new Date(`${from.slice(0, 10)}T00:00:00Z`);
  const end = new Date(`${to.slice(0, 10)}T00:00:00Z`);
  if (start >= end) return 0;
  let count = 0;
  for (let cursor = new Date(start.getTime() + DAY_MS); cursor <= end; cursor = new Date(cursor.getTime() + DAY_MS)) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) count += 1;
  }
  return count;
}

function reviewCadence(policy, values, blockers, records, asOf) {
  const lastSession = requireInstantValue(values.lastCompletedSessionAt, "lastCompletedSessionAt", blockers);
  const lastDaily = requireInstantValue(values.lastDailyMonitorAt, "lastDailyMonitorAt", blockers);
  const lastWeekly = requireInstantValue(values.lastWeeklyRescoreAt, "lastWeeklyRescoreAt", blockers);
  const latestEarnings = records.latestEarningsAt?.notApplicable
    ? null
    : requireInstantValue(values.latestEarningsAt, "latestEarningsAt", blockers);
  const lastEarningsReview = records.lastEarningsReunderwriteAt?.notApplicable
    ? null
    : requireInstantValue(values.lastEarningsReunderwriteAt, "lastEarningsReunderwriteAt", blockers);
  const latestEvent = records.latestMaterialEventAt?.notApplicable
    ? null
    : requireInstantValue(values.latestMaterialEventAt, "latestMaterialEventAt", blockers);
  const lastEventReview = records.lastMaterialEventReunderwriteAt?.notApplicable
    ? null
    : requireInstantValue(values.lastMaterialEventReunderwriteAt, "lastMaterialEventReunderwriteAt", blockers);

  const due = [];
  if (lastSession && lastDaily && Date.parse(lastDaily) < Date.parse(lastSession)) due.push("daily_monitor");
  if (lastSession && lastWeekly
    && businessDaysBetween(lastWeekly, lastSession) >= policy.cadence.weeklyRescoreBusinessDays) {
    due.push("weekly_rescore");
  }
  if (latestEarnings && (!lastEarningsReview || Date.parse(lastEarningsReview) < Date.parse(latestEarnings))) {
    due.push("earnings_reunderwrite");
  }
  if (latestEvent && (!lastEventReview || Date.parse(lastEventReview) < Date.parse(latestEvent))) {
    due.push("material_event_reunderwrite");
  }
  if (policy.agentId === "agent-3") {
    const annual = requireInstantValue(values.lastAnnualReunderwriteAt, "lastAnnualReunderwriteAt", blockers);
    if (annual && (Date.parse(asOf) - Date.parse(annual)) / DAY_MS >= policy.cadence.annualReunderwriteDays) {
      due.push("annual_reunderwrite");
    }
  }
  return sortedUnique(due);
}

function triggerValue(values, evidenceId, blockers, type = "boolean") {
  return type === "number"
    ? requireFinite(values[evidenceId], evidenceId, blockers)
    : requireBoolean(values[evidenceId], evidenceId, blockers);
}

function upgradeExit(current, candidate) {
  const order = { NO_EXIT: 0, REVIEW_REQUIRED: 1, SELL_PARTIAL: 2, SELL_FULL: 3 };
  return order[candidate.action] > order[current.action] ? candidate : current;
}

function evaluateHoldingTriggers(policy, values, blockers, due) {
  let result = {
    action: due.length ? "REVIEW_REQUIRED" : "NO_EXIT",
    urgency: due.length ? "routine" : "none",
    reasonCodes: due.map((item) => `cadence_due:${item}`),
  };
  const credibility = triggerValue(values, "criticalCredibilityEvent", blockers);
  if (credibility === true) {
    result = upgradeExit(result, { action: "SELL_FULL", urgency: "critical", reasonCodes: ["critical_credibility_event"] });
  }

  if (policy.agentId === "agent-1") {
    const atr = triggerValue(values, "atrFrom20SessionHigh", blockers, "number");
    const rsBroken = triggerValue(values, "relativeStrengthBroken", blockers);
    const epsImproving = triggerValue(values, "epsTrendImproving", blockers);
    const fundamental = triggerValue(values, "fundamentalFullExitTrigger", blockers);
    const momentum = triggerValue(values, "momentumDeteriorationTrigger", blockers);
    const tradingDays = triggerValue(values, "tradingDaysSinceEntry", blockers, "number");
    const progress = triggerValue(values, "thesisProgress", blockers);
    const catalyst = triggerValue(values, "datedCatalystWithin10TradingDays", blockers);
    const tierDrop = triggerValue(values, "convictionTierDrop", blockers, "number");
    const exitPolicy = policy.exit;
    if (fundamental === true) result = upgradeExit(result, { action: "SELL_FULL", urgency: "critical", reasonCodes: ["fundamental_full_exit_trigger"] });
    if (atr != null && atr >= exitPolicy.atrFullExitThreshold && !(epsImproving === true && fundamental === false)) {
      result = upgradeExit(result, { action: "SELL_FULL", urgency: "elevated", reasonCodes: ["atr_2_5_exit_ladder"] });
    } else if (atr != null && atr >= exitPolicy.atrPartialExitThreshold && rsBroken === true) {
      result = upgradeExit(result, { action: "SELL_PARTIAL", urgency: "elevated", reasonCodes: ["atr_2_0_and_relative_strength_break"] });
    } else if (atr != null && atr >= exitPolicy.atrReviewThreshold) {
      result = upgradeExit(result, { action: "REVIEW_REQUIRED", urgency: "routine", reasonCodes: ["atr_1_5_review_ladder"] });
    }
    if (momentum === true) result = upgradeExit(result, { action: "SELL_PARTIAL", urgency: "elevated", reasonCodes: ["momentum_deterioration"] });
    if (tradingDays != null && progress === false) {
      if (tradingDays >= policy.cadence.deadTradeExitTradingDays && catalyst === false) result = upgradeExit(result, { action: "SELL_FULL", urgency: "routine", reasonCodes: ["dead_trade_40_day_exit"] });
      else if (tradingDays >= policy.cadence.deadTradeTrimTradingDays) result = upgradeExit(result, { action: "SELL_PARTIAL", urgency: "routine", reasonCodes: ["dead_trade_30_day_trim"] });
      else if (tradingDays >= policy.cadence.deadTradeReviewTradingDays) result = upgradeExit(result, { action: "REVIEW_REQUIRED", urgency: "routine", reasonCodes: ["dead_trade_20_day_review"] });
    }
    if (tierDrop != null && tierDrop >= 1) result = upgradeExit(result, { action: "SELL_PARTIAL", urgency: "routine", reasonCodes: ["conviction_tier_drop"] });
  } else if (policy.agentId === "agent-2") {
    const below50 = triggerValue(values, "consecutiveClosesBelow50Day", blockers, "number");
    const rsWeeks = triggerValue(values, "relativeStrengthDecliningWeeks", blockers, "number");
    const below200 = triggerValue(values, "priceBelow200DayAverage", blockers);
    const revDecel = triggerValue(values, "consecutiveRevenueDecelerationQuarters", blockers, "number");
    const epsDecel = triggerValue(values, "consecutiveEpsDecelerationQuarters", blockers, "number");
    const guidanceReset = triggerValue(values, "guidanceTrajectoryReset", blockers);
    const deadQuarters = triggerValue(values, "quartersFlatOrUnderperformingSpy", blockers, "number");
    const catalyst = triggerValue(values, "datedCatalystPresent", blockers);
    const tierDrop = triggerValue(values, "convictionTierDrop", blockers, "number");
    const trendBreak = below50 != null && rsWeeks != null && below50 >= 5 && rsWeeks >= 4;
    if (trendBreak && below200 === true) {
      result = upgradeExit(result, { action: "SELL_FULL", urgency: "elevated", reasonCodes: ["confirmed_50_200_day_trend_break"] });
    } else if (trendBreak) {
      result = upgradeExit(result, { action: "SELL_PARTIAL", urgency: "elevated", reasonCodes: ["confirmed_50_day_relative_strength_break"] });
    }
    if ((revDecel != null && revDecel >= 2) || (epsDecel != null && epsDecel >= 2) || guidanceReset === true) {
      result = upgradeExit(result, { action: "SELL_FULL", urgency: "elevated", reasonCodes: ["multi_quarter_fundamental_deterioration"] });
    }
    if (deadQuarters != null && deadQuarters >= 2 && catalyst === false) {
      result = upgradeExit(result, { action: "SELL_FULL", urgency: "routine", reasonCodes: ["two_quarter_dead_money"] });
    }
    if (tierDrop != null && tierDrop >= 1) result = upgradeExit(result, { action: "SELL_PARTIAL", urgency: "routine", reasonCodes: ["conviction_tier_drop"] });
  } else {
    const structural = triggerValue(values, "structuralFullExitTrigger", blockers);
    const businessScore = triggerValue(values, "businessEvidenceScoreExValuation", blockers, "number");
    const currentWeight = triggerValue(values, "currentWeightPct", blockers, "number");
    const valuationPercentile = triggerValue(values, "valuationHistoricalPercentile", blockers, "number");
    if (structural === true) result = upgradeExit(result, { action: "SELL_FULL", urgency: "elevated", reasonCodes: ["structural_full_exit_trigger"] });
    if (businessScore != null && businessScore < 65) {
      result = upgradeExit(result, { action: "REVIEW_REQUIRED", urgency: "elevated", reasonCodes: ["annual_or_event_reunderwrite_below_65"] });
    }
    if (currentWeight != null && currentWeight > 25) {
      result = upgradeExit(result, { action: "SELL_PARTIAL", urgency: "routine", reasonCodes: ["position_drift_above_25_pct"] });
    }
    if (valuationPercentile != null && valuationPercentile >= 0.9) {
      result = upgradeExit(result, { action: "SELL_PARTIAL", urgency: "routine", reasonCodes: ["valuation_top_decile_trim_review"] });
    }
  }
  return { ...result, reasonCodes: sortedUnique(result.reasonCodes) };
}

/**
 * Evaluate monitor coverage, re-underwrite cadence, and mandate exit-review
 * rules for one attributed holding. Results are research reviews, never orders.
 */
export function evaluateMandateHolding({ agentId, evidence = {}, asOf }) {
  if (!validInstant(asOf)) throw new TypeError("asOf must be a zoned ISO instant.");
  const policy = mandatePolicyFor(agentId);
  const reader = evidenceReader(evidence, asOf);
  const nullableEvents = new Set([
    "latestEarningsAt",
    "lastEarningsReunderwriteAt",
    "latestMaterialEventAt",
    "lastMaterialEventReunderwriteAt",
  ]);
  for (const evidenceId of policy.holdingEvidence) {
    reader.read(evidenceId, { allowNotApplicable: nullableEvents.has(evidenceId) });
  }
  const blockers = [...reader.blockers];
  const due = reviewCadence(policy, reader.values, blockers, reader.records, asOf);
  let result = evaluateHoldingTriggers(policy, reader.values, blockers, due);
  const normalized = normalizeBlockers(blockers);
  if (normalized.length && result.action === "NO_EXIT") {
    result = { action: "REVIEW_REQUIRED", urgency: "elevated", reasonCodes: ["holding_evidence_incomplete"] };
  }

  return {
    policyVersion: MANDATE_POLICY_VERSION,
    phase: "holding",
    agentId,
    mandateId: policy.mandateId,
    mandateVersion: policy.mandateVersion,
    asOf,
    coverageComplete: normalized.length === 0,
    additionsFrozen: normalized.length > 0 || due.length > 0,
    dueReviews: due,
    ...result,
    evidenceRequirements: policy.holdingEvidence,
    evidenceLineage: evidenceLineage(reader),
    blockers: normalized,
  };
}

/**
 * Apply the mandate's add/averaging-down accounting. Agent Three's one-add
 * limit is evaluated from durable filled-add identifiers supplied by the caller;
 * missing history blocks instead of assuming zero.
 */
export function evaluateMandateAdd({
  agentId,
  evidence = {},
  asOf,
  scoringInput = null,
  scoreObservation = null,
  proposedAddId = null,
}) {
  const policy = mandatePolicyFor(agentId);
  const entry = evaluateMandateEntry({ agentId, evidence, asOf, scoringInput, scoreObservation });
  const reader = evidenceReader(evidence, asOf);
  const isExisting = reader.read("isExistingPosition");
  const isUnderwater = reader.read("isUnderwater");
  const projectedWeight = reader.read("projectedWeightPct");
  const blockers = [...entry.blockers, ...reader.blockers];
  const existing = requireBoolean(isExisting, "isExistingPosition", blockers);
  const underwater = requireBoolean(isUnderwater, "isUnderwater", blockers);
  const projected = requireFinite(projectedWeight, "projectedWeightPct", blockers);

  if (existing !== true) blockers.push(blocker("add_requires_existing_position"));
  if (projected != null && projected > policy.add.maximumPositionWeightPct) {
    blockers.push(blocker("projected_position_above_add_cap"));
  }

  let priorFilledAddCount = null;
  if (policy.add.averagingDown === "prohibited") {
    if (underwater === true) blockers.push(blocker("averaging_down_prohibited"));
  } else {
    const addHistory = reader.read("priorFilledAddIds");
    const reunderwriteAt = reader.read("fullReunderwriteAt");
    const thesisIntact = reader.read("thesisIntact");
    const declineCause = reader.read("declineCause");
    const criticalDataComplete = reader.read("criticalDataComplete");
    const liquidityWarning = reader.read("liquidityExitCapacityWarning");
    const nondisclosure = reader.read("companyNondisclosure");
    blockers.push(...reader.blockers);

    if (!Array.isArray(addHistory)
      || addHistory.some((id) => typeof id !== "string" || id.trim() !== id || id.length === 0)
      || new Set(addHistory).size !== addHistory.length) {
      blockers.push(blocker("add_history_invalid", "priorFilledAddIds"));
    } else {
      priorFilledAddCount = addHistory.length;
      if (addHistory.length >= policy.add.lifetimeAdds) blockers.push(blocker("lifetime_add_limit_reached"));
      if (proposedAddId && addHistory.includes(proposedAddId)) blockers.push(blocker("add_already_counted"));
    }
    requireInstantValue(reunderwriteAt, "fullReunderwriteAt", blockers);
    if (requireBoolean(thesisIntact, "thesisIntact", blockers) === false) blockers.push(blocker("thesis_not_intact"));
    if (requireBoolean(criticalDataComplete, "criticalDataComplete", blockers) === false) blockers.push(blocker("critical_data_incomplete"));
    if (requireBoolean(liquidityWarning, "liquidityExitCapacityWarning", blockers) === true) blockers.push(blocker("liquidity_exit_capacity_warning"));
    if (requireBoolean(nondisclosure, "companyNondisclosure", blockers) === true) blockers.push(blocker("company_nondisclosure"));
    if (!["market", "sector", "sentiment"].includes(declineCause)) blockers.push(blocker("decline_not_nonfundamental"));
    if ((entry.score?.total ?? 0) < policy.add.minimumFreshReunderwriteScore) blockers.push(blocker("reunderwrite_score_below_add_floor"));
  }

  const normalized = normalizeBlockers(blockers);
  return {
    policyVersion: MANDATE_POLICY_VERSION,
    phase: "add",
    agentId,
    mandateId: policy.mandateId,
    mandateVersion: policy.mandateVersion,
    asOf,
    eligible: normalized.length === 0,
    status: normalized.length === 0 ? "eligible" : "blocked",
    priorFilledAddCount,
    lifetimeAddLimit: policy.add.lifetimeAdds,
    entry,
    evidenceLineage: evidenceLineage(reader),
    blockers: normalized,
  };
}

/**
 * Convenience dispatcher for live integration without agent-specific branching.
 */
export function evaluateMandatePolicy({ phase, ...input }) {
  if (phase === "entry") return evaluateMandateEntry(input);
  if (phase === "holding") return evaluateMandateHolding(input);
  if (phase === "add") return evaluateMandateAdd(input);
  if (phase === "sizing") return evaluateMandateSizing(input);
  throw new Error(`Unknown mandate policy phase: ${phase}`);
}
