/**
 * Truthful accounting for per-ticker research outcomes.
 *
 * This module deliberately consumes structured facts from the decision site.
 * Recommendation rationale is private model text and is not a reliable event
 * taxonomy, so legacy Sheet rows must remain explicitly unclassifiable.
 */

export const RESEARCH_OUTCOME_VERSION = "research-outcomes-v1";

export const RESEARCH_OUTCOME_KINDS = Object.freeze([
  "investment_hold",
  "data_gate",
  "stale_data",
  "budget_exhausted",
  "review_error",
  "evaluator_reject",
  "evaluator_error",
  "risk_downgrade",
  "duplicate",
  "proposal_blocked",
  "queue_error",
  "paper_only",
  "proposal_created",
  "unknown",
]);

// These are degraded or failed review outcomes, not investment judgments. A
// completed scan containing any of them must not be reported as a clean run.
export const RESEARCH_FAILURE_OUTCOMES = Object.freeze([
  "budget_exhausted",
  "review_error",
  "evaluator_error",
  "queue_error",
  "unknown",
]);

const OUTCOME_SET = new Set(RESEARCH_OUTCOME_KINDS);
const ACTIONS = new Set(["BUY", "SELL", "HOLD"]);
const EVALUATOR_STATES = new Set(["not_run", "approved", "rejected", "error"]);
const PROPOSAL_DISPOSITIONS = new Set(["not_applicable", "created", "blocked", "queue_error", "paper_only"]);
const FAILURE_KINDS = new Set(["budget_exhausted", "review_error", null]);

export function blankOutcomeCounts() {
  return Object.fromEntries(RESEARCH_OUTCOME_KINDS.map((kind) => [kind, 0]));
}

export function addOutcome(counts, kind) {
  if (!OUTCOME_SET.has(kind)) throw new TypeError(`Unknown research outcome: ${kind}`);
  const next = { ...blankOutcomeCounts(), ...(counts ?? {}) };
  if (!Number.isInteger(next[kind]) || next[kind] < 0) throw new TypeError(`Invalid count for research outcome: ${kind}`);
  next[kind] += 1;
  return next;
}

export function outcomeTotal(counts) {
  return RESEARCH_OUTCOME_KINDS.reduce((total, kind) => {
    const value = counts?.[kind] ?? 0;
    if (!Number.isInteger(value) || value < 0) throw new TypeError(`Invalid count for research outcome: ${kind}`);
    return total + value;
  }, 0);
}

export function assertOutcomeConservation(counts, attemptedReviews) {
  if (!Number.isInteger(attemptedReviews) || attemptedReviews < 0) {
    throw new TypeError("attemptedReviews must be a non-negative integer");
  }
  const total = outcomeTotal(counts);
  if (total !== attemptedReviews) {
    throw new Error(`Research outcome conservation failed: classified ${total}, attempted ${attemptedReviews}`);
  }
  return true;
}

export function researchOutcomeCountsHaveFailures(counts) {
  return RESEARCH_FAILURE_OUTCOMES.some((kind) => {
    const value = counts?.[kind] ?? 0;
    if (!Number.isInteger(value) || value < 0) throw new TypeError(`Invalid count for research outcome: ${kind}`);
    return value > 0;
  });
}

/**
 * Classify a whole scan run against the frozen receipt vocabulary
 * (`ok` | `degraded` | `failed`), WITHOUT changing the legacy `status` field or
 * the deliberate throw that keeps a broken scan from counting as a clean
 * Phase 0 day.
 *
 * The defect this addresses: one provider error on one candidate produced the
 * same top-level signal as a pipeline that never ran. The live 2026-09-20 run
 * completed 9 investment HOLDs and hit a single Anthropic 500 on one name, and
 * was recorded identically to a total failure — `status: "failed"`, receipt
 * `ok: false`, no way to tell the two apart without reading per-agent detail.
 *
 * This function only reports. It deliberately does NOT decide whether a
 * `degraded` run may count toward an observation window — that judgement belongs
 * to the observer, not to the job emitting the facts.
 *
 * `reason` values are stable codes for diagnosis. They never carry a ticker,
 * rationale, prompt, or provider message.
 */
