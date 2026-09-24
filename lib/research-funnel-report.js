import { RESEARCH_OUTCOME_VERSION } from "./research-run-report.js";

const AGENT_IDS = ["agent-1", "agent-2", "agent-3"];
export const RESEARCH_FUNNEL_RECEIPT_VERSION = "research-funnel-v1";
const FUNNEL_FIELDS = [
  "reviewBudget",
  "priorityCandidates",
  "exemptHoldingCandidates",
  "peerReadyCandidates",
  "deferredPriorityCandidates",
  "peerReadyBackfillCandidates",
  "proposalResearchEligibleCandidates",
];

function count(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function iso(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
}

function blankAgent(agentId) {
  return {
    agentId,
    runs: 0,
    readinessReceipts: 0,
    attemptedReviews: 0,
    proposalsCreated: 0,
    evaluatorRejects: 0,
    scanErrors: 0,
    budgetExhaustions: 0,
    receiptAnomalies: blankAnomalies(),
    ...Object.fromEntries(FUNNEL_FIELDS.map((field) => [field, 0])),
  };
}

function blankAnomalies() {
  return {
    missingReadinessTelemetry: 0,
    invalidReadinessTelemetry: 0,
    inconsistentReadinessTelemetry: 0,
    incompatibleReadinessSchema: 0,
    invalidAggregateCounters: 0,
    unknownAgentSummaries: 0,
    invalidAgentLists: 0,
  };
}

function addAnomaly(target, key) {
  target[key] += 1;
}

function normalizedClassificationVersion(value) {
  return value === RESEARCH_OUTCOME_VERSION ? RESEARCH_OUTCOME_VERSION : null;
}

function readinessConsistent(agent, funnel) {
  const reviewBudget = count(funnel.reviewBudget);
  const priority = count(funnel.priorityCandidates);
  // v1 receipts written before this additive field existed remain readable as
  // zero-exemption receipts. If one actually exceeded the budget for holdings,
  // it remains an explicit inconsistency because that exemption is unprovable.
  // New scans always write the explicit count.
  const exemptHoldings = count(funnel.exemptHoldingCandidates ?? 0);
  const peerReady = count(funnel.peerReadyCandidates);
  const deferred = count(funnel.deferredPriorityCandidates);
  const backfilled = count(funnel.peerReadyBackfillCandidates);
  const eligible = count(funnel.proposalResearchEligibleCandidates);
  const attempted = count(agent?.attemptedReviews);
  if ([reviewBudget, priority, exemptHoldings, peerReady, deferred, backfilled, eligible, attempted].some((value) => value == null)) return false;
  const maximumReviewed = reviewBudget + exemptHoldings;
  return exemptHoldings <= priority
    && priority <= maximumReviewed
    && peerReady <= maximumReviewed
    && deferred <= priority
    && backfilled <= deferred
    && peerReady === priority - deferred + backfilled
    && attempted === peerReady
    && eligible <= peerReady
    && eligible <= 1;
}

function addCohort(cohorts, classificationVersion) {
  const key = classificationVersion ?? "unversioned";
  const existing = cohorts.get(key) ?? {
    classificationVersion,
    researchFunnelSchemaVersion: RESEARCH_FUNNEL_RECEIPT_VERSION,
    readinessReceipts: 0,
  };
  existing.readinessReceipts += 1;
  cohorts.set(key, existing);
}

function completedScheduled(status) {
  return status?.source === "scheduled" && status?.status === "completed" && iso(status.startedAt) != null;
}

/**
 * Aggregate only retained, terminal scheduled-run receipts. This is a diagnostic
 * report: it never reads ticker-level research, model text, or proposal payloads.
 */
export function buildResearchFunnelReport(statuses, { maxRuns = 5 } = {}) {
  if (!Array.isArray(statuses)) throw new TypeError("statuses must be an array");
  if (!Number.isInteger(maxRuns) || maxRuns < 1) throw new TypeError("maxRuns must be a positive integer");
  const runs = statuses
    .filter(completedScheduled)
    .sort((left, right) => Date.parse(left.startedAt) - Date.parse(right.startedAt))
    .slice(-maxRuns);
  const perAgent = Object.fromEntries(AGENT_IDS.map((agentId) => [agentId, blankAgent(agentId)]));
  const receiptAnomalies = blankAnomalies();
  const cohorts = new Map();

  for (const run of runs) {
    if (!Array.isArray(run.agents)) {
      addAnomaly(receiptAnomalies, "invalidAgentLists");
      continue;
    }
    for (const agent of run.agents) {
      const summary = perAgent[agent?.agentId];
      if (!summary) {
        addAnomaly(receiptAnomalies, "unknownAgentSummaries");
        continue;
      }
      summary.runs += 1;
      for (const field of ["attemptedReviews", "proposalsCreated", "evaluatorRejects", "scanErrors", "budgetExhaustions"]) {
        const value = count(agent[field]);
        if (value == null) {
          addAnomaly(summary.receiptAnomalies, "invalidAggregateCounters");
          addAnomaly(receiptAnomalies, "invalidAggregateCounters");
        } else {
          summary[field] += value;
        }
      }
      const funnel = agent.researchFunnel;
      if (!funnel || typeof funnel !== "object") {
        addAnomaly(summary.receiptAnomalies, "missingReadinessTelemetry");
        addAnomaly(receiptAnomalies, "missingReadinessTelemetry");
        continue;
      }
      if (funnel.schemaVersion !== RESEARCH_FUNNEL_RECEIPT_VERSION) {
        addAnomaly(summary.receiptAnomalies, "incompatibleReadinessSchema");
        addAnomaly(receiptAnomalies, "incompatibleReadinessSchema");
        continue;
      }
      const values = FUNNEL_FIELDS.map((field) => count(field === "exemptHoldingCandidates" ? funnel[field] ?? 0 : funnel[field]));
      if (values.some((value) => value == null)) {
        addAnomaly(summary.receiptAnomalies, "invalidReadinessTelemetry");
        addAnomaly(receiptAnomalies, "invalidReadinessTelemetry");
        continue;
      }
      if (!readinessConsistent(agent, funnel)) {
        addAnomaly(summary.receiptAnomalies, "inconsistentReadinessTelemetry");
        addAnomaly(receiptAnomalies, "inconsistentReadinessTelemetry");
        continue;
      }
      summary.readinessReceipts += 1;
      addCohort(cohorts, normalizedClassificationVersion(run.classificationVersion));
      for (let index = 0; index < FUNNEL_FIELDS.length; index += 1) {
        summary[FUNNEL_FIELDS[index]] += values[index];
      }
    }
  }

  return {
    schemaVersion: "research-funnel-report-v1",
    receiptProvenance: "self_reported_source_only",
    completedScheduledRuns: runs.length,
    receiptAnomalies,
    receiptCohorts: [...cohorts.values()].sort((left, right) =>
      String(left.classificationVersion).localeCompare(String(right.classificationVersion))
    ),
    window: {
      firstStartedAt: runs[0] ? iso(runs[0].startedAt) : null,
      lastCompletedAt: runs
        .map((run) => iso(run.completedAt))
        .filter(Boolean)
        .sort((left, right) => Date.parse(left) - Date.parse(right))
        .at(-1) ?? null,
      runIds: runs.map((run) => String(run.runId ?? "").trim()).filter(Boolean),
    },
    perAgent: AGENT_IDS.map((agentId) => perAgent[agentId]),
  };
}
