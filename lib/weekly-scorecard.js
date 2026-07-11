/**
 * Weekly review scorecard math (LOOP-DESIGN.md §2 cadence C). Pure functions:
 * jobs/weekly-review.js feeds in Redis proposals + Sheet recommendation
 * outcomes and gets back a deterministic scorecard; the single weekly LLM call
 * only ever sees this scorecard, never raw data.
 */

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const HORIZONS = [30, 90, 180];
const EVALUATOR_MIN_GRADED = 3;

function withinWindow(dateStr, now, windowMs) {
  const t = Date.parse(dateStr);
  return Number.isFinite(t) && now - t <= windowMs && t <= now;
}

/**
 * @param proposals  all proposals from Redis (any agent — filtered here)
 * @param outcomes   rows from readAgentRecommendationOutcomes (this agent's tab)
 * @param now        ms epoch (injectable for tests)
 */
export function computeWeeklyScorecard({ agentId, proposals = [], outcomes = [], now = Date.now() }) {
  const week = proposals.filter((p) => p?.agentId === agentId && withinWindow(p.createdAt, now, WEEK_MS));
  const proposalStats = {
    created: week.length,
    accepted: week.filter((p) => p.status === "ApprovedForBrokerReview").length,
    rejected: week.filter((p) => p.status === "Rejected").length,
    expired: week.filter((p) => p.status === "Expired").length,
    pending: week.filter((p) => p.status === "Pending").length,
    fulfilled: week.filter((p) => p.fulfilledAt).length,
    buys: week.filter((p) => p.side === "BUY").length,
    sells: week.filter((p) => p.side === "SELL").length,
  };

  const weekRows = outcomes.filter((r) => withinWindow(r.date, now, WEEK_MS));
  const weekActivity = {
    scanned: weekRows.length,
    actionable: weekRows.filter((r) => r.action === "BUY" || r.action === "SELL").length,
    dataGateBlocked: weekRows.filter((r) => (r.ruleCheck ?? "").includes("data_gate_blocked")).length,
    evaluatorRejected: weekRows.filter((r) => (r.ruleCheck ?? "").includes("evaluator_reject")).length,
    evaluatorApproved: weekRows.filter((r) => (r.ruleCheck ?? "").includes("evaluator: APPROVE")).length,
    scanErrors: weekRows.filter((r) => (r.ruleCheck ?? "").includes("scan_error")).length,
  };

  // Matured track record across ALL history (not just this week) — the weekly
  // lesson generator needs the accumulated calibration picture.
  const trackRecord = {};
  for (const h of HORIZONS) {
    const matured = outcomes.filter((r) => r[`hit${h}`] === "✅" || r[`hit${h}`] === "❌");
    const hits = matured.filter((r) => r[`hit${h}`] === "✅").length;
    const rets = matured.map((r) => r[`return${h}`]).filter((v) => Number.isFinite(v));
    const alphas = matured.map((r) => r[`alpha${h}`]).filter((v) => Number.isFinite(v));
    trackRecord[h] = {
      matured: matured.length,
      hitRate: matured.length ? Math.round((hits / matured.length) * 1000) / 10 : null,
      avgReturnPct: rets.length ? Math.round((rets.reduce((a, b) => a + b, 0) / rets.length) * 100) / 100 : null,
      avgAlphaPct: alphas.length ? Math.round((alphas.reduce((a, b) => a + b, 0) / alphas.length) * 100) / 100 : null,
    };
  }

  // Confidence calibration on 30d-matured non-HOLD calls: stated confidence vs realized hit rate.
  const calibrationRows = outcomes.filter(
    (r) => (r.action === "BUY" || r.action === "SELL") && (r.hit30 === "✅" || r.hit30 === "❌") && Number.isFinite(r.confidence)
  );
  const calibration = calibrationRows.length
    ? {
        calls: calibrationRows.length,
        avgStatedConfidence:
          Math.round((calibrationRows.reduce((a, r) => a + r.confidence, 0) / calibrationRows.length) * 100) / 100,
        realizedHitRate:
          Math.round((calibrationRows.filter((r) => r.hit30 === "✅").length / calibrationRows.length) * 1000) / 10,
      }
    : null;

  const evaluatorHealth = classifyEvaluatorHealth(weekActivity);

  return { agentId, weekEnding: new Date(now).toISOString().slice(0, 10), proposalStats, weekActivity, evaluatorHealth, trackRecord, calibration };
}

