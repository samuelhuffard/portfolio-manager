/**
 * Deterministic rule checks applied to every structured AI recommendation
 * before it's written to the Sheet. The agent proposes; this engine decides
 * whether the proposal is admissible — downgrading to HOLD (never upgrading)
 * when a check fails, and clamping an oversized target weight rather than
 * rejecting the whole idea outright.
 */
export function applyRiskChecks(rec, context = {}, limits) {
  const {
    sector,
    currentSectorWeightPct = 0,
    currentPositionWeightPct = 0,
    isHeldAtLoss = false,
    dataStale = false,
    marketCap = null,
    avgDollarVolume = null,
  } = context;
  const checks = {
    within_universe: true,
    has_bear_case: true,
    confidence_ok: true,
    sector_ok: true,
    data_fresh: true,
    no_averaging_down: true,
    market_cap_ok: true,
    liquidity_ok: true,
  };
  const notes = [];
  const originalAction = rec.action;
  let action = rec.action;
  let targetWeight = rec.targetWeight ?? 0;

  // Stale data is a hard NO_TRADE gate, regardless of what the agent proposed
  // (the backend self-certifies data freshness — the agent isn't trusted to). This is
  // the engine-level backstop; lib/data-gates.js is the primary gate that runs earlier.
  if (limits.blockOnStaleData && dataStale) {
    checks.data_fresh = false;
    notes.push("required data stale/missing — forced NO_TRADE");
    return {
      ...rec,
      action: "HOLD",
      targetWeight: 0,
      ruleChecks: checks,
      overridden: originalAction !== "HOLD",
      overrideNotes: notes,
    };
  }

  // Never add to a losing position to reduce cost basis (Agent One memo: averaging down
  // is prohibited). A BUY into a currently-underwater existing holding is downgraded.
  if (action === "BUY" && limits.prohibitAveragingDown && currentPositionWeightPct > 0 && isHeldAtLoss) {
    checks.no_averaging_down = false;
    notes.push("blocked: would average down into a losing position");
    action = "HOLD";
  }

  if (limits.requireBearCase && action !== "HOLD") {
    const hasBearCase = (rec.risks?.length ?? 0) > 0 && (rec.killCriteria?.length ?? 0) > 0;
    checks.has_bear_case = hasBearCase;
    if (!hasBearCase) {
      notes.push("missing required risk/kill-criteria disclosure");
      action = "HOLD";
    }
  }

  if (action !== "HOLD") {
    // Missing/invalid confidence must FAIL the floor, not skip it — otherwise a
    // model response that omits confidence sails through the exact gate meant
    // to catch low-conviction output. Clamp to [0,1] so out-of-range values
    // can't game the comparison either.
    const confidence =
      typeof rec.confidence === "number" && Number.isFinite(rec.confidence)
        ? Math.min(1, Math.max(0, rec.confidence))
        : null;
    if (confidence == null) {
      checks.confidence_ok = false;
      notes.push(`confidence missing/invalid — treated as below the ${limits.minConfidence} floor`);
      action = "HOLD";
    } else if (confidence < limits.minConfidence) {
      checks.confidence_ok = false;
      notes.push(`confidence ${confidence.toFixed(2)} below ${limits.minConfidence} floor`);
      action = "HOLD";
    }
  }

  if (action === "BUY") {
    if (Number.isFinite(limits.minMarketCap) && (!Number.isFinite(marketCap) || marketCap < limits.minMarketCap)) {
      checks.market_cap_ok = false;
      notes.push(
        !Number.isFinite(marketCap)
          ? "market capitalization unavailable — forced NO_TRADE"
          : `market capitalization $${Math.round(marketCap).toLocaleString()} below $${limits.minMarketCap.toLocaleString()} floor`
      );
      action = "HOLD";
    }
    if (Number.isFinite(limits.minAvgDollarVolume) && (!Number.isFinite(avgDollarVolume) || avgDollarVolume < limits.minAvgDollarVolume)) {
      checks.liquidity_ok = false;
      notes.push(
        !Number.isFinite(avgDollarVolume)
          ? "average daily dollar volume unavailable — forced NO_TRADE"
          : `average daily dollar volume $${Math.round(avgDollarVolume).toLocaleString()} below $${limits.minAvgDollarVolume.toLocaleString()} floor`
      );
      action = "HOLD";
    }
    if (targetWeight > limits.maxPositionPct) {
      notes.push(`target weight clamped ${targetWeight}% → ${limits.maxPositionPct}% (max position size)`);
      targetWeight = limits.maxPositionPct;
    }
    // Exposure if this position moved from its current weight to the (possibly clamped)
    // target. For Agent One this is the v5 sub-vertical cap, even though the legacy
    // context field is named `sector`.
    const projectedSectorPct = currentSectorWeightPct - currentPositionWeightPct + targetWeight;
    const maxExposurePct = limits.maxSubVerticalPct ?? limits.maxSectorPct;
    if (sector && projectedSectorPct > maxExposurePct) {
      checks.sector_ok = false;
      notes.push(`"${sector}" exposure would reach ${projectedSectorPct.toFixed(1)}% (limit ${maxExposurePct}%)`);
      action = "HOLD";
    }
  } else {
    targetWeight = 0;
  }

  return {
    ...rec,
    action,
    targetWeight,
    ruleChecks: checks,
    overridden: action !== originalAction,
    overrideNotes: notes,
  };
}
