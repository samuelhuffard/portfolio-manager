// Durable, append-only research history. This module is intentionally separate
// from the money/proposal path: a configured research-store failure is loud,
// while an unconfigured store is an explicit non-completed state for callers.

import { MandateScoreObservationSchema } from "../../contracts/research-observation.js";
import { TICKER_RE } from "../../contracts/proposal.js";
import { canonicalJson, contentHash } from "../research-version.js";
import { getPool, pgConfigured } from "./client.js";

const HASH_RE = /^[0-9a-f]{64}$/;
const ISO_WITH_OFFSET_RE = /^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/;

export class ResearchStoreNotConfiguredError extends Error {
  constructor() {
    super("DATABASE_URL is not configured — durable research history is unavailable.");
    this.name = "ResearchStoreNotConfiguredError";
    this.code = "PG_RESEARCH_NOT_CONFIGURED";
  }
}

export class ResearchReplayConflictError extends Error {
  constructor(resource, identity) {
    super(`Research replay conflict for ${resource}: ${identity}`);
    this.name = "ResearchReplayConflictError";
    this.code = "PG_RESEARCH_REPLAY_CONFLICT";
  }
}

function requireText(value, field) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new TypeError(`${field} must be a non-empty string`);
  return normalized;
}

function requireIso(value, field) {
  const normalized = requireText(value, field);
  if (!ISO_WITH_OFFSET_RE.test(normalized) || Number.isNaN(Date.parse(normalized))) {
    throw new TypeError(`${field} must be an ISO timestamp with an offset`);
  }
  return normalized;
}

function requireCount(value, field, { defaultValue = 0 } = {}) {
  const count = value === undefined ? defaultValue : value;
  if (!Number.isInteger(count) || count < 0) throw new TypeError(`${field} must be a non-negative integer`);
  return count;
}

function requirePlainJson(value, field, { defaultValue } = {}) {
  const candidate = value === undefined ? defaultValue : value;
  if (candidate === undefined) throw new TypeError(`${field} is required`);
  try {
    canonicalJson(candidate);
  } catch (error) {
    throw new TypeError(`${field} must be canonical JSON: ${error.message}`);
  }
  return candidate;
}

function requireHash(value, field) {
  const normalized = requireText(value, field);
  if (!HASH_RE.test(normalized)) throw new TypeError(`${field} must be a lowercase SHA-256 hex digest`);
  return normalized;
}

function checkedContentHash(value, suppliedHash, field) {
  const calculated = contentHash(value);
  if (suppliedHash !== undefined && requireHash(suppliedHash, field) !== calculated) {
    throw new TypeError(`${field} does not match the canonical payload`);
  }
  return calculated;
}

function resolvePool(pool) {
  const resolved = pool ?? getPool();
  if (!resolved) throw new ResearchStoreNotConfiguredError();
  return resolved;
}

async function queryWith(options, text, params) {
  if (options.client) return options.client.query(text, params);
  return resolvePool(options.pool).query(text, params);
}

function changedRows(result) {
  return result?.rowCount ?? result?.rows?.length ?? 0;
}

function oneRow(result) {
  return result?.rows?.[0] ?? null;
}

// node-postgres returns TIMESTAMPTZ values as Date objects. Compare the instant
// after canonical UTC serialization, so a different textual offset is not a
// false replay conflict while a different instant still is one.
function sameTimestamp(value, expected) {
  const actualDate = value instanceof Date ? value : new Date(value);
  const expectedDate = new Date(expected);
  return !Number.isNaN(actualDate.valueOf())
    && !Number.isNaN(expectedDate.valueOf())
    && actualDate.toISOString() === expectedDate.toISOString();
}

function normalizeRun(run, { allowTerminalStatus = false } = {}) {
  if (!run || typeof run !== "object" || Array.isArray(run)) throw new TypeError("run must be an object");
  const status = run.status === undefined ? "running" : requireText(run.status, "run.status");
  if (!allowTerminalStatus && status !== "running") throw new TypeError("writeResearchJobStart only accepts status=running");
  if (!['running', 'completed', 'failed', 'not_configured'].includes(status)) throw new TypeError("run.status is invalid");
  return {
    runId: requireText(run.runId, "run.runId"),
    status,
    startedAt: requireIso(run.startedAt, "run.startedAt"),
    sourceRevision: requireText(run.sourceRevision, "run.sourceRevision"),
    cohortCount: requireCount(run.cohortCount, "run.cohortCount"),
    scoredCount: requireCount(run.scoredCount, "run.scoredCount"),
    completeCount: requireCount(run.completeCount, "run.completeCount"),
    skippedCount: requireCount(run.skippedCount, "run.skippedCount"),
    errorCount: requireCount(run.errorCount, "run.errorCount"),
    coverageSummary: requirePlainJson(run.coverageSummary, "run.coverageSummary", { defaultValue: {} }),
  };
}

