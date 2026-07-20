import { createHash } from "node:crypto";
import { rankScreenedCandidates } from "./candidate-slate.js";
import { screenCatalogForAgent, CATALOG_SCREEN_POLICY_VERSIONS } from "./mandate-catalog-screen.js";
import { buildCatalogCensus, toScreenerCandidates } from "./universe.js";

export const LIVE_RESEARCH_CANDIDATE_BUS_VERSION = "live-research-candidate-bus-v1";
export const CATALOG_ELIGIBILITY_POLICY_VERSION = "eligible-us-operating-common-equities-v3";

export const ATTENTION_POLICY_VERSIONS = Object.freeze({
  "agent-1": "short-clock-velocity-attention-v1",
  "agent-2": "medium-trend-attention-v1",
  "agent-3": "long-horizon-durability-attention-v1",
});

function catalogSnapshotId(catalog) {
  const digestInput = Object.values(catalog)
    .sort((a, b) => String(a.t).localeCompare(String(b.t)))
    .map((entry) => [
      entry.t,
      entry.x ?? null,
      entry.qa ?? null,
      entry.ea ?? null,
      entry.mc ?? null,
      entry.advd ?? null,
      entry.p ?? null,
      entry.c52 ?? null,
      entry.s ?? null,
      entry.i ?? null,
      entry.v ?? null,
    ]);
  return `catalog-${createHash("sha256").update(JSON.stringify(digestInput)).digest("hex").slice(0, 20)}`;
}

/**
 * Builds the one research-only catalog bus every live agent consumes in a run.
 * It deliberately contains no action, conviction, sizing, proposal, approval,
 * order, or execution fields.
 */
export function buildLiveResearchCandidateBus({
  catalog,
  agentConfigs,
  asOf = new Date(),
} = {}) {
  if (!catalog || typeof catalog !== "object" || Object.keys(catalog).length === 0) {
    throw new TypeError("A non-empty universe catalog is required to build the live candidate bus");
  }
  const candidateFacts = toScreenerCandidates(catalog);
  const snapshotId = catalogSnapshotId(catalog);
  const agents = {};

  for (const [agentId, config] of Object.entries(agentConfigs ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
    const screen = screenCatalogForAgent(agentId, candidateFacts, config?.riskLimits ?? {});
    const attentionPolicyVersion = ATTENTION_POLICY_VERSIONS[agentId];
    if (!attentionPolicyVersion) throw new TypeError(`Missing attention policy for ${agentId}`);
    agents[agentId] = {
      agentId,
      screenPolicyVersion: CATALOG_SCREEN_POLICY_VERSIONS[agentId],
      attentionPolicyVersion,
      visibleCount: candidateFacts.length,
      eligibleCount: screen.passed.length,
      rejectedCount: screen.rejected.length,
      eligible: rankScreenedCandidates(screen.passed, { agentId }),
      rejected: screen.rejected,
    };
  }

  return {
    recordType: "LiveResearchCandidateBus",
    contractVersion: LIVE_RESEARCH_CANDIDATE_BUS_VERSION,
    authority: "research_only",
    executionAuthority: "none",
    catalogEligibilityPolicyVersion: CATALOG_ELIGIBILITY_POLICY_VERSION,
    catalogSnapshotId: snapshotId,
    asOf: asOf.toISOString(),
    census: buildCatalogCensus(catalog),
    candidates: candidateFacts,
    agents,
  };
}

export function resolveAgentCatalogMode(agentId, universeConfig = {}, env = process.env) {
  const requestedSource = universeConfig.source === "catalog" ? "catalog" : "watchlist";
  const rollbackEnv = String(universeConfig.catalogRollbackEnv ?? "").trim();
  const rollbackRequested = Boolean(rollbackEnv) && String(env?.[rollbackEnv] ?? "").trim().toLowerCase() === "true";
  if (requestedSource === "catalog" && rollbackRequested) {
    return {
      requestedSource,
      effectiveSource: "watchlist",
      degraded: true,
      reasonCode: "catalog_rollback_enabled",
      rollbackEnv,
    };
  }
  return {
    requestedSource,
    effectiveSource: requestedSource,
    degraded: false,
    reasonCode: null,
    rollbackEnv: rollbackEnv || null,
  };
}
