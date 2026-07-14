import "dotenv/config";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getPeerMetrics, getRedis, getUniverseCatalog, setMandateScores } from "../lib/redis.js";
import { resolvePeerSet, distributionFromPeers } from "../lib/peer-resolve.js";
import { assembleMandateInputs } from "../lib/mandate-evidence.js";
import { scoreMandateCandidate } from "../lib/mandate-score.js";
import { METRIC_IDS } from "../config/scoring/mandate-v2.js";
import { sendMessage as sendTelegram } from "../lib/telegram.js";
import { summarizeMetricCoverage, freshnessHistogram, unsupportedReasonCounts, coverageGate } from "../lib/score-coverage.js";
import { classifyScoreDelta } from "../lib/score-delta.js";
import { buildResearchEvents } from "../lib/research-event-build.js";
import { mandateMetadataFor } from "../lib/research-version.js";
import {
  agentOneScoringConfigVersion,
  buildAgentOneObservation,
  buildAgentOneUniverseSnapshot,
  resolveResearchCodeRevision,
} from "../lib/mandate-observation.js";
import {
  readLatestPriorMandateScoreObservation,
  researchStoreConfigured,
  writeResearchRun,
} from "../lib/pg/research-observations.js";

/**
 * Whole-market deterministic scoring pass. The production entrypoint is inert
 * until Redis peer metrics, both enrichment flags, a durable research store,
 * and a real deployed code revision are all available. It has no proposal,
 * order, ledger, broker, or execution dependencies.
 */

const CORE_PEER_METRICS = ["revGrowth", "peerValuation"];
const SCORED_AGENTS = ["agent-1"];

function numberOrNull(value) {
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function nowIso(now) {
  const value = now().toISOString();
  if (!/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    throw new TypeError("now() must return a Date with a zoned ISO timestamp");
  }
  return value;
}

function explicitStartIso(value, fallback) {
  if (value == null) return fallback;
  const normalized = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(normalized) || Number.isNaN(Date.parse(normalized))) {
    throw new TypeError("startedAt must be a zoned ISO timestamp");
  }
  return normalized;
}

function agentOneUniverseLimits() {
  const config = JSON.parse(readFileSync(new URL("../config/agents/agent-1/risk-limits.json", import.meta.url), "utf8"));
  return {
    allowedSubVerticals: config.allowedSubVerticals,
    microCapMinAvgDollarVolume: config.microCapMinAvgDollarVolume,
  };
}

function disabledResult(reason) {
  return { scored: false, state: "not_configured", reason, agents: {} };
}

/** Direct diagnostic CLI only; orchestrated callers must always supply runId. */
export function diagnosticMandateScoringRunId({ env = process.env, createRunId = randomUUID } = {}) {
  const supplied = String(env.RESEARCH_RUN_ID ?? "").trim();
  return supplied || createRunId();
}