function normalizeSummary(summary, field = "summary") {
  if (!summary || typeof summary !== "object" || Array.isArray(summary)) throw new TypeError(`${field} must be an object`);
  return {
    completedAt: requireIso(summary.completedAt, `${field}.completedAt`),
    cohortCount: requireCount(summary.cohortCount, `${field}.cohortCount`),
    scoredCount: requireCount(summary.scoredCount, `${field}.scoredCount`),
    completeCount: requireCount(summary.completeCount, `${field}.completeCount`),
    skippedCount: requireCount(summary.skippedCount, `${field}.skippedCount`),
    errorCount: requireCount(summary.errorCount, `${field}.errorCount`),
    coverageSummary: requirePlainJson(summary.coverageSummary, `${field}.coverageSummary`, { defaultValue: {} }),
    detail: requirePlainJson(summary.detail, `${field}.detail`, { defaultValue: {} }),
  };
}

function normalizeUniverseSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) throw new TypeError("universe snapshot must be an object");
  const normalized = {
    id: requireText(snapshot.id, "universeSnapshot.id"),
    observedAt: requireIso(snapshot.observedAt, "universeSnapshot.observedAt"),
    sourceRevision: requireText(snapshot.sourceRevision, "universeSnapshot.sourceRevision"),
    catalogCount: requireCount(snapshot.catalogCount, "universeSnapshot.catalogCount"),
    eligibleCount: requireCount(snapshot.eligibleCount, "universeSnapshot.eligibleCount"),
    membership: requirePlainJson(snapshot.membership, "universeSnapshot.membership"),
  };
  if (normalized.eligibleCount > normalized.catalogCount) {
    throw new TypeError("universeSnapshot.eligibleCount cannot exceed catalogCount");
  }
  return {
    ...normalized,
    contentHash: checkedContentHash({
      observedAt: normalized.observedAt,
      sourceRevision: normalized.sourceRevision,
      catalogCount: normalized.catalogCount,
      eligibleCount: normalized.eligibleCount,
      membership: normalized.membership,
    }, snapshot.contentHash, "universeSnapshot.contentHash"),
  };
}

function normalizeEvidenceSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) throw new TypeError("evidence snapshot must be an object");
  const ticker = requireText(snapshot.ticker, "evidenceSnapshot.ticker").toUpperCase();
  if (!TICKER_RE.test(ticker)) throw new TypeError("evidenceSnapshot.ticker must be a canonical ticker");
  const normalized = {
    id: requireText(snapshot.id, "evidenceSnapshot.id"),
    ticker,
    observedAt: requireIso(snapshot.observedAt, "evidenceSnapshot.observedAt"),
    payload: requirePlainJson(snapshot.payload, "evidenceSnapshot.payload"),
    sourceSummary: requirePlainJson(snapshot.sourceSummary, "evidenceSnapshot.sourceSummary", { defaultValue: {} }),
    freshnessSummary: requirePlainJson(snapshot.freshnessSummary, "evidenceSnapshot.freshnessSummary", { defaultValue: {} }),
  };
  return {
    ...normalized,
    contentHash: checkedContentHash({
      ticker: normalized.ticker,
      observedAt: normalized.observedAt,
      payload: normalized.payload,
      sourceSummary: normalized.sourceSummary,
      freshnessSummary: normalized.freshnessSummary,
    }, snapshot.contentHash, "evidenceSnapshot.contentHash"),
  };
}

async function assertExistingHash(options, { table, id, contentHash: hash, resource }) {
  const result = await queryWith(options,
    `SELECT id, content_hash FROM ${table} WHERE id = $1 OR content_hash = $2 LIMIT 2`,
    [id, hash]);
  const rows = result?.rows ?? [];
  if (rows.some((row) => row.id === id && row.content_hash === hash)) return false;
  throw new ResearchReplayConflictError(resource, id);
}

/** True only when a database is configured (or a test pool has been injected). */
export function researchStoreConfigured({ pool } = {}) {
  return Boolean(pool) || pgConfigured();
}

