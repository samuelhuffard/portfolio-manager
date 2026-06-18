/**
 * Deterministic rule checks applied to every structured AI recommendation
 * before it's written to the Sheet. The agent proposes; this engine decides
 * whether the proposal is admissible — downgrading to HOLD (never upgrading)
 * when a check fails, and clamping an oversized target weight rather than
 * rejecting the whole idea outright.
 */
export function applyRiskChecks(rec, context = {}, limits) {
  const { sector, currentSectorWeightPct = 0, currentPositionWeightPct = 0 } = context;
  const checks = { within_universe: true, has_bear_case: true, confidence_ok: true, sector_ok: true };
  const notes = [];
  const originalAction = rec.action;
  let action = rec.action;
  let targetWeight = rec.targetWeight ?? 0;

  if (limits.requireBearCase && action !== "HOLD") {
    const hasBearCase = (rec.risks?.length ?? 0) > 0 && (rec.killCriteria?.length ?? 0) > 0;
    checks.has_bear_case = hasBearCase;
    if (!hasBearCase) {
      notes.push("missing required risk/kill-criteria disclosure");
      action = "HOLD";
    }
  }

  if (action !== "HOLD" && rec.confidence != null && rec.confidence < limits.minConfidence) {
    checks.confidence_ok = false;
    notes.push(`confidence ${rec.confidence.toFixed(2)} below ${limits.minConfidence} floor`);
    action = "HOLD";
  }

  if (action === "BUY") {
    if (targetWeight > limits.maxPositionPct) {
      notes.push(`target weight clamped ${targetWeight}% → ${limits.maxPositionPct}% (max position size)`);
      targetWeight = limits.maxPositionPct;
    }
    // Sector exposure if this position moved from its current weight to the (possibly clamped) target.
    const projectedSectorPct = currentSectorWeightPct - currentPositionWeightPct + targetWeight;
    if (sector && projectedSectorPct > limits.maxSectorPct) {
      checks.sector_ok = false;
      notes.push(`"${sector}" exposure would reach ${projectedSectorPct.toFixed(1)}% (limit ${limits.maxSectorPct}%)`);
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