/** Exported so scheduler/workflow gates and direct diagnostics share exact semantics. */
export function mandateScoringPrerequisite({
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

/**
 * Pure: score a full cohort for one agent. It remains useful as a fixture seam;
 * the operational caller passes only active-production-universe candidates.
 */
export function scoreCohortForAgent(agentId, names, { coreMetrics = CORE_PEER_METRICS } = {}) {
  const scores = [];
  let skipped = 0;
  const unsupportedReasons = [];
  const unsupportedRows = [];
  for (const candidate of names) {
    // Do not infer a special-sector taxonomy. Agent 1's active screen is the
    // approved technology sub-vertical screen, and special-sector adapters are
    // separately gated in E2.2/E2.3.
    const sectorKey = null;
    const inputs = assembleMandateInputs({
      agentId,
      metrics: candidate.metrics ?? {},
      derived: candidate.derived ?? null,
      sector: sectorKey,
    });
    if (!inputs.supported) {
      skipped++;
      const unsupportedReason = inputs.unsupportedReason ?? "unsupported";
      unsupportedReasons.push(unsupportedReason);
      unsupportedRows.push({
        supported: false,
        unsupported: true,
        freshnessState: "unsupported",
        unsupportedReason,
        perMetric: Object.fromEntries(METRIC_IDS.map((metricId) => [metricId, {
          points: null,
          missing: true,
          freshnessState: "unsupported",
          unsupportedReason,
        }])),
      });
      continue;
    }
    const resolved = resolvePeerSet(candidate, names, { coreMetrics });
    const peerDistributions = {};
    for (const metricId of METRIC_IDS) peerDistributions[metricId] = distributionFromPeers(resolved.peers, metricId);
    const result = scoreMandateCandidate({
      agentId,
      metricVector: inputs.metricVector,
      peerDistributions,
      absoluteEvidence: inputs.absoluteEvidence,
      valuationEvidence: inputs.valuationEvidence,
      sector: sectorKey,
      peerSetUsed: { level: resolved.level, key: resolved.key, peerCount: resolved.peerCount },
    });
    scores.push({
      ticker: candidate.ticker,
      industry: candidate.industry ?? null,
      total: result.total,
      uncappedTotal: result.uncappedTotal,
      rawPoints: result.rawPoints,
      maxAvailable: result.maxAvailable,
      complete: result.complete,
      actionable: result.actionable,
      scoringBasis: result.scoringBasis,
      fallbackMethod: result.fallbackMethod,
      peerCount: resolved.peerCount,
      boundMetrics: inputs.boundMetrics,
      missingMetrics: result.missingMetrics,
      asOf: candidate.derived?._asOf ?? null,
      freshnessState: candidate.freshnessState ?? candidate.freshness ?? null,
      perMetric: result.perMetric,
      candidate,
      inputs,
      scoreResult: result,
      resolvedPeerSet: resolved,
    });
  }
  scores.sort((left, right) => right.total - left.total || left.ticker.localeCompare(right.ticker));
  return { scores, skipped, unsupportedReasons, unsupportedRows };
}

function cacheView(score) {
  return {
    ticker: score.ticker,
    total: score.observation.score,
    uncappedTotal: score.observation.uncappedScore,
    rawPoints: score.observation.rawPoints,
    maxAvailable: score.observation.maxAvailablePoints,
    complete: score.observation.complete,
    actionable: score.observation.actionable,
    fallbackMethod: score.observation.fallbackMethod,
    peerCount: score.observation.peerCount,
    missingMetrics: score.observation.missingMetrics,
    criticalMissingMetrics: score.observation.criticalMissingMetrics,
    observationId: score.observation.id,
    scoreCause: score.observation.scoreCause,
  };
}

/**
 * Score Agent 1 into canonical durable observations. Redis is read as an input
 * cache and written only as a latest-view cache after Postgres succeeds.
 */
export async function runMandateScoring({
  env = process.env,
  redis = getRedis(),
  pool,
  runId,
  startedAt,
  codeRevision,
  now = () => new Date(),
  getMetrics = getPeerMetrics,
  getCatalog = getUniverseCatalog,
  writeResearch = writeResearchRun,
  readPrior = readLatestPriorMandateScoreObservation,
  writeLatestView = setMandateScores,
  durableStoreConfigured = researchStoreConfigured,
  universeLimits = agentOneUniverseLimits(),
} = {}) {
  const prerequisite = mandateScoringPrerequisite({ env, redis, pool, codeRevision, durableStoreConfigured });
  if (!prerequisite.enabled) {
    console.log(`[MandateScore] ${prerequisite.state} — ${prerequisite.reason}.`);
    return disabledResult(prerequisite.reason);
  }
  const normalizedRunId = String(runId ?? "").trim();
  if (!normalizedRunId) throw new TypeError("runMandateScoring requires the workflow runId");
  const observedAt = nowIso(now);
  const runStartedAt = explicitStartIso(startedAt, observedAt);
  const [metricsMap, catalog] = await Promise.all([getMetrics(), getCatalog()]);
  if (!catalog || Object.keys(catalog).length === 0) {
    return disabledResult("universe_catalog_unavailable");
  }
  if (!metricsMap || Object.keys(metricsMap).length === 0) {
    return disabledResult("peer_metrics_unavailable");
  }

  const { snapshot: universeSnapshot, eligibleCandidates } = buildAgentOneUniverseSnapshot({
    catalog,
    peerMetrics: metricsMap,
    observedAt,
    sourceRevision: prerequisite.codeRevision,
    limits: universeLimits,
  });
  if (!eligibleCandidates.length) {
    return disabledResult("no_current_production_universe_peer_metrics");
  }

  const observations = [];
  const eventComparisons = [];
  const evidenceSnapshots = [];
  const agentSummaries = {};
  const cachePayloads = [];
  const scoringConfig = agentOneScoringConfigVersion();

  for (const agentId of SCORED_AGENTS) {
    const { scores, skipped, unsupportedReasons, unsupportedRows } = scoreCohortForAgent(agentId, eligibleCandidates);
    if (!scores.length) {
      return disabledResult("no_supported_agent_one_evidence");
    }
    for (const score of scores) {
      const record = buildAgentOneObservation({
        runId: normalizedRunId,
        observedAt,
        codeRevision: prerequisite.codeRevision,
        universeSnapshot,
        candidate: score.candidate,
        resolvedPeerSet: score.resolvedPeerSet,
        inputs: score.inputs,
        scoreResult: score.scoreResult,
        scoringConfig,
      });
      // Q-005 is unresolved. We classify only the primary telemetry cause and
      // deliberately supply no materiality policy or research-event write.
      const prior = await readPrior({ agentId, ticker: score.ticker }, { pool });
      record.observation.scoreCause = classifyScoreDelta({ previous: prior, current: record.observation }).primaryCause;
      score.observation = record.observation;
      observations.push(record.observation);
      eventComparisons.push({ previous: prior, current: record.observation });
      evidenceSnapshots.push(record.evidenceSnapshot);
    }
    const coverageRows = [...scores, ...unsupportedRows];
    const coverage = summarizeMetricCoverage(coverageRows, METRIC_IDS);
    const freshness = freshnessHistogram(coverageRows);
    const unsupported = unsupportedReasonCounts(coverageRows);
    const complete = scores.filter((score) => score.observation.complete).length;
    agentSummaries[agentId] = {
      scored: scores.length,
      complete,
      skipped,
      coverage,
      freshness,
      unsupportedReasons: unsupported,
      coverageGate: coverageGate(coverage),
    };
    cachePayloads.push({
      agentId,
      payload: {
        date: observedAt.slice(0, 10),
        generatedAt: observedAt,
        runId: normalizedRunId,
        cohortSize: eligibleCandidates.length,
        scoredCount: scores.length,
        skippedCount: skipped,
        scores: scores.map(cacheView),
        coverage,
        freshness,
        unsupportedReasons: unsupported,
        coverageGate: coverageGate(coverage),
      },
    });
  }

  const completedAt = nowIso(now);
  const completeCount = observations.filter((observation) => observation.complete).length;
  const skippedCount = Object.values(agentSummaries).reduce((total, summary) => total + (numberOrNull(summary.skipped) ?? 0), 0);
  const summary = {
    completedAt,
    cohortCount: eligibleCandidates.length,
    scoredCount: observations.length,
    completeCount,
    skippedCount,
    errorCount: 0,
    coverageSummary: { agents: agentSummaries },
    detail: {
      scoringConfigVersion: scoringConfig,
      productionUniversePolicyVersion: mandateMetadataFor("agent-1").productionUniversePolicyVersion,
      scoreCauseMaterialityPolicy: "q005_unresolved",
    },
  };

  // This is the decisive write. Any configured durable failure rejects before a
  // Redis latest view can be attempted, and the writer records the run failed.
  await writeResearch({
    run: {
      runId: normalizedRunId,
      startedAt: runStartedAt,
      sourceRevision: prerequisite.codeRevision,
      cohortCount: eligibleCandidates.length,
      scoredCount: 0,
      completeCount: 0,
      skippedCount: 0,
      errorCount: 0,
      coverageSummary: {},
    },
    universeSnapshot,
    evidenceSnapshots,
    observations,
    summary,
  }, { pool });

  // Redis is explicitly a noncanonical latest view. A cache failure must not
  // rewrite a completed durable record into a false failure.
  for (const { agentId, payload } of cachePayloads) {
    try {
      await writeLatestView(agentId, payload);
    } catch (error) {
      console.error(`[MandateScore] Durable run ${normalizedRunId} completed but latest-view cache failed: ${error.message}`);
    }
  }

  console.log(`[MandateScore] ${normalizedRunId}: stored ${observations.length} Agent 1 observations (${completeCount} complete, research-only).`);
  return {
    scored: true,
    state: "completed",
    runId: normalizedRunId,
    date: observedAt.slice(0, 10),
    cohortSize: eligibleCandidates.length,
    agents: agentSummaries,
    // Events are constructed deterministically here but intentionally written by
    // the parent workflow only after this durable observation commit succeeds.
    events: buildResearchEvents(eventComparisons),
    observations,
  };
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  runMandateScoring({ runId: diagnosticMandateScoringRunId() })
    .then((result) => {
      if (result.scored) console.log(`[MandateScore] Done — run ${result.runId}, cohort ${result.cohortSize}.`);
    })
    .catch(async (error) => {
      console.error("[MandateScore] Scoring pass failed:", error.message);
      try {
        await sendTelegram(`⚠️ Mandate scoring pass failed: ${error.message}`);
      } catch (telegramError) {
        console.error("[MandateScore] Telegram alert failed:", telegramError.message);
      }
      process.exit(1);
    });
}