/**
 * Read the prior immutable payload used only to classify a new score delta.
 * This deliberately returns no mutable "latest" Redis view: Postgres is the
 * point-in-time record, and callers remain responsible for not creating events
 * while Q-005 materiality policy is unresolved.
 */
export async function readLatestPriorMandateScoreObservation({ agentId, ticker } = {}, options = {}) {
  const normalizedAgentId = requireText(agentId, "agentId");
  const normalizedTicker = requireText(ticker, "ticker").toUpperCase();
  if (!TICKER_RE.test(normalizedTicker)) throw new TypeError("ticker must be a canonical ticker");
  const row = oneRow(await queryWith(options, `
    SELECT payload
    FROM mandate_score_observations
    WHERE agent_id = $1 AND ticker = $2
    ORDER BY observed_at DESC, id DESC
    LIMIT 1
  `, [normalizedAgentId, normalizedTicker]));
  if (!row) return null;
  const payload = typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload;
  // Canonical round-tripping makes the caller's object independent from a fake
  // driver's JSON reference and rejects malformed/non-plain persisted payloads.
  return MandateScoreObservationSchema.parse(JSON.parse(canonicalJson(payload)));
}

export async function writeResearchJobStart(run, options = {}) {
  const normalized = normalizeRun(run);
  const inserted = await queryWith(options, `
    INSERT INTO research_job_runs (
      run_id, status, started_at, source_revision, cohort_count, scored_count,
      complete_count, skipped_count, error_count, coverage_summary
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    ON CONFLICT (run_id) DO NOTHING
    RETURNING run_id
  `, [
    normalized.runId, normalized.status, normalized.startedAt, normalized.sourceRevision,
    normalized.cohortCount, normalized.scoredCount, normalized.completeCount,
    normalized.skippedCount, normalized.errorCount, normalized.coverageSummary,
  ]);
  if (changedRows(inserted)) return { runId: normalized.runId, inserted: true };

  const existing = oneRow(await queryWith(options, `
    SELECT run_id, status, started_at, source_revision, cohort_count, scored_count,
           complete_count, skipped_count, error_count, coverage_summary
    FROM research_job_runs WHERE run_id = $1
  `, [normalized.runId]));
  if (existing?.run_id === normalized.runId
    && sameTimestamp(existing.started_at, normalized.startedAt)
    && existing.source_revision === normalized.sourceRevision
    && Number(existing.cohort_count) === normalized.cohortCount
    && Number(existing.scored_count) === normalized.scoredCount
    && Number(existing.complete_count) === normalized.completeCount
    && Number(existing.skipped_count) === normalized.skippedCount
    && Number(existing.error_count) === normalized.errorCount
    && canonicalJson(existing.coverage_summary ?? {}) === canonicalJson(normalized.coverageSummary)) {
    return { runId: normalized.runId, inserted: false };
  }
  // The high-level writer may replay a run that already completed after the
  // caller lost its response. Counts are terminal/mutable fields, so only the
  // immutable start identity is checked here. writeResearchRun then replays and
  // hash-checks every supplied durable object and finishResearchJobRun compares
  // the exact terminal summary; any changed content still conflicts loudly.
  if (options.allowCompletedReplay === true
    && existing?.run_id === normalized.runId
    && existing.status === "completed"
    && sameTimestamp(existing.started_at, normalized.startedAt)
    && existing.source_revision === normalized.sourceRevision) {
    return { runId: normalized.runId, inserted: false, completedReplay: true };
  }
  throw new ResearchReplayConflictError("research_job_runs", normalized.runId);
}

export async function writeUniverseSnapshot(snapshot, options = {}) {
  const normalized = normalizeUniverseSnapshot(snapshot);
  const inserted = await queryWith(options, `
    INSERT INTO universe_snapshots (
      id, observed_at, source_revision, catalog_count, eligible_count, membership, content_hash
    ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT DO NOTHING
    RETURNING id
  `, [
    normalized.id, normalized.observedAt, normalized.sourceRevision, normalized.catalogCount,
    normalized.eligibleCount, normalized.membership, normalized.contentHash,
  ]);
  if (changedRows(inserted)) return { id: normalized.id, inserted: true, contentHash: normalized.contentHash };
  await assertExistingHash(options, {
    table: "universe_snapshots", id: normalized.id, contentHash: normalized.contentHash, resource: "universe_snapshots",
  });
  return { id: normalized.id, inserted: false, contentHash: normalized.contentHash };
}

