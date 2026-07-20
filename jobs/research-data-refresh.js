import "dotenv/config";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { runUniverseRefresh } from "./universe-refresh.js";
import { runPeerDistributions } from "./peer-distributions.js";
import { runMandateScoring } from "./mandate-scoring.js";
import { getRedis, setResearchDataStatus } from "../lib/redis.js";
import { sendMessage as sendTelegram } from "../lib/telegram.js";
import { WorkflowAlreadyRunningError, withWorkflowLock } from "../lib/workflow-lock.js";
import { resolveResearchCodeRevision } from "../lib/mandate-observation.js";
import { researchStoreConfigured } from "../lib/pg/research-observations.js";
import { writeResearchEvents } from "../lib/pg/research-events.js";
import { runShadowResearchSlate } from "./shadow-research-slate.js";

// This is deliberately a research-data workflow, not a research scan. It never
// calls proposal, ledger, broker, or execution code. The prerequisite gate keeps
// the scheduled entrypoint inert until the enriched peer-metric store is enabled.
export const RESEARCH_DATA_LOCK_TTL_SECONDS = 3 * 60 * 60;

function numberOrNull(value) {
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function countScoring(summary) {
  const agents = Object.values(summary?.agents ?? {});
  const scored = agents.reduce((total, agent) => total + (numberOrNull(agent?.scored) ?? 0), 0);
  const complete = agents.reduce((total, agent) => total + (numberOrNull(agent?.complete) ?? 0), 0);
  const unsupported = agents.reduce((total, agent) => total + (numberOrNull(agent?.skipped) ?? 0), 0);
  return { scored, complete, partial: Math.max(0, scored - complete), unsupported };
}

export function researchDataPrerequisite({
  env = process.env,
  redis = getRedis(),
  pool,
  codeRevision,
  durableStoreConfigured = researchStoreConfigured,
} = {}) {
  if (!redis) return { enabled: false, state: "disabled", reason: "redis_not_configured", codeRevision: null };
  if (env.PEER_METRICS_ENABLED?.trim() !== "1") return { enabled: false, state: "disabled", reason: "peer_metrics_disabled", codeRevision: null };
  if (env.PEER_METRICS_EDGAR?.trim() !== "1") return { enabled: false, state: "disabled", reason: "peer_metrics_edgar_disabled", codeRevision: null };
  if (!durableStoreConfigured({ pool })) return { enabled: false, state: "not_configured", reason: "durable_research_store_not_configured", codeRevision: null };
  const resolvedCodeRevision = resolveResearchCodeRevision({ codeRevision, env });
  if (!resolvedCodeRevision) return { enabled: false, state: "not_configured", reason: "code_revision_not_configured", codeRevision: null };
  return { enabled: true, state: null, reason: null, codeRevision: resolvedCodeRevision };
}

function emptyStatus(runId, startedAt) {
  return {
    state: "running",
    runId,
    startedAt,
    completedAt: null,
    cataloged: null,
    classified: null,
    metricRows: null,
    scored: null,
    complete: null,
    partial: null,
    unsupported: null,
    oldestInputDate: null,
    newestInputDate: null,
    failureStage: null,
    selectionMode: null,
    selectionPolicyVersion: null,
    selectionPolicyUnresolved: null,
    selectionCandidateCount: null,
    selectionSelectedCount: null,
    selectionDisplacedCount: null,
    selectionOverlapCount: null,
    selectionReasonCodeCounts: null,
  };
}

/**
 * Run the ordered, advisory research-data refresh. Dependencies are injected so
 * the sequence, abort semantics, lock behavior, and status payload are testable
 * without Redis, network calls, or paid data sources.
 */
export async function runResearchDataRefresh({
  env = process.env,
  redis = getRedis(),
  pool,
  codeRevision,
  durableStoreConfigured = researchStoreConfigured,
  now = () => new Date(),
  createRunId = randomUUID,
  refreshUniverse = runUniverseRefresh,
  buildPeerDistributions = runPeerDistributions,
  scoreMandates = runMandateScoring,
  writeEvents = writeResearchEvents,
  selectShadowSlate = runShadowResearchSlate,
  writeStatus = (status) => setResearchDataStatus(status, { redis }),
  withLock = withWorkflowLock,
  alert = sendTelegram,
} = {}) {
  const prerequisite = researchDataPrerequisite({ env, redis, pool, codeRevision, durableStoreConfigured });
  if (!prerequisite.enabled) {
    const disabled = { state: prerequisite.state, reason: prerequisite.reason };
    // A configured Redis store gets an explicit, bounded disabled state. With no
    // store there is intentionally no write attempt and no work begins.
    if (redis) await writeStatus(disabled);
    console.log(`[ResearchData] Disabled — ${prerequisite.reason}.`);
    return disabled;
  }

  const runId = createRunId();
  const startedAt = now().toISOString();
  const status = emptyStatus(runId, startedAt);

  try {
    return await withLock("research-data-refresh", async () => {
      await writeStatus(status);
      let failureStage = "universe";
      try {
        const universe = await refreshUniverse({ runId, strictPeerMetrics: true });
        status.cataloged = numberOrNull(universe?.cataloged);
        status.classified = numberOrNull(universe?.sectorEnriched);

        failureStage = "peer-distributions";
        const peers = await buildPeerDistributions({ runId });
        if (!peers?.built) throw new Error("Peer distributions were not built from the current metric cohort.");
        status.metricRows = numberOrNull(peers?.names);

        failureStage = "mandate-scoring";
        const scoring = await scoreMandates({ runId, startedAt, codeRevision: prerequisite.codeRevision, pool });
        if (!scoring?.scored) throw new Error("Mandate scoring did not produce a current cohort.");
        Object.assign(status, countScoring(scoring));
        status.oldestInputDate = scoring?.oldestInputDate ?? peers?.oldestInputDate ?? universe?.oldestInputDate ?? null;
        status.newestInputDate = scoring?.newestInputDate ?? peers?.newestInputDate ?? universe?.newestInputDate ?? null;

        // Test/diagnostic scoring seams may return only aggregate telemetry.
        // Operational scoring returns its immutable current-run payloads, which
        // are the only inputs allowed into event recording and selection.
        if (Array.isArray(scoring.observations)) {
          failureStage = "research-events";
          await writeEvents(scoring.events ?? [], { pool });

          failureStage = "shadow-selection";
          const selection = await selectShadowSlate({
            runId,
            observations: scoring.observations,
            events: scoring.events ?? [],
            pool,
          });
          if (selection?.state === "not_configured") {
            status.state = "not_configured";
            status.reason = selection.reason ?? "shadow_selection_not_configured";
            status.failureStage = selection.failureStage ?? "shadow-selection";
            status.completedAt = now().toISOString();
            await writeStatus(status);
            console.log(`[ResearchData] ${runId} not configured — ${status.reason}.`);
            return status;
          }
          if (!selection?.selectionRunId || !selection?.mode || !selection?.policyVersion) {
            throw new Error("Shadow selection did not return a durable selection result.");
          }
          status.selectionMode = selection.mode;
          status.selectionPolicyVersion = selection.policyVersion;
          status.selectionPolicyUnresolved = selection.policyUnresolved;
          status.selectionCandidateCount = selection.candidateCount;
          status.selectionSelectedCount = selection.selectedCount;
          status.selectionDisplacedCount = selection.displacedCount;
          status.selectionOverlapCount = selection.overlapCount;
          status.selectionReasonCodeCounts = selection.reasonCodeCounts;
        }
        status.state = "completed";
        status.completedAt = now().toISOString();
        failureStage = "status-publish";
        await writeStatus(status);
        console.log(`[ResearchData] ${runId} completed — ${status.cataloged ?? 0} cataloged, ${status.metricRows ?? 0} metric rows, ${status.scored ?? 0} scored.`);
        return status;
      } catch (error) {
        status.state = "failed";
        status.failureStage = failureStage;
        status.completedAt = now().toISOString();
        await writeStatus(status);
        // The scoring CLI only alerts when invoked directly. Send one alert here
        // for its scheduled/orchestrated failure; universe owns its own alert.
        if (failureStage === "mandate-scoring") {
          try {
            await alert(`⚠️ Research-data refresh ${runId} failed during mandate scoring: ${error.message}`);
          } catch (alertError) {
            console.error("[ResearchData] Telegram alert failed:", alertError.message);
          }
        }
        throw error;
      }
    }, { redis, ttlSeconds: RESEARCH_DATA_LOCK_TTL_SECONDS });
  } catch (error) {
    if (error instanceof WorkflowAlreadyRunningError || error?.code === "WORKFLOW_LOCKED") {
      console.log("[ResearchData] Skipped — another refresh owns the workflow lock.");
      return { state: "skipped", reason: "locked" };
    }
    throw error;
  }
}

/**
 * Scheduled owner for the nightly catalog refresh.
 *
 * The enriched research-data workflow is optional, but the broad universe
 * catalog is not: research scans depend on it even when peer metrics are
 * disabled or not yet fully configured. When every prerequisite is present,
 * runResearchDataRefresh owns the universe stage so it is performed exactly
 * once. Otherwise publish the bounded disabled/not-configured state and refresh
 * only the universe catalog.
 */
export async function runScheduledResearchDataRefresh({
  env = process.env,
  redis = getRedis(),
  pool,
  codeRevision,
  durableStoreConfigured = researchStoreConfigured,
  refreshUniverse = runUniverseRefresh,
  runFullRefresh = runResearchDataRefresh,
  writeStatus = (status) => setResearchDataStatus(status, { redis }),
} = {}) {
  const prerequisite = researchDataPrerequisite({ env, redis, pool, codeRevision, durableStoreConfigured });
  if (prerequisite.enabled) {
    return runFullRefresh({ env, redis, pool, codeRevision, durableStoreConfigured });
  }

  const status = { state: prerequisite.state, reason: prerequisite.reason };
  if (redis) await writeStatus(status);
  console.log(`[ResearchData] ${prerequisite.state} — ${prerequisite.reason}; refreshing universe catalog only.`);
  const universe = await refreshUniverse({ strictPeerMetrics: false });
  return { ...status, universe };
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  runResearchDataRefresh().catch((error) => {
    console.error("[ResearchData] Failed:", error.message);
    process.exit(1);
  });
}
