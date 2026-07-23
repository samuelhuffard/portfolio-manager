/**
 * Truthful accounting for per-ticker research outcomes.
 *
 * This module deliberately consumes structured facts from the decision site.
 * Recommendation rationale is private model text and is not a reliable event
 * taxonomy, so legacy Sheet rows must remain explicitly unclassifiable.
 */

import { RESEARCH_FUNNEL_VERSION } from "./research-funnel.js";

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

// A report may group outcomes for humans, but it must never turn operational
// degradation or unavailable evidence into an investment judgment. Each outcome
// appears in exactly one bucket so the grouped totals remain reconcilable.
export const RESEARCH_OUTCOME_GROUPS = Object.freeze({
  investmentJudgments: Object.freeze(["investment_hold"]),
  dataUnavailable: Object.freeze(["data_gate", "stale_data"]),
  operationalDegradation: Object.freeze(["budget_exhausted", "review_error", "evaluator_error", "queue_error"]),
  decisionBlocked: Object.freeze(["evaluator_reject", "risk_downgrade", "duplicate", "proposal_blocked", "paper_only"]),
  proposalsCreated: Object.freeze(["proposal_created"]),
  unknown: Object.freeze(["unknown"]),
});

const OUTCOME_SET = new Set(RESEARCH_OUTCOME_KINDS);
const ACTIONS = new Set(["BUY", "SELL", "HOLD"]);
const EVALUATOR_STATES = new Set(["not_run", "approved", "rejected", "error"]);
const PROPOSAL_DISPOSITIONS = new Set(["not_applicable", "created", "blocked", "queue_error", "paper_only"]);
const FAILURE_KINDS = new Set(["budget_exhausted", "review_error", null]);
const FUNNEL_FIELDS = Object.freeze([
  "cataloged", "visible", "discoveryEligible", "discoveryScreenedOut", "slate",
  "fundamentalsRequested", "fundamentalsAvailable", "fundamentalsUnavailable",
  "candidatesBuilt", "freshScreenPassed", "freshScreenRejected", "mandatoryHoldingOverrides",
  "deepReviews", "dataBlocked", "generatorHold", "generatorActionable", "riskDowngraded",
  "evaluatorApproved", "evaluatorRejected", "evaluatorErrored", "duplicateBlocked",
  "proposalBlocked", "proposalCreated", "reviewErrors",
]);

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
  const funnel = summarizeResearchFunnel(agent?.funnel, attemptedReviews);
  return {
    agentId: agent?.agentId ?? null,
    attemptedReviews,
    outcomeCounts: counts,
    classificationVersion: agent?.classificationVersion ?? null,
    classificationAvailable,
    conservationValid,
    unknownOutcomeCount: counts.unknown,
    funnel,
  };
}

// This report is dashboard-safe: only explicitly allow-listed aggregate counts
// can leave the backend. No ticker, prompt, rationale, evidence, or proposal
// text is retained here.
function summarizeResearchFunnel(funnel, attemptedReviews) {
  if (funnel?.version !== RESEARCH_FUNNEL_VERSION) return null;
  const projected = Object.fromEntries(FUNNEL_FIELDS.map((field) => {
    const value = funnel[field];
    return [field, Number.isInteger(value) && value >= 0 ? value : null];
  }));
  if (Object.values(projected).some((value) => value == null)) return null;
  if (projected.deepReviews !== attemptedReviews) return null;
  if (projected.proposalCreated > projected.deepReviews) return null;
  return { version: RESEARCH_FUNNEL_VERSION, ...projected };
}

function countOutcomes(counts, kinds) {
  return kinds.reduce((total, kind) => total + counts[kind], 0);
}

/**
 * Converts conserved outcome counts into an aggregate-only explanation of a
 * completed research run. It deliberately contains no tickers, rationale,
 * prompt text, or recommendation payloads.
 */
export function summarizeResearchRunQuality(report) {
  if (!report?.classificationAvailable) return null;
  const counts = report.totals.outcomeCounts;
  const summary = Object.fromEntries(Object.entries(RESEARCH_OUTCOME_GROUPS)
    .map(([name, kinds]) => [name, countOutcomes(counts, kinds)]));
  const groupedTotal = Object.values(summary).reduce((total, count) => total + count, 0);
  if (groupedTotal !== report.totals.attemptedReviews) {
    throw new Error(`Research quality grouping failed conservation: grouped ${groupedTotal}, attempted ${report.totals.attemptedReviews}`);
  }
  return {
    attemptedReviews: report.totals.attemptedReviews,
    ...summary,
    conservationValid: true,
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
  const report = {
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
  return { ...report, quality: summarizeResearchRunQuality(report) };
}

export function formatResearchRunReport(report) {
  if (!report?.classificationAvailable) {
    return `Research run ${report?.runId ?? "unknown"} is not classifiable: ${report?.reason ?? "legacy_status_insufficient"}.`;
  }
  const totals = report.totals;
  const quality = report.quality ?? summarizeResearchRunQuality(report);
  return `Research run ${report.runId ?? "unknown"}: ${quality.attemptedReviews} attempted; ${quality.investmentJudgments} investment HOLD; ${quality.dataUnavailable} data unavailable; ${quality.operationalDegradation} operational degradation; ${quality.decisionBlocked} decision blocked; ${quality.proposalsCreated} proposals created; ${quality.unknown} unknown.`;
}