export function classifyResearchRunOutcome(agentSummaries) {
  if (!Array.isArray(agentSummaries)) throw new TypeError("agentSummaries must be an array");

  const aborted = agentSummaries.filter((agent) => agent?.status === "failed");
  const failureCount = agentSummaries.reduce((total, agent) => total
    + RESEARCH_FAILURE_OUTCOMES.reduce((sum, kind) => sum + (agent?.outcomeCounts?.[kind] ?? 0), 0), 0);
  const attempted = agentSummaries.reduce((total, agent) => total + (agent?.attemptedReviews ?? 0), 0);
  const succeeded = attempted - failureCount;

  // Per-kind totals so a provider outage (review_error) is distinguishable from
  // a budget wall (budget_exhausted) or a queue defect (queue_error).
  const failuresByKind = Object.fromEntries(
    RESEARCH_FAILURE_OUTCOMES
      .map((kind) => [kind, agentSummaries.reduce((sum, agent) => sum + (agent?.outcomeCounts?.[kind] ?? 0), 0)])
      .filter(([, value]) => value > 0),
  );

  const detail = {
    attemptedReviews: attempted,
    succeededReviews: succeeded,
    failedReviews: failureCount,
    abortedAgents: aborted.map((agent) => agent.agentId).filter(Boolean).sort(),
    failuresByKind,
  };

  // An agent that threw never produced a classifiable slate, so its silence is
  // not evidence of anything. That outranks per-review accounting.
  if (aborted.length > 0) return { outcome: "failed", reason: "agent_run_aborted", detail };
  if (failureCount === 0) return { outcome: "ok", reason: null, detail };
  // Every attempted review failed: no usable research came out of the run.
  if (succeeded <= 0) return { outcome: "failed", reason: "all_reviews_failed", detail };
  return { outcome: "degraded", reason: "partial_review_failures", detail };
}

function isBoolean(value) {
  return typeof value === "boolean";
}

function isValidFailureKind(value) {
  return FAILURE_KINDS.has(value ?? null);
}

function factsAreContradictory(facts) {
  const {
    attempted,
    dataGateBlocked,
    dataGateStale,
    failureKind,
    generatorAction,
    finalAction,
    riskOverridden,
    evaluatorState,
    duplicateOpen,
    proposalDisposition,
  } = facts;

  if (attempted !== true) return true;
  if (![dataGateBlocked, dataGateStale, riskOverridden, duplicateOpen].every(isBoolean)) return true;
  if (!isValidFailureKind(failureKind)) return true;
  if (generatorAction != null && !ACTIONS.has(generatorAction)) return true;
  if (finalAction != null && !ACTIONS.has(finalAction)) return true;
  if (!EVALUATOR_STATES.has(evaluatorState) || !PROPOSAL_DISPOSITIONS.has(proposalDisposition)) return true;

  if (dataGateStale && !dataGateBlocked) return true;
  if (dataGateBlocked && (generatorAction != null || evaluatorState !== "not_run" || proposalDisposition !== "not_applicable" || finalAction !== "HOLD")) return true;
  if (failureKind != null && (dataGateBlocked || dataGateStale || evaluatorState !== "not_run" || proposalDisposition !== "not_applicable")) return true;
  if (duplicateOpen && (finalAction === "HOLD" || proposalDisposition !== "not_applicable")) return true;
  if (proposalDisposition === "created" && finalAction === "HOLD") return true;
  if (proposalDisposition === "paper_only" && finalAction === "HOLD") return true;
  if (evaluatorState === "approved" && finalAction === "HOLD") return true;
  if (evaluatorState === "rejected" && finalAction !== "HOLD") return true;
  if (evaluatorState === "error" && finalAction !== "HOLD") return true;
  if (riskOverridden && (generatorAction == null || generatorAction === "HOLD" || finalAction !== "HOLD")) return true;
  if (proposalDisposition !== "not_applicable" && finalAction === "HOLD" && !["created"].includes(proposalDisposition)) return true;
  return false;
}

/**
 * Classify one attempted review. Facts are intentionally explicit so a future
 * report cannot mistake a degraded-system HOLD for an investment judgment.
 */
