// Immutable, advisory-only snapshots of pure E7 outcomes. This adapter never
// fetches prices, schedules maturation, creates proposals, or touches money.

import { canonicalJson, contentHash } from "../research-version.js";
import { canonicalOutcome } from "../research-outcomes.js";
import { getPool } from "./client.js";
import { ResearchReplayConflictError, ResearchStoreNotConfiguredError } from "./research-observations.js";

const ISO_WITH_OFFSET_RE = /^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/;
const STATUSES = new Set(["immature", "matured", "unavailable", "excluded"]);
const EVIDENCE_CLASSES = new Set(["backtest", "shadow", "paper", "realized_live"]);
const AGENT_IDS = new Set(["agent-1", "agent-2", "agent-3"]);
const TICKER_RE = /^[A-Z][A-Z0-9.-]{0,9}$/;

function text(value, field, { nullable = false } = {}) {
  if (value == null && nullable) return null;
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new TypeError(`${field} must be a non-empty string`);
  return normalized;
}

function iso(value, field, { nullable = false } = {}) {
  if (value == null && nullable) return null;
  const normalized = text(value, field);
  if (!ISO_WITH_OFFSET_RE.test(normalized) || Number.isNaN(Date.parse(normalized))) {
    throw new TypeError(`${field} must be an ISO timestamp with an offset`);
  }
  return new Date(normalized).toISOString();
}

function timestamp(value, field) { return Date.parse(iso(value, field)); }

function ticker(value, field) {
  const normalized = text(value, field).toUpperCase();
  if (!TICKER_RE.test(normalized)) throw new TypeError(`${field} must be a canonical ticker`);
  return normalized;
}

function agent(value) {
  const normalized = text(value, "outcome.agentId");
  if (!AGENT_IDS.has(normalized)) throw new TypeError("outcome.agentId must be a known agent ID");
  return normalized;
}

function json(value, field) {
  try { canonicalJson(value); } catch (error) { throw new TypeError(`${field} must be canonical JSON: ${error.message}`); }
  return value;
}

function requireHash(value, field) {
  const normalized = text(value, field);
  if (!/^[0-9a-f]{64}$/.test(normalized)) throw new TypeError(`${field} must be a lowercase SHA-256 hex digest`);
  return normalized;
}

function nullableText(value, field) { return value == null ? null : text(value, field); }
function integer(value, field, minimum) { const normalized = Number(value); if (!Number.isInteger(normalized) || normalized < minimum) throw new TypeError(`${field} must be an integer >= ${minimum}`); return normalized; }

/** Stable identity permits a later matured snapshot without replacing an earlier one. */
export function outcomeRecordId(outcome = {}) {
  const payload = outcome.canonicalPayload ?? outcome;
  const identity = payload.identity ?? {};
  const policies = payload.policyVersions ?? {};
  const status = text(payload.status, "outcome.status");
  const asOf = iso(payload.asOf, "outcome.asOf");
  const lineage = {
    observationId: nullableText(identity.observationId, "outcome.identity.observationId"),
    selectionItemId: nullableText(identity.selectionItemId, "outcome.identity.selectionItemId"),
    comparisonPairId: nullableText(identity.comparisonPairId, "outcome.identity.comparisonPairId"),
    securityId: ticker(identity.securityId ?? identity.ticker, "outcome.identity.securityId"),
    agentId: text(identity.agentId, "outcome.identity.agentId"),
  };
  if (![lineage.observationId, lineage.selectionItemId].some(Boolean)) throw new TypeError("outcome requires durable observation or selection-item lineage");
  const evidenceClass = text(payload.evidenceClass, "outcome.evidenceClass");
  if (!EVIDENCE_CLASSES.has(evidenceClass)) throw new TypeError("outcome.evidenceClass is unsupported");
  return `outcome-${contentHash({ lineage, policyVersions: {
    horizon: text(policies.horizon, "outcome.policyVersions.horizon"),
    benchmark: text(policies.benchmark, "outcome.policyVersions.benchmark"),
    hit: nullableText(policies.hit, "outcome.policyVersions.hit"),
    cost: nullableText(policies.cost, "outcome.policyVersions.cost"),
  }, evidenceClass, asOf, status })}`;
}