export async function writeEvidenceSnapshot(snapshot, options = {}) {
  const normalized = normalizeEvidenceSnapshot(snapshot);
  const inserted = await queryWith(options, `
    INSERT INTO evidence_snapshots (
      id, ticker, observed_at, payload, source_summary, freshness_summary, content_hash
    ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT DO NOTHING
    RETURNING id
  `, [
    normalized.id, normalized.ticker, normalized.observedAt, normalized.payload,
    normalized.sourceSummary, normalized.freshnessSummary, normalized.contentHash,
  ]);
  if (changedRows(inserted)) return { id: normalized.id, inserted: true, contentHash: normalized.contentHash };
  await assertExistingHash(options, {
    table: "evidence_snapshots", id: normalized.id, contentHash: normalized.contentHash, resource: "evidence_snapshots",
  });
  return { id: normalized.id, inserted: false, contentHash: normalized.contentHash };
}

function observationParams(observation, hash) {
  return [
    observation.id, observation.runId, observation.observedAt, observation.agentId,
    observation.mandateId, observation.mandateVersion, observation.mandateUniverseVersion,
    observation.productionUniversePolicyVersion, observation.scoringConfigVersion,
    observation.codeRevision, observation.ticker, observation.universeSnapshotId,
    observation.eligible, observation.eligibilityReasonCodes, observation.score,
    observation.uncappedScore, observation.rawPoints, observation.maxAvailablePoints,
    observation.complete, observation.actionable, observation.coverageMask,
    observation.missingMetrics, observation.criticalMissingMetrics, observation.fallbackMethod,
    observation.thinPeerSet, observation.peerSetId, observation.peerSetLevel, observation.peerCount,
    observation.specialSectorKey, observation.scoreCause, observation.inputSnapshotId,
    observation.metrics, observation, hash,
  ];
}

const INSERT_OBSERVATION_SQL = `
  INSERT INTO mandate_score_observations (
    id, run_id, observed_at, agent_id, mandate_id, mandate_version, mandate_universe_version,
    production_universe_policy_version, scoring_config_version, code_revision, ticker,
    universe_snapshot_id, eligible, eligibility_reason_codes, score, uncapped_score,
    raw_points, max_available_points, complete, actionable, coverage_mask, missing_metrics,
    critical_missing_metrics, fallback_method, thin_peer_set, peer_set_id, peer_set_level,
    peer_count, special_sector_key, score_cause, input_snapshot_id, metrics, payload, content_hash
  ) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17,
    $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34
  ) ON CONFLICT (run_id, agent_id, ticker) DO NOTHING
  RETURNING id, content_hash
`;

export async function writeMandateScoreObservations(observations, { client, pool } = {}) {
  if (!Array.isArray(observations)) throw new TypeError("observations must be an array");
  // Parse the full batch before opening any SQL write so a malformed later row
  // cannot leave a valid earlier row committed by a non-transactional caller.
  const normalized = observations.map((observation) => MandateScoreObservationSchema.parse(observation));
  const options = { client, pool };
  if (!client) resolvePool(pool);

  const results = [];
  for (const observation of normalized) {
    const hash = contentHash(observation);
    const inserted = await queryWith(options, INSERT_OBSERVATION_SQL, observationParams(observation, hash));
    if (changedRows(inserted)) {
      results.push({ id: observation.id, inserted: true, contentHash: hash });
      continue;
    }
    const existing = oneRow(await queryWith(options, `
      SELECT id, content_hash
      FROM mandate_score_observations
      WHERE run_id = $1 AND agent_id = $2 AND ticker = $3
    `, [observation.runId, observation.agentId, observation.ticker]));
    if (existing?.content_hash === hash) {
      results.push({ id: observation.id, inserted: false, contentHash: hash });
      continue;
    }
    throw new ResearchReplayConflictError(
      "mandate_score_observations", `${observation.runId}/${observation.agentId}/${observation.ticker}`
    );
  }
  return results;
}