export function classifyEvaluatorHealth(weekActivity = {}, previousHealth = null) {
  const approved = weekActivity.evaluatorApproved ?? 0;
  const rejected = weekActivity.evaluatorRejected ?? 0;
  const graded = approved + rejected;
  if (graded < EVALUATOR_MIN_GRADED) {
    return {
      status: "insufficient_sample",
      band: "insufficient_sample",
      graded,
      approvalRatePct: null,
      consecutiveOutOfBand: false,
      reason: `only ${graded} evaluator-graded actionable candidate(s); need ${EVALUATOR_MIN_GRADED}+ to judge evaluator health`,
    };
  }

  const approvalRatePct = Math.round((approved / graded) * 1000) / 10;
  const band = approvalRatePct < 20 ? "too_strict" : approvalRatePct > 80 ? "too_permissive" : "healthy";
  const consecutiveOutOfBand =
    band !== "healthy" &&
    previousHealth?.band === band &&
    previousHealth?.graded >= EVALUATOR_MIN_GRADED;
  return {
    status: consecutiveOutOfBand ? "critical" : band,
    band,
    graded,
    approvalRatePct,
    consecutiveOutOfBand,
    reason:
      band === "healthy"
        ? `approval rate ${approvalRatePct}% is inside the 20-80% healthy band`
        : `${approvalRatePct}% evaluator approval rate is ${band === "too_strict" ? "below" : "above"} the 20-80% healthy band`,
  };
}

export function formatScorecardForPrompt(scorecard) {
  const { proposalStats: p, weekActivity: w, trackRecord: t, calibration: c } = scorecard;
  const lines = [
    `Agent: ${scorecard.agentId} — week ending ${scorecard.weekEnding}`,
    `Proposals this week: ${p.created} created (${p.buys} BUY / ${p.sells} SELL) — ${p.accepted} accepted, ${p.rejected} rejected by the manager, ${p.expired} expired unreviewed, ${p.pending} still pending, ${p.fulfilled} executed.`,
    `Scan activity this week: ${w.scanned} reviews, ${w.actionable} actionable calls, ${w.dataGateBlocked} blocked by data gates, ${w.evaluatorRejected} rejected by the evaluator, ${w.scanErrors} scan errors.`,
    `Evaluator health: ${scorecard.evaluatorHealth.reason}${scorecard.evaluatorHealth.consecutiveOutOfBand ? " (same out-of-band condition two weeks in a row)" : ""}.`,
  ];
  for (const h of [30, 90, 180]) {
    const r = t[h];
    if (r?.matured) {
      lines.push(`Track record ${h}d (all history): ${r.matured} matured calls, hit rate ${r.hitRate}%, avg return ${r.avgReturnPct}%, avg alpha vs SPY ${r.avgAlphaPct}%.`);
    }
  }
  if (c) {
    lines.push(`Calibration (30d): avg stated confidence ${c.avgStatedConfidence} vs realized hit rate ${c.realizedHitRate}% over ${c.calls} calls.`);
  }
  return lines.join("\n");
}

/**
 * Parses the weekly-review model output. Pure, fail-closed: malformed output
 * yields zero lessons (a silent no-lesson week is safe; a garbage memory isn't).
 */
export function parseWeeklyLessons(text) {
  const jsonMatch = (text ?? "").match(/\{[\s\S]*\}/);
  try {
    const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : text);
    return {
      lessons: Array.isArray(parsed.lessons)
        ? parsed.lessons.filter((l) => typeof l === "string" && l.trim()).slice(0, 3)
        : [],
      retire: Array.isArray(parsed.retire) ? parsed.retire.filter((r) => typeof r === "string" && r.trim()) : [],
      parseError: false,
    };
  } catch {
    return { lessons: [], retire: [], parseError: true };
  }
}