function normalize(record, { now = new Date().toISOString() } = {}) {
  if (!record || typeof record !== "object" || Array.isArray(record)) throw new TypeError("outcome record must be an object");
  const outcome = record.outcome ?? record;
  if (!outcome || typeof outcome !== "object" || Array.isArray(outcome)) throw new TypeError("outcome must be an object");
  const canonicalPayload = json(outcome.canonicalPayload, "outcome.canonicalPayload");
  if (canonicalJson(canonicalPayload) !== canonicalOutcome(outcome)) throw new TypeError("outcome canonical payload does not match scalar outcome fields");
  const hash = contentHash(canonicalPayload);
  if (outcome.outcomeHash != null && requireHash(outcome.outcomeHash, "outcome.outcomeHash") !== hash) throw new TypeError("outcome.outcomeHash does not match canonical payload");
  if (outcome.hash != null && requireHash(outcome.hash, "outcome.hash") !== hash) throw new TypeError("outcome.hash does not match canonical payload");
  const id = outcomeRecordId(outcome);
  if (record.id != null && text(record.id, "record.id") !== id) throw new TypeError("record.id does not match deterministic outcomeRecordId");
  if (outcome.id != null && text(outcome.id, "outcome.id") !== id) throw new TypeError("outcome.id does not match deterministic outcomeRecordId");

  const identity = canonicalPayload.identity ?? {};
  const strata = canonicalPayload.strata ?? {};
  const policies = canonicalPayload.policyVersions ?? {};
  const status = text(canonicalPayload.status, "outcome.status");
  if (!STATUSES.has(status)) throw new TypeError("outcome.status is unsupported");
  const asOf = iso(canonicalPayload.asOf, "outcome.asOf");
  if (timestamp(asOf, "outcome.asOf") > timestamp(now, "now")) throw new RangeError("outcome.asOf cannot be in the future");
  const entryAt = iso(canonicalPayload.entryAt, "outcome.entryAt", { nullable: true });
  const targetAt = iso(canonicalPayload.targetAt, "outcome.targetAt", { nullable: true });
  const exitAt = iso(canonicalPayload.exitAt, "outcome.exitAt", { nullable: true });
  const timingRules = canonicalPayload.timingRules;
  if (!timingRules || typeof timingRules !== "object" || Array.isArray(timingRules)) throw new TypeError("outcome.timingRules must be an object");
  const horizonDays = integer(timingRules.horizonDays, "outcome.timingRules.horizonDays", 1);
  integer(timingRules.observationToleranceMs, "outcome.timingRules.observationToleranceMs", 0);
  integer(timingRules.benchmarkAlignmentToleranceMs, "outcome.timingRules.benchmarkAlignmentToleranceMs", 0);
  if (entryAt && timestamp(entryAt, "outcome.entryAt") > timestamp(asOf, "outcome.asOf")) throw new RangeError("outcome.entryAt cannot be after asOf");
  if (targetAt && entryAt && timestamp(targetAt, "outcome.targetAt") < timestamp(entryAt, "outcome.entryAt")) throw new RangeError("outcome.targetAt cannot precede entryAt");
  if (targetAt && entryAt && timestamp(targetAt, "outcome.targetAt") !== timestamp(entryAt, "outcome.entryAt") + (horizonDays * 86400000)) throw new RangeError("outcome.targetAt must match frozen horizonDays");
  if (exitAt && entryAt && timestamp(exitAt, "outcome.exitAt") < timestamp(entryAt, "outcome.entryAt")) throw new RangeError("outcome.exitAt cannot precede entryAt");

  const observationId = nullableText(identity.observationId, "outcome.identity.observationId");
  const selectionItemId = nullableText(identity.selectionItemId, "outcome.identity.selectionItemId");
  const comparisonPairId = nullableText(identity.comparisonPairId, "outcome.identity.comparisonPairId");
  if (![observationId, selectionItemId].some(Boolean)) throw new TypeError("outcome requires observation or selection-item lineage");
  const securityId = ticker(identity.securityId ?? identity.ticker, "outcome.identity.securityId");
  const storedTicker = ticker(identity.ticker ?? securityId, "outcome.identity.ticker");
  if (securityId !== storedTicker) throw new TypeError("outcome securityId and ticker must match");
  const agentId = agent(identity.agentId ?? strata.agentId);
  if (strata.agentId != null && agent(strata.agentId) !== agentId) throw new TypeError("outcome identity and strata agentId must match");
  const metrics = canonicalPayload.metrics == null ? null : json(canonicalPayload.metrics, "outcome.metrics");
  if (metrics != null && (typeof metrics !== "object" || Array.isArray(metrics))) throw new TypeError("outcome.metrics must be an object or null");
  const hit = canonicalPayload.hit == null ? null : canonicalPayload.hit;
  if (hit != null && typeof hit !== "boolean") throw new TypeError("outcome.hit must be boolean or null");
  const reason = nullableText(canonicalPayload.reason, "outcome.reason");
  if (status === "matured") {
    if (metrics == null || !exitAt || reason != null) throw new TypeError("matured outcome requires metrics, exitAt, and null reason");
  } else if (metrics !== null || hit !== null) {
    throw new TypeError(`${status} outcome must preserve null metrics and hit`);
  }
  const evidenceClass = text(canonicalPayload.evidenceClass, "outcome.evidenceClass");
  if (!EVIDENCE_CLASSES.has(evidenceClass)) throw new TypeError("evidenceClass is unsupported");
  if (outcome.evidenceClass != null && text(outcome.evidenceClass, "outcome.evidenceClass") !== evidenceClass) throw new TypeError("outcome evidenceClass does not match canonical payload");
  if (record.evidenceClass != null && text(record.evidenceClass, "record.evidenceClass") !== evidenceClass) throw new TypeError("record evidenceClass does not match canonical payload");
  const createdAt = iso(record.createdAt ?? outcome.createdAt ?? now, "createdAt");
  if (timestamp(createdAt, "createdAt") > timestamp(now, "now")) throw new RangeError("createdAt cannot be in the future");
  return {
    id, observationId, selectionItemId, comparisonPairId, securityId, ticker: storedTicker, agentId, status, reason,
    asOf, entryAt, targetAt, exitAt, horizonPolicyVersion: text(policies.horizon, "outcome.policyVersions.horizon"),
    benchmarkPolicyVersion: text(policies.benchmark, "outcome.policyVersions.benchmark"), hitPolicyVersion: nullableText(policies.hit, "outcome.policyVersions.hit"),
    costPolicyVersion: nullableText(policies.cost, "outcome.policyVersions.cost"), mandateVersion: nullableText(strata.mandateVersion, "outcome.strata.mandateVersion"),
    scoringVersion: nullableText(strata.scoringVersion, "outcome.strata.scoringVersion"), scoreCompleteness: nullableText(strata.scoreCompleteness, "outcome.strata.scoreCompleteness"),
    deltaCause: nullableText(strata.deltaCause, "outcome.strata.deltaCause"), selectionCategory: nullableText(strata.selectionCategory, "outcome.strata.selectionCategory"),
    evidenceClass, metrics, hit, canonicalPayload, contentHash: hash, createdAt,
  };
}