export function classifyRecommendationOutcome(facts) {
  if (!facts || factsAreContradictory(facts)) return "unknown";
  const {
    dataGateBlocked,
    dataGateStale,
    failureKind,
    generatorAction,
    finalAction,
    riskOverridden,
    evaluatorState,
    duplicateOpen,
    proposalDisposition,
  } = facts;

  if (proposalDisposition === "created") return "proposal_created";
  if (failureKind === "budget_exhausted") return "budget_exhausted";
  if (failureKind === "review_error") return "review_error";
  if (dataGateStale) return "stale_data";
  if (dataGateBlocked) return "data_gate";
  if (evaluatorState === "error") return "evaluator_error";
  if (evaluatorState === "rejected") return "evaluator_reject";
  if (duplicateOpen) return "duplicate";
  if (proposalDisposition === "queue_error") return "queue_error";
  if (proposalDisposition === "paper_only") return "paper_only";
  if (proposalDisposition === "blocked") return "proposal_blocked";
  if (riskOverridden) return "risk_downgrade";
  if (generatorAction === "HOLD" && finalAction === "HOLD") return "investment_hold";
  return "unknown";
}

function summarizeAgentStatus(agent) {
  const counts = { ...blankOutcomeCounts(), ...(agent?.outcomeCounts ?? {}) };
  const attemptedReviews = Number.isInteger(agent?.attemptedReviews) ? agent.attemptedReviews : null;
  let conservationValid = false;
  if (attemptedReviews != null) {
    try {
      assertOutcomeConservation(counts, attemptedReviews);
      conservationValid = true;
    } catch {
      conservationValid = false;
    }
  }
  const classificationAvailable = agent?.classificationVersion === RESEARCH_OUTCOME_VERSION && conservationValid;
  return {
    agentId: agent?.agentId ?? null,
    attemptedReviews,
    outcomeCounts: counts,
    classificationVersion: agent?.classificationVersion ?? null,
    classificationAvailable,
    conservationValid,
    unknownOutcomeCount: counts.unknown,
  };
}

/** Build a private-text-free report from the latest Redis scan status. */
export function buildResearchRunReport(status) {
  if (!status || typeof status !== "object") {
    return { classificationAvailable: false, reason: "legacy_status_insufficient", status: null };
  }
  const agents = Array.isArray(status.agents) ? status.agents.map(summarizeAgentStatus) : [];
  const classificationAvailable = agents.length > 0 && agents.every((agent) => agent.classificationAvailable);
  if (!classificationAvailable) {
    return {
      classificationAvailable: false,
      reason: agents.some((agent) => agent.classificationVersion === RESEARCH_OUTCOME_VERSION && !agent.conservationValid)
        ? "outcome_conservation_failed"
        : "legacy_status_insufficient",
      runId: status.runId ?? null,
      source: status.source ?? null,
      status: status.status ?? null,
      startedAt: status.startedAt ?? null,
      completedAt: status.completedAt ?? null,
      agents,
    };
  }
  return {
    classificationAvailable: true,
    classificationVersion: RESEARCH_OUTCOME_VERSION,
    runId: status.runId ?? null,
    source: status.source ?? null,
    status: status.status ?? null,
    startedAt: status.startedAt ?? null,
    completedAt: status.completedAt ?? null,
    agents,
    totals: agents.reduce((acc, agent) => {
      acc.attemptedReviews += agent.attemptedReviews;
      for (const kind of RESEARCH_OUTCOME_KINDS) acc.outcomeCounts[kind] += agent.outcomeCounts[kind];
      return acc;
    }, { attemptedReviews: 0, outcomeCounts: blankOutcomeCounts() }),
  };
}

export function formatResearchRunReport(report) {
  if (!report?.classificationAvailable) {
    return `Research run ${report?.runId ?? "unknown"} is not classifiable: ${report?.reason ?? "legacy_status_insufficient"}.`;
  }
  const totals = report.totals;
  return `Research run ${report.runId ?? "unknown"}: ${totals.attemptedReviews} attempted; ${totals.outcomeCounts.investment_hold} investment HOLD; ${totals.outcomeCounts.proposal_created} proposals created; ${totals.outcomeCounts.unknown} unknown.`;
}
