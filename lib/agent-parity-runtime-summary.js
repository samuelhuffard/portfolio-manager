import { RESEARCH_OUTCOME_KINDS, RESEARCH_OUTCOME_VERSION } from "./research-run-report.js";

export const AGENT_PARITY_RUNTIME_SUMMARY_VERSION = "agent-parity-runtime-summary-v1";
export const AGENT_PARITY_RUNTIME_IDS = Object.freeze(["agent-1", "agent-2", "agent-3"]);

const AGENT_ID_SET = new Set(AGENT_PARITY_RUNTIME_IDS);
const RUN_STATUSES = new Set(["completed", "failed"]);
const AGENT_STATUSES = new Set(["completed", "failed"]);
const DISCOVERY_STATUSES = new Set(["complete", "degraded", "legacy"]);
const DISCOVERY_SOURCES = new Set(["catalog", "watchlist-fallback", "watchlist-rollback", "watchlist"]);
const ACTIONS = ["BUY", "SELL", "HOLD"];
const PROPOSAL_ACTIONS = ["BUY", "SELL"];
const MODEL_ROLES = ["generator", "evaluator"];
const SLATE_BUCKETS = ["holdings", "movers", "ranked", "exploration"];

function isoOrNull(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function stringOrNull(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function nonnegativeInteger(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function nonnegativeNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function countMap(value, keys) {
  return Object.fromEntries(keys.map((key) => [key, nonnegativeInteger(value?.[key])]));
}

function modelCallMap(value) {
  return Object.fromEntries(MODEL_ROLES.map((role) => [
    role,
    (() => {
      const attempted = nonnegativeInteger(value?.[role]?.attempted);
      const succeeded = nonnegativeInteger(value?.[role]?.succeeded);
      const failed = nonnegativeInteger(value?.[role]?.failed);
      return {
        attempted,
        succeeded,
        failed,
        conservationValid: attempted != null
          && succeeded != null
          && failed != null
          && attempted === succeeded + failed,
      };
    })(),
  ]));
}

function researchFunnel(source) {
  const funnel = source?.researchFunnel;
  if (!funnel || typeof funnel !== "object") return null;
  return {
    reviewBudget: nonnegativeInteger(funnel.reviewBudget),
    priorityCandidates: nonnegativeInteger(funnel.priorityCandidates),
    exemptHoldingCandidates: nonnegativeInteger(funnel.exemptHoldingCandidates ?? 0),
    peerReadyCandidates: nonnegativeInteger(funnel.peerReadyCandidates),
    deferredPriorityCandidates: nonnegativeInteger(funnel.deferredPriorityCandidates),
    peerReadyBackfillCandidates: nonnegativeInteger(funnel.peerReadyBackfillCandidates),
    proposalResearchEligibleCandidates: nonnegativeInteger(funnel.proposalResearchEligibleCandidates),
  };
}

function projectAgent(agentId, source) {
  if (!source) {
    return {
      agentId,
      present: false,
      status: null,
      discovery: null,
      funnel: null,
      actions: null,
      proposals: null,
      outcomes: null,
      modelCalls: null,
      capacity: null,
    };
  }

  const discovery = source.discovery && typeof source.discovery === "object"
    ? {
        status: DISCOVERY_STATUSES.has(source.discovery.status) ? source.discovery.status : null,
        source: DISCOVERY_SOURCES.has(source.discovery.source) ? source.discovery.source : null,
        degraded: typeof source.discovery.degraded === "boolean" ? source.discovery.degraded : null,
        reasonCode: stringOrNull(source.discovery.reasonCode),
        candidateBusVersion: stringOrNull(source.discovery.candidateBusVersion),
        catalogSnapshotId: stringOrNull(source.discovery.catalogSnapshotId),
        screenPolicyVersion: stringOrNull(source.discovery.screenPolicyVersion),
        attentionPolicyVersion: stringOrNull(source.discovery.attentionPolicyVersion),
        visible: nonnegativeInteger(source.discovery.visible),
        eligible: nonnegativeInteger(source.discovery.eligible),
        screenedOut: nonnegativeInteger(source.discovery.screenedOut),
        slateCounts: countMap(source.discovery.counts, SLATE_BUCKETS),
      }
    : null;

  const attemptedReviews = nonnegativeInteger(source.attemptedReviews ?? source.funnel?.attemptedReviews);
  const outcomeCounts = countMap(source.outcomeCounts ?? source.outcomes?.counts, RESEARCH_OUTCOME_KINDS);
  const outcomeTotal = Object.values(outcomeCounts).every((count) => count != null)
    ? Object.values(outcomeCounts).reduce((sum, count) => sum + count, 0)
    : null;

  return {
    agentId,
    present: true,
    status: AGENT_STATUSES.has(source.status) ? source.status : null,
    discovery,
    funnel: {
      attemptedReviews,
      recommendationsWritten: nonnegativeInteger(source.recommendationsWritten ?? source.funnel?.recommendationsWritten),
      researchReadiness: researchFunnel(source),
    },
    actions: countMap(source.actionCounts ?? source.actions, ACTIONS),
    proposals: {
      created: nonnegativeInteger(source.proposalsCreated ?? source.proposals?.created),
      bySide: countMap(source.proposalCounts ?? source.proposals?.bySide, PROPOSAL_ACTIONS),
      evaluatorRejects: nonnegativeInteger(source.evaluatorRejects ?? source.proposals?.evaluatorRejects),
      scanErrors: nonnegativeInteger(source.scanErrors ?? source.proposals?.scanErrors),
      budgetExhaustions: nonnegativeInteger(source.budgetExhaustions ?? source.proposals?.budgetExhaustions),
    },
    outcomes: {
      classificationVersion: (source.classificationVersion ?? source.outcomes?.classificationVersion) === RESEARCH_OUTCOME_VERSION
        ? RESEARCH_OUTCOME_VERSION
        : null,
      counts: outcomeCounts,
      conservationValid: attemptedReviews != null && outcomeTotal != null && attemptedReviews === outcomeTotal,
    },
    modelCalls: modelCallMap(source.modelCalls),
    capacity: {
      allocationPolicyVersion: stringOrNull(source.capacity?.allocationPolicyVersion),
      maxUsd: nonnegativeNumber(source.capacity?.maxUsd),
      endingReservedUsd: nonnegativeNumber(source.capacity?.ending?.reservedUsd ?? source.capacity?.endingReservedUsd),
    },
  };
}

/**
 * Build an allow-listed, aggregate-only observation of one real scheduled run.
 * This is runtime telemetry, not cryptographic parity proof: the scheduler's
 * independently retained terminal receipt does not exist until after the scan
 * returns, so no receipt hash is accepted or manufactured here.
 */
export function buildAgentParityRuntimeSummary(status) {
  const runId = stringOrNull(status?.runId);
  if (!runId) throw new TypeError("agent parity runtime summary requires runId");
  const byAgent = new Map(
    (Array.isArray(status?.agents) ? status.agents : [])
      .filter((agent) => AGENT_ID_SET.has(agent?.agentId))
      .map((agent) => [agent.agentId, agent])
  );
  return {
    schemaVersion: AGENT_PARITY_RUNTIME_SUMMARY_VERSION,
    evidenceClass: "organic_runtime_unverified",
    proofStatus: "terminal_job_receipt_not_yet_verified",
    organicProofEligible: false,
    terminalJobReceiptHash: null,
    runId,
    source: status?.source === "scheduled" ? "scheduled" : "other",
    status: RUN_STATUSES.has(status?.status) ? status.status : null,
    startedAt: isoOrNull(status?.startedAt),
    completedAt: isoOrNull(status?.completedAt),
    classificationVersion: status?.classificationVersion === RESEARCH_OUTCOME_VERSION
      ? status.classificationVersion
      : null,
    agents: AGENT_PARITY_RUNTIME_IDS.map((agentId) => projectAgent(agentId, byAgent.get(agentId))),
  };
}

/**
 * Re-project retained data before it reaches an unauthenticated health route.
 * Unknown future fields and any injected private fields are discarded.
 */
export function toPublicAgentParityRuntimeSummary(value) {
  if (value?.schemaVersion !== AGENT_PARITY_RUNTIME_SUMMARY_VERSION) return null;
  try {
    const projected = buildAgentParityRuntimeSummary(value);
    return {
      ...projected,
      source: value.source === "scheduled" ? "scheduled" : "other",
      status: RUN_STATUSES.has(value.status) ? value.status : null,
      evidenceClass: "organic_runtime_unverified",
      proofStatus: "terminal_job_receipt_not_yet_verified",
      organicProofEligible: false,
      terminalJobReceiptHash: null,
      updatedAt: isoOrNull(value.updatedAt),
    };
  } catch {
    return null;
  }
}