function resolvePool(pool) { const resolved = pool ?? getPool(); if (!resolved) throw new ResearchStoreNotConfiguredError(); return resolved; }
function changed(result) { return Number(result?.rowCount ?? result?.rows?.length ?? 0) > 0; }
function one(result) { return result?.rows?.[0] ?? null; }
function unique(records) { const ids = new Set(); for (const record of records) { if (ids.has(record.id)) throw new TypeError("outcome batch contains duplicate deterministic identity"); ids.add(record.id); } }

async function assertReferences(client, record) {
  if (record.observationId) {
    const row = one(await client.query("SELECT id, ticker, agent_id FROM mandate_score_observations WHERE id = $1", [record.observationId]));
    if (!row) throw new TypeError(`referenced observation does not exist: ${record.observationId}`);
    if (row.ticker !== record.ticker || row.agent_id !== record.agentId) throw new TypeError("referenced observation must share outcome ticker and agent");
  }
  if (record.selectionItemId) {
    const row = one(await client.query("SELECT id, ticker, agent_id FROM research_selection_items WHERE id = $1", [record.selectionItemId]));
    if (!row) throw new TypeError(`referenced selection item does not exist: ${record.selectionItemId}`);
    if (row.ticker !== record.ticker || row.agent_id !== record.agentId) throw new TypeError("referenced selection item must share outcome ticker and agent");
  }
}

