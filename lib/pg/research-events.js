// Durable, append-only research event and selection history. This stays
// advisory-only: it validates immutable evidence and selection records, but
// never chooses a threshold, enables a mode, creates a proposal, or touches money.

import { AgentIdSchema, TICKER_RE } from "../../contracts/proposal.js";
import { SCORE_CAUSES } from "../../contracts/research-observation.js";
import { classifyScoreDelta } from "../score-delta.js";
import { canonicalJson, contentHash } from "../research-version.js";
import { getPool } from "./client.js";
import { ResearchReplayConflictError, ResearchStoreNotConfiguredError } from "./research-observations.js";

const ISO_WITH_OFFSET_RE = /^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/;
const ECONOMIC_CAUSES = new Set(["filing", "market", "estimate", "ownership"]);
const CAUSE_PRIORITY = ["version", "coverage", "restatement", "filing", "estimate", "ownership", "peer_set", "market", "retry", "initial"];
const SELECTION_MODES = new Set(["shadow", "canary", "live"]);
const SCORE_CAUSE_SET = new Set(SCORE_CAUSES);

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

function requireTicker(value, field) {
  const ticker = requireText(value, field).toUpperCase();
  if (!TICKER_RE.test(ticker)) throw new TypeError(`${field} must be a canonical ticker`);
  return ticker;
}

function requireAgentId(value, field) {
  try {
    return AgentIdSchema.parse(value);
  } catch {
    throw new TypeError(`${field} must be a known agent ID`);
  }
}

function requireNonnegativeInteger(value, field) {
  if (!Number.isInteger(value) || value < 0) throw new TypeError(`${field} must be a non-negative integer`);
  return value;
}

function requireBoolean(value, field) {
  if (typeof value !== "boolean") throw new TypeError(`${field} must be boolean`);
  return value;
}

function requireFiniteNullableNumber(value, field) {
  if (value == null) return null;
  if (!Number.isFinite(value)) throw new TypeError(`${field} must be a finite number or null`);
  return value;
}

function requireStringList(value, field, { allowed = null } = {}) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    throw new TypeError(`${field} must be an array of non-empty strings`);
  }
  const normalized = value.map((item) => item.trim());
  if (new Set(normalized).size !== normalized.length) throw new TypeError(`${field} must not contain duplicates`);
  if (allowed && normalized.some((item) => !allowed.has(item))) throw new TypeError(`${field} contains an unsupported value`);
  return normalized;
}