export async function finishResearchJobRun(runId, summary, options = {}) {
  const normalizedRunId = requireText(runId, "runId");
  const normalized = normalizeSummary(summary);
  const updated = await queryWith(options, `
    UPDATE research_job_runs
    SET status = 'completed', completed_at = $2, cohort_count = $3, scored_count = $4,
        complete_count = $5, skipped_count = $6, error_count = $7,
        coverage_summary = $8, summary = $9, error_summary = NULL
    WHERE run_id = $1 AND status = 'running'
    RETURNING run_id
  `, [
    normalizedRunId, normalized.completedAt, normalized.cohortCount, normalized.scoredCount,
    normalized.completeCount, normalized.skippedCount, normalized.errorCount,
    normalized.coverageSummary, normalized.detail,
  ]);
  if (changedRows(updated)) return { runId: normalizedRunId, finished: true };

  const existing = oneRow(await queryWith(options, `
    SELECT status, completed_at, cohort_count, scored_count, complete_count,
           skipped_count, error_count, coverage_summary, summary
    FROM research_job_runs WHERE run_id = $1
  `, [normalizedRunId]));
  if (existing?.status === "completed"
    && sameTimestamp(existing.completed_at, normalized.completedAt)
    && Number(existing.cohort_count) === normalized.cohortCount
    && Number(existing.scored_count) === normalized.scoredCount
    && Number(existing.complete_count) === normalized.completeCount
    && Number(existing.skipped_count) === normalized.skippedCount
    && Number(existing.error_count) === normalized.errorCount
    && canonicalJson(existing.coverage_summary ?? {}) === canonicalJson(normalized.coverageSummary)
    && canonicalJson(existing.summary ?? {}) === canonicalJson(normalized.detail)) {
    return { runId: normalizedRunId, finished: false };
  }
  throw new ResearchReplayConflictError("research_job_runs", normalizedRunId);
}

export async function failResearchJobRun(runId, errorSummary, options = {}) {
  const normalizedRunId = requireText(runId, "runId");
  if (!errorSummary || typeof errorSummary !== "object" || Array.isArray(errorSummary)) {
    throw new TypeError("errorSummary must be an object");
  }
  const failedAt = requireIso(errorSummary.failedAt, "errorSummary.failedAt");
  const detail = requirePlainJson(errorSummary.detail ?? errorSummary, "errorSummary.detail");
  const updated = await queryWith(options, `
    UPDATE research_job_runs
    SET status = 'failed', completed_at = $2, error_count = GREATEST(error_count, 1), error_summary = $3
    WHERE run_id = $1 AND status = 'running'
    RETURNING run_id
  `, [normalizedRunId, failedAt, detail]);
  if (changedRows(updated)) return { runId: normalizedRunId, failed: true };
  const existing = oneRow(await queryWith(options,
    "SELECT status, completed_at, error_summary FROM research_job_runs WHERE run_id = $1", [normalizedRunId]));
  if (existing?.status === "failed"
    && sameTimestamp(existing.completed_at, failedAt)
    && canonicalJson(existing.error_summary ?? {}) === canonicalJson(detail)) {
    return { runId: normalizedRunId, failed: false };
  }
  throw new ResearchReplayConflictError("research_job_runs", normalizedRunId);
}

/**
 * Atomically record the durable objects produced by one research run. Callers
 * may use the lower-level exports inside their own transaction, but this is the
 * safe default for scheduler integration.
 */
export async function writeResearchRun({ run, universeSnapshot, evidenceSnapshots = [], observations = [], summary }, { pool } = {}) {
  const resolvedPool = resolvePool(pool);
  // Keep the run-state row outside the data transaction. A rollback must not
  // erase the row that records why durable research history failed.
  await writeResearchJobStart(run, { pool: resolvedPool, allowCompletedReplay: true });
  const client = await resolvedPool.connect();
  let transactionOpen = false;
  try {
    await client.query("BEGIN");
    transactionOpen = true;
    await writeUniverseSnapshot(universeSnapshot, { client });
    for (const snapshot of evidenceSnapshots) await writeEvidenceSnapshot(snapshot, { client });
    await writeMandateScoreObservations(observations, { client });
    await client.query("COMMIT");
    transactionOpen = false;
    return await finishResearchJobRun(run?.runId, summary, { pool: resolvedPool });
  } catch (error) {
    if (transactionOpen) await client.query("ROLLBACK").catch(() => {});
    const runId = String(run?.runId ?? "").trim();
    if (runId) {
      await failResearchJobRun(runId, {
        failedAt: new Date().toISOString(),
        detail: { stage: "durable_research_write", message: error.message, code: error.code ?? null },
      }, { pool: resolvedPool }).catch((failureWriteError) => {
        error.researchFailureWriteError = failureWriteError;
      });
    }
    throw error;
  } finally {
    client.release();
  }
}