async function writeOne(client, record) {
  const inserted = await client.query(`
    INSERT INTO research_outcomes (
      id, observation_id, selection_item_id, comparison_pair_id, security_id, ticker, agent_id, status, reason,
      as_of, entry_at, target_at, exit_at, horizon_policy_version, benchmark_policy_version, hit_policy_version,
      cost_policy_version, mandate_version, scoring_version, score_completeness, delta_cause, selection_category,
      evidence_class, metrics, hit, canonical_payload, content_hash, created_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28)
    ON CONFLICT (id) DO NOTHING RETURNING id
  `, [record.id, record.observationId, record.selectionItemId, record.comparisonPairId, record.securityId, record.ticker,
    record.agentId, record.status, record.reason, record.asOf, record.entryAt, record.targetAt, record.exitAt,
    record.horizonPolicyVersion, record.benchmarkPolicyVersion, record.hitPolicyVersion, record.costPolicyVersion,
    record.mandateVersion, record.scoringVersion, record.scoreCompleteness, record.deltaCause, record.selectionCategory,
    record.evidenceClass, record.metrics, record.hit, record.canonicalPayload, record.contentHash, record.createdAt]);
  if (changed(inserted)) return { id: record.id, inserted: true, contentHash: record.contentHash };
  const existing = one(await client.query("SELECT id, content_hash FROM research_outcomes WHERE id = $1", [record.id]));
  if (existing?.id === record.id && existing.content_hash === record.contentHash) return { id: record.id, inserted: false, contentHash: record.contentHash };
  throw new ResearchReplayConflictError("research_outcomes", record.id);
}

/** Validate the entire batch before BEGIN; sequential writes make replay order deterministic. */
export async function writeResearchOutcomes(records, { pool, client, now } = {}) {
  if (!Array.isArray(records)) throw new TypeError("outcomes must be an array");
  const normalized = records.map((record) => normalize(record, { now }));
  unique(normalized);
  if (client) { for (const record of normalized) await assertReferences(client, record); const results = []; for (const record of normalized) results.push(await writeOne(client, record)); return results; }
  const owned = await resolvePool(pool).connect(); let open = false;
  try { await owned.query("BEGIN"); open = true; for (const record of normalized) await assertReferences(owned, record); const results = []; for (const record of normalized) results.push(await writeOne(owned, record)); await owned.query("COMMIT"); open = false; return results; }
  catch (error) { if (open) await owned.query("ROLLBACK").catch(() => {}); throw error; }
  finally { owned.release(); }
}

function latestSql(lineageColumn) {
  return `SELECT canonical_payload, evidence_class, created_at FROM research_outcomes WHERE ${lineageColumn} = $1 ORDER BY as_of DESC, created_at DESC, id DESC LIMIT 1`;
}
export async function readLatestResearchOutcome({ observationId = null, selectionItemId = null, comparisonPairId = null } = {}, { pool, client } = {}) {
  const supplied = [["observation_id", observationId], ["selection_item_id", selectionItemId], ["comparison_pair_id", comparisonPairId]].filter(([, value]) => value != null && String(value).trim());
  if (supplied.length !== 1) throw new TypeError("readLatestResearchOutcome requires exactly one lineage identifier");
  const target = client ?? resolvePool(pool); const row = one(await target.query(latestSql(supplied[0][0]), [text(supplied[0][1], "lineageId")]));
  return row ? { ...row.canonical_payload, evidenceClass: row.evidence_class, createdAt: new Date(row.created_at).toISOString() } : null;
}

/** Matured rows retain policy strata; callers must not aggregate across them implicitly. */
export async function readMaturedResearchOutcomes({ agentId = null } = {}, { pool, client } = {}) {
  const target = client ?? resolvePool(pool); const params = []; const filter = agentId == null ? "" : " AND agent_id = $1";
  if (agentId != null) params.push(agent(agentId));
  const result = await target.query(`SELECT canonical_payload, evidence_class, created_at FROM research_outcomes WHERE status = 'matured'${filter} ORDER BY agent_id ASC, mandate_version ASC NULLS FIRST, horizon_policy_version ASC, benchmark_policy_version ASC, as_of ASC, id ASC`, params);
  return (result.rows ?? []).map((row) => ({ ...row.canonical_payload, evidenceClass: row.evidence_class, createdAt: new Date(row.created_at).toISOString() }));
}

export async function readResearchEvidenceRows({ pool, client } = {}) {
  const target = client ?? resolvePool(pool);
  const [outcomes, observations] = await Promise.all([
    target.query("SELECT canonical_payload, evidence_class, created_at FROM research_outcomes ORDER BY evidence_class ASC, agent_id ASC, mandate_version ASC NULLS FIRST, as_of ASC, id ASC"),
    target.query("SELECT payload FROM mandate_score_observations ORDER BY observed_at ASC, agent_id ASC, ticker ASC, id ASC"),
  ]);
  return {
    outcomes: (outcomes.rows ?? []).map((row) => ({ ...row.canonical_payload, evidenceClass: row.evidence_class, createdAt: new Date(row.created_at).toISOString() })),
    observations: (observations.rows ?? []).map((row) => row.payload),
  };
}