function requirePlainObject(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${field} must be an object`);
  try {
    canonicalJson(value);
  } catch (error) {
    throw new TypeError(`${field} must be canonical JSON: ${error.message}`);
  }
  return value;
}

function resolvePool(pool) {
  const resolved = pool ?? getPool();
  if (!resolved) throw new ResearchStoreNotConfiguredError();
  return resolved;
}

function changedRows(result) {
  return result?.rowCount ?? result?.rows?.length ?? 0;
}

function oneRow(result) {
  return result?.rows?.[0] ?? null;
}

function same(value, expected) {
  return canonicalJson(value) === canonicalJson(expected);
}

// node-postgres treats JavaScript arrays as PostgreSQL arrays, not JSON values.
// Persist JSONB through canonical JSON so array-shaped event evidence remains
// valid JSONB on the wire without changing its replay hash.
function jsonbParam(value) {
  return canonicalJson(value);
}

function comparisonKey(event) {
  return contentHash({
    previousObservationId: event.previousObservationId,
    currentObservationId: event.currentObservationId,
    materialityPolicyVersion: event.materialityPolicyVersion,
  });
}

function normalizeEvent(event) {
  if (!event || typeof event !== "object" || Array.isArray(event)) throw new TypeError("event must be an object");
  const previousObservationId = event.previousObservationId == null ? null : requireText(event.previousObservationId, "event.previousObservationId");
  const currentObservationId = requireText(event.currentObservationId, "event.currentObservationId");
  if (previousObservationId === currentObservationId) throw new TypeError("noninitial events require distinct previous/current observation IDs");
  const primaryCause = requireText(event.primaryCause, "event.primaryCause");
  const allCauses = requireStringList(event.allCauses, "event.allCauses", { allowed: SCORE_CAUSE_SET });
  const canonicalCauses = [...allCauses].sort((left, right) => CAUSE_PRIORITY.indexOf(left) - CAUSE_PRIORITY.indexOf(right));
  if (!same(allCauses, canonicalCauses) || allCauses[0] !== primaryCause) {
    throw new TypeError("event.allCauses must use canonical E3.1 priority order with primaryCause first");
  }
  const material = event.material === undefined ? null : event.material;
  if (material !== null && typeof material !== "boolean") throw new TypeError("event.material must be boolean or null");
  const materialityPolicyVersion = event.materialityPolicyVersion == null ? null : requireText(event.materialityPolicyVersion, "event.materialityPolicyVersion");
  const economicOnly = allCauses.every((cause) => ECONOMIC_CAUSES.has(cause));
  if (primaryCause === "initial") {
    if (material !== null || materialityPolicyVersion !== null) {
      throw new TypeError("initial events require material=null with no policy version");
    }
  } else if (economicOnly) {
    if ((material === null) !== (materialityPolicyVersion === null)) {
      throw new TypeError("economic material=true/false requires a reviewed policy version; unknown material requires none");
    }
  } else if (material !== false || materialityPolicyVersion !== null) {
    throw new TypeError("structural causes require material=false with no policy version");
  }
  const delta = requireFiniteNullableNumber(event.delta, "event.delta");
  if (primaryCause === "initial" && delta !== null) throw new TypeError("initial events require delta=null");
  if (primaryCause === "retry" && delta !== 0) throw new TypeError("retry events require delta=0");
  const researchEligible = requireBoolean(event.researchEligible, "event.researchEligible");
  if (previousObservationId === null && (primaryCause !== "initial" || allCauses.length !== 1 || researchEligible)) {
    throw new TypeError("only an initial, ineligible event may omit previousObservationId");
  }
  if (primaryCause === "initial" && previousObservationId !== null) throw new TypeError("initial events must omit previousObservationId");
  if (researchEligible && (!previousObservationId || material !== true || !materialityPolicyVersion || !economicOnly)) {
    throw new TypeError("research-eligible events require prior/current observations, reviewed materiality=true, and economic causes only");
  }
  return {
    id: requireText(event.id, "event.id"), previousObservationId, currentObservationId,
    ticker: requireTicker(event.ticker, "event.ticker"), agentId: requireAgentId(event.agentId, "event.agentId"),
    primaryCause, allCauses, delta, material, materialityPolicyVersion, researchEligible,
    reasonCodes: requireStringList(event.reasonCodes, "event.reasonCodes"),
    changedMetrics: requireStringList(event.changedMetrics, "event.changedMetrics"),
    coverageChanged: requireBoolean(event.coverageChanged, "event.coverageChanged"),
    peerSetChanged: requireBoolean(event.peerSetChanged, "event.peerSetChanged"),
    versionChanged: requireBoolean(event.versionChanged, "event.versionChanged"),
    createdAt: requireIso(event.createdAt, "event.createdAt"),
  };
}

function normalizeSelectionRun(run) {
  if (!run || typeof run !== "object" || Array.isArray(run)) throw new TypeError("selection run must be an object");
  const mode = requireText(run.mode, "selectionRun.mode");
  if (!SELECTION_MODES.has(mode)) throw new TypeError("selectionRun.mode must be shadow, canary, or live");
  const createdAt = requireIso(run.createdAt, "selectionRun.createdAt");
  const completedAt = requireIso(run.completedAt, "selectionRun.completedAt");
  if (Date.parse(completedAt) < Date.parse(createdAt)) throw new TypeError("selectionRun.completedAt must be >= createdAt");
  const policyVersion = requireText(run.policyVersion, "selectionRun.policyVersion");
  const selectionPolicy = requirePlainObject(run.selectionPolicy, "selectionRun.selectionPolicy");
  if (requireText(selectionPolicy.version, "selectionRun.selectionPolicy.version") !== policyVersion) {
    throw new TypeError("selectionRun.selectionPolicy.version must match policyVersion");
  }
  return {
    id: requireText(run.id, "selectionRun.id"), sourceRunId: requireText(run.sourceRunId, "selectionRun.sourceRunId"),
    policyVersion, selectionPolicy, mode,
    candidateCount: requireNonnegativeInteger(run.candidateCount, "selectionRun.candidateCount"),
    selectedCount: requireNonnegativeInteger(run.selectedCount, "selectionRun.selectedCount"),
    displacedCount: requireNonnegativeInteger(run.displacedCount, "selectionRun.displacedCount"),
    createdAt, completedAt,
  };
}

function normalizeSelectionItem(item, selectionRunId) {
  if (!item || typeof item !== "object" || Array.isArray(item)) throw new TypeError("selection item must be an object");
  const selected = requireBoolean(item.selected, "selectionItem.selected");
  const budgetExempt = requireBoolean(item.budgetExempt, "selectionItem.budgetExempt");
  const protectedReason = item.protectedReason == null ? null : requireText(item.protectedReason, "selectionItem.protectedReason");
  if (budgetExempt !== Boolean(protectedReason)) throw new TypeError("budget-exempt items require an explicit protectedReason and ordinary items must not carry one");
  const triggeringObservationId = item.triggeringObservationId == null ? null : requireText(item.triggeringObservationId, "selectionItem.triggeringObservationId");
  const triggeringEventId = item.triggeringEventId == null ? null : requireText(item.triggeringEventId, "selectionItem.triggeringEventId");
  if (budgetExempt && (!selected || !["holding", "mandatory_reunderwrite"].includes(String(item.bucket ?? "").trim()))) {
    throw new TypeError("budget-exempt items must be selected protected holdings or mandatory re-underwrites");
  }
  const reasonCodes = requireStringList(item.reasonCodes, "selectionItem.reasonCodes");
  if (budgetExempt && !reasonCodes.includes(protectedReason)) {
    throw new TypeError("budget-exempt protectedReason must be explicit in reasonCodes");
  }
  if (selected && !budgetExempt && !triggeringObservationId && !triggeringEventId) {
    throw new TypeError("non-protected selected items require a triggering observation or event");
  }
  return {
    id: requireText(item.id, "selectionItem.id"), selectionRunId: requireText(item.selectionRunId ?? selectionRunId, "selectionItem.selectionRunId"),
    ticker: requireTicker(item.ticker, "selectionItem.ticker"), agentId: requireAgentId(item.agentId, "selectionItem.agentId"),
    selected, rank: requireNonnegativeInteger(item.rank, "selectionItem.rank"), bucket: requireText(item.bucket, "selectionItem.bucket"),
    budgetExempt, protectedReason, reasonCodes,
    triggeringObservationId, triggeringEventId,
    comparedTicker: item.comparedTicker == null ? null : requireTicker(item.comparedTicker, "selectionItem.comparedTicker"),
    displacedTicker: item.displacedTicker == null ? null : requireTicker(item.displacedTicker, "selectionItem.displacedTicker"),
  };
}

function eventPayload(event) { return { ...event, comparisonKey: comparisonKey(event) }; }
function selectionItemPayload(item) { return { ...item }; }
function selectionRunPayload(run, items) { return { ...run, items: items.map(selectionItemPayload) }; }

function assertUnique(values, identity, label) {
  const identities = new Set();
  for (const value of values) {
    const key = identity(value);
    if (identities.has(key)) throw new TypeError(`${label} contains a duplicate deterministic identity: ${key}`);
    identities.add(key);
  }
}

function policyFor(event, options) {
  if (!event.materialityPolicyVersion) return null;
  const policy = options.materialityPolicies?.[event.materialityPolicyVersion] ?? options.materialityPolicy;
  if (!policy || String(policy.version ?? "").trim() !== event.materialityPolicyVersion) {
    throw new TypeError(`event ${event.id} requires injected materiality policy ${event.materialityPolicyVersion}`);
  }
  return policy;
}

async function loadObservation(client, id, event) {
  const row = oneRow(await client.query(
    "SELECT id, ticker, agent_id, observed_at, payload FROM mandate_score_observations WHERE id = $1", [id],
  ));
  if (!row) throw new TypeError(`referenced observation does not exist: ${id}`);
  if (row.ticker !== event.ticker || row.agent_id !== event.agentId) throw new TypeError(`referenced observation ${id} must share event ticker and agent`);
  if (!row.payload || row.payload.id !== id) throw new TypeError(`referenced observation ${id} has invalid immutable payload`);
  if (!row.observed_at || Date.parse(row.payload.observedAt) !== Date.parse(row.observed_at)) {
    throw new TypeError(`referenced observation ${id} payload observedAt does not match stored observed_at`);
  }
  return row.payload;
}

function assertEventMatchesClassifier(event, previous, current, policy) {
  if (current.scoreCause !== event.primaryCause) throw new TypeError("event.primaryCause must match current observation scoreCause");
  const expected = classifyScoreDelta({ previous, current, materialityPolicy: policy });
  for (const field of ["delta", "material", "primaryCause", "allCauses", "researchEligible", "reasonCodes", "changedMetrics", "coverageChanged", "peerSetChanged", "versionChanged"]) {
    if (!same(event[field], expected[field])) throw new TypeError(`event.${field} does not match classifyScoreDelta for immutable observations`);
  }
}

async function validateEventReferences(client, event, options) {
  const previous = event.previousObservationId ? await loadObservation(client, event.previousObservationId, event) : null;
  const current = await loadObservation(client, event.currentObservationId, event);
  if (previous && Date.parse(previous.observedAt) >= Date.parse(current.observedAt)) {
    throw new TypeError("previous observation observedAt must precede current observation");
  }
  if (Date.parse(event.createdAt) < Date.parse(current.observedAt)) {
    throw new TypeError("event.createdAt must be >= current observation observedAt");
  }
  assertEventMatchesClassifier(event, previous, current, policyFor(event, options));
}

async function writeOneEvent(client, event, options) {
  await validateEventReferences(client, event, options);
  const payload = eventPayload(event);
  const hash = contentHash(payload);
  const key = comparisonKey(event);
  const inserted = await client.query(`
    INSERT INTO research_events (
      id, comparison_key, previous_observation_id, current_observation_id, ticker, agent_id, primary_cause, all_causes,
      delta, material, materiality_policy_version, research_eligible, reason_codes, changed_metrics,
      coverage_changed, peer_set_changed, version_changed, created_at, payload, content_hash
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
    ON CONFLICT DO NOTHING RETURNING id
  `, [event.id, key, event.previousObservationId, event.currentObservationId, event.ticker, event.agentId,
    event.primaryCause, jsonbParam(event.allCauses), event.delta, event.material, event.materialityPolicyVersion,
    event.researchEligible, jsonbParam(event.reasonCodes), jsonbParam(event.changedMetrics), event.coverageChanged, event.peerSetChanged,
    event.versionChanged, event.createdAt, jsonbParam(payload), hash]);
  if (changedRows(inserted)) return { id: event.id, inserted: true, contentHash: hash };
  const existing = oneRow(await client.query(
    "SELECT id, content_hash FROM research_events WHERE id = $1 OR comparison_key = $2 LIMIT 2", [event.id, key],
  ));
  if (existing?.id === event.id && existing.content_hash === hash) return { id: event.id, inserted: false, contentHash: hash };
  throw new ResearchReplayConflictError("research_events", event.id);
}

/** Write events sequentially; callers supplying client own the surrounding transaction. */
export async function writeResearchEvents(events, options = {}) {
  if (!Array.isArray(events)) throw new TypeError("events must be an array");
  const normalized = events.map(normalizeEvent);
  assertUnique(normalized, (event) => event.id, "events");
  assertUnique(normalized, comparisonKey, "events");
  if (options.client) {
    const results = [];
    for (const event of normalized) results.push(await writeOneEvent(options.client, event, options));
    return results;
  }
  const client = await resolvePool(options.pool).connect();
  let open = false;
  try {
    await client.query("BEGIN"); open = true;
    const results = [];
    for (const event of normalized) results.push(await writeOneEvent(client, event, options));
    await client.query("COMMIT"); open = false;
    return results;
  } catch (error) {
    if (open) await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally { client.release(); }
}

async function assertSourceRun(client, run) {
  const row = oneRow(await client.query("SELECT run_id FROM research_job_runs WHERE run_id = $1", [run.sourceRunId]));
  if (!row) throw new TypeError(`source research run does not exist: ${run.sourceRunId}`);
}

async function assertSelectionObservation(client, id, item) {
  const row = oneRow(await client.query("SELECT id, ticker, agent_id FROM mandate_score_observations WHERE id = $1", [id]));
  if (!row) throw new TypeError(`referenced observation does not exist: ${id}`);
  if (row.ticker !== item.ticker || row.agent_id !== item.agentId) throw new TypeError(`referenced observation ${id} must share selection item ticker and agent`);
}

async function assertSelectionEvent(client, id, item) {
  const row = oneRow(await client.query(
    "SELECT id, ticker, agent_id, current_observation_id FROM research_events WHERE id = $1", [id],
  ));
  if (!row) throw new TypeError(`referenced event does not exist: ${id}`);
  if (row.ticker !== item.ticker || row.agent_id !== item.agentId) throw new TypeError(`referenced event ${id} must share selection item ticker and agent`);
  if (item.triggeringObservationId && row.current_observation_id !== item.triggeringObservationId) {
    throw new TypeError("triggering event current observation must match triggeringObservationId");
  }
}

async function writeSelectionRunAndItems(client, run, items) {
  await assertSourceRun(client, run);
  const runPayload = selectionRunPayload(run, items);
  const runHash = contentHash(runPayload);
  const insertedRun = await client.query(`
    INSERT INTO research_selection_runs (
      id, source_run_id, policy_version, mode, candidate_count, selected_count, displaced_count,
      created_at, completed_at, payload, content_hash
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    ON CONFLICT (id) DO NOTHING RETURNING id
  `, [run.id, run.sourceRunId, run.policyVersion, run.mode, run.candidateCount, run.selectedCount,
    run.displacedCount, run.createdAt, run.completedAt, jsonbParam(runPayload), runHash]);
  if (!changedRows(insertedRun)) {
    const existing = oneRow(await client.query("SELECT id, content_hash FROM research_selection_runs WHERE id = $1", [run.id]));
    if (existing?.content_hash !== runHash) throw new ResearchReplayConflictError("research_selection_runs", run.id);
  }
  const results = [];
  for (const item of items) {
    if (item.triggeringObservationId) await assertSelectionObservation(client, item.triggeringObservationId, item);
    if (item.triggeringEventId) await assertSelectionEvent(client, item.triggeringEventId, item);
    const payload = selectionItemPayload(item);
    const hash = contentHash(payload);
    const inserted = await client.query(`
      INSERT INTO research_selection_items (
        id, selection_run_id, ticker, agent_id, selected, rank, bucket, budget_exempt, protected_reason, reason_codes,
        triggering_observation_id, triggering_event_id, compared_ticker, displaced_ticker, payload, content_hash
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      ON CONFLICT DO NOTHING RETURNING id
    `, [item.id, item.selectionRunId, item.ticker, item.agentId, item.selected, item.rank, item.bucket,
      item.budgetExempt, item.protectedReason, jsonbParam(item.reasonCodes), item.triggeringObservationId, item.triggeringEventId,
      item.comparedTicker, item.displacedTicker, jsonbParam(payload), hash]);
    if (changedRows(inserted)) { results.push({ id: item.id, inserted: true, contentHash: hash }); continue; }
    const existing = oneRow(await client.query(
      "SELECT id, content_hash FROM research_selection_items WHERE id = $1 OR (selection_run_id = $2 AND ticker = $3 AND agent_id = $4) LIMIT 2",
      [item.id, item.selectionRunId, item.ticker, item.agentId],
    ));
    if (existing?.id === item.id && existing.content_hash === hash) { results.push({ id: item.id, inserted: false, contentHash: hash }); continue; }
    throw new ResearchReplayConflictError("research_selection_items", item.id);
  }
  return { run: { id: run.id, inserted: Boolean(changedRows(insertedRun)), contentHash: runHash }, items: results };
}

/** Write one complete, reproducible selection run and all persisted items atomically. */
export async function writeResearchSelectionRun({ run, items = [] }, { pool } = {}) {
  const normalizedRun = normalizeSelectionRun(run);
  if (!Array.isArray(items)) throw new TypeError("selection items must be an array");
  const normalizedItems = items.map((item) => normalizeSelectionItem(item, normalizedRun.id));
  if (normalizedItems.some((item) => item.selectionRunId !== normalizedRun.id)) throw new TypeError("every selection item must reference the enclosing selection run");
  assertUnique(normalizedItems, (item) => item.id, "selection items");
  assertUnique(normalizedItems, (item) => `${item.ticker}/${item.agentId}`, "selection items");
  assertUnique(normalizedItems, (item) => item.rank, "selection items");
  normalizedItems.sort((left, right) => left.rank - right.rank);
  const selectedCount = normalizedItems.filter((item) => item.selected).length;
  const displacedCount = normalizedItems.filter((item) => !item.selected).length;
  if (normalizedRun.selectedCount !== selectedCount || normalizedRun.displacedCount !== displacedCount || normalizedRun.candidateCount < selectedCount) {
    throw new TypeError("selection counts must match persisted selected/displaced items and candidateCount must cover selected items");
  }
  const client = await resolvePool(pool).connect();
  let open = false;
  try {
    await client.query("BEGIN"); open = true;
    const result = await writeSelectionRunAndItems(client, normalizedRun, normalizedItems);
    await client.query("COMMIT"); open = false;
    return result;
  } catch (error) {
    if (open) await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally { client.release(); }
}
