// Pure, read-only Phase 0 investor evidence projection. It deliberately accepts
// aggregate inputs only: callers must collect operational events and decision
// lineage elsewhere. This module cannot write telemetry, alter a verdict, or
// infer an investment result.

import { createHash } from "node:crypto";

const EVIDENCE_CLASSES = Object.freeze(["organic_phase0", "synthetic_rehearsal"]);
const CASE_TYPES = new Set(["investment_hold", "near_miss", "proposal", "degraded", "unknown"]);
const SEED_TYPES = new Set(["selected", "displaced", "near_miss", "proposal"]);
const AGENT_IDS = new Set(["agent-1", "agent-2", "agent-3"]);
const OPERATOR_CATEGORIES = new Set(["manual_reauth", "manual_reconciliation", "manual_data_recovery", "manual_operator_review", "manual_incident_triage"]);
const POLICY_BINDINGS = new Set(["not_configured", "policy_unresolved", "frozen_predeclared"]);
const ECONOMICS_STATES = new Set(["not_instrumented", "aggregate_only", "complete"]);
const SECTION_KEYS = new Set(["evidenceClass", "operatorBurden", "decisionLineage", "outcomeTrackingSeeds", "researchUnitEconomics"]);
const METADATA_KEYS = new Set(["version", "asOf", "releaseCommit"]);

function canonicalJson(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("bundle values must be finite");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError("bundle values must be plain JSON objects");
  }
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

function contentHash(value) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function object(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError(`${field} must be a plain object`);
  return value;
}

function text(value, field) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new TypeError(`${field} is required`);
  return normalized;
}

function count(value, field) {
  if (!Number.isInteger(value) || value < 0) throw new TypeError(`${field} must be a non-negative integer`);
  return value;
}

function amount(value, field) {
  if (value == null) return null;
  if (!Number.isFinite(value) || value < 0) throw new TypeError(`${field} must be a non-negative finite number or null`);
  return Number(value.toFixed(12));
}

function exactKeys(value, allowed, field) {
  object(value, field);
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new TypeError(`${field}.${key} is not allowed`);
}

function array(value, field) {
  if (!Array.isArray(value)) throw new TypeError(`${field} must be an array`);
  return value;
}

function agentId(value, field) {
  const normalized = text(value, field);
  if (!AGENT_IDS.has(normalized)) throw new TypeError(`${field} is unsupported`);
  return normalized;
}

function isoTimestamp(value, field) {
  const normalized = text(value, field);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(normalized) || new Date(normalized).toISOString() !== normalized) {
    throw new TypeError(`${field} must be a canonical UTC timestamp`);
  }
  return normalized;
}

function metadataFor(value) {
  exactKeys(value, METADATA_KEYS, "metadata");
  const version = text(value.version, "metadata.version");
  if (!/^phase0-[a-z0-9]+(?:-[a-z0-9]+)*-v[0-9]+$/.test(version)) throw new TypeError("metadata.version is unsupported");
  const releaseCommit = text(value.releaseCommit, "metadata.releaseCommit");
  if (!/^[0-9a-f]{7,64}$/.test(releaseCommit)) throw new TypeError("metadata.releaseCommit must be a commit hash");
  return { version, asOf: isoTimestamp(value.asOf, "metadata.asOf"), releaseCommit };
}

function ordered(entries) {
  return [...entries].sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right)));
}

function emptySection() {
  return {
    state: "not_recorded",
    operatorBurden: { interventionCount: 0, minutes: null, categories: {} },
    decisionLineage: { cases: 0, byAgent: [] },
    outcomeTrackingSeeds: { seeds: 0, policyBinding: "not_recorded", byAgent: [] },
    researchUnitEconomics: { reviews: 0, generatorCalls: 0, evaluatorCalls: 0, estimatedCostUsd: null, latencyMs: null, byAgent: [] },
  };
}

function sum(values) { return values.reduce((total, value) => total + value, 0); }

function summarizeOperatorBurden(rows) {
  const categories = {};
  let knownMinutes = 0;
  let minutesComplete = true;
  for (const row of array(rows, "operatorBurden")) {
    exactKeys(row, new Set(["category", "interventionCount", "minutes"]), "operatorBurden entry");
    const category = text(row.category, "operatorBurden.category");
    if (!OPERATOR_CATEGORIES.has(category)) throw new TypeError("operatorBurden.category is unsupported");
    const interventions = count(row.interventionCount, "operatorBurden.interventionCount");
    const minutes = amount(row.minutes, "operatorBurden.minutes");
    categories[category] = (categories[category] ?? 0) + interventions;
    if (minutes == null) minutesComplete = false;
    else knownMinutes += minutes;
  }
  return {
    interventionCount: sum(Object.values(categories)),
    minutes: minutesComplete ? Number(knownMinutes.toFixed(12)) : null,
    categories: Object.fromEntries(Object.entries(categories).sort(([left], [right]) => left.localeCompare(right))),
  };
}

function summarizeLineage(rows) {
  const agents = new Map();
  const identities = new Set();
  for (const row of array(rows, "decisionLineage")) {
    exactKeys(row, new Set(["agentId", "caseType", "count"]), "decisionLineage entry");
    const agent = agentId(row.agentId, "decisionLineage.agentId");
    const caseType = text(row.caseType, "decisionLineage.caseType");
    if (!CASE_TYPES.has(caseType)) throw new TypeError("decisionLineage.caseType is unsupported");
    const cases = count(row.count, "decisionLineage.count");
    const identity = `${agent}:${caseType}`;
    if (identities.has(identity)) throw new TypeError("decisionLineage has duplicate agent/caseType rows");
    identities.add(identity);
    if (!agents.has(agent)) agents.set(agent, Object.fromEntries([...CASE_TYPES].map((kind) => [kind, 0])));
    agents.get(agent)[caseType] += cases;
  }
  const byAgent = ordered([...agents.entries()].map(([agentId, cases]) => ({ agentId, cases, total: sum(Object.values(cases)) })));
  return { cases: sum(byAgent.map((entry) => entry.total)), byAgent };
}

function summarizeSeeds(rows) {
  const agents = new Map();
  const bindings = new Set();
  const identities = new Set();
  for (const row of array(rows, "outcomeTrackingSeeds")) {
    exactKeys(row, new Set(["agentId", "seedType", "count", "policyBinding"]), "outcomeTrackingSeeds entry");
    const agent = agentId(row.agentId, "outcomeTrackingSeeds.agentId");
    const seedType = text(row.seedType, "outcomeTrackingSeeds.seedType");
    if (!SEED_TYPES.has(seedType)) throw new TypeError("outcomeTrackingSeeds.seedType is unsupported");
    const seeds = count(row.count, "outcomeTrackingSeeds.count");
    const policyBinding = text(row.policyBinding, "outcomeTrackingSeeds.policyBinding");
    if (!POLICY_BINDINGS.has(policyBinding)) throw new TypeError("outcomeTrackingSeeds.policyBinding is unsupported");
    const identity = `${agent}:${seedType}`;
    if (identities.has(identity)) throw new TypeError("outcomeTrackingSeeds has duplicate agent/seedType rows");
    identities.add(identity);
    bindings.add(policyBinding);
    if (!agents.has(agent)) agents.set(agent, Object.fromEntries([...SEED_TYPES].map((kind) => [kind, 0])));
    agents.get(agent)[seedType] += seeds;
  }
  const byAgent = ordered([...agents.entries()].map(([agentId, seeds]) => ({ agentId, seeds, total: sum(Object.values(seeds)) })));
  return { seeds: sum(byAgent.map((entry) => entry.total)), policyBinding: bindings.size === 0 ? "not_recorded" : bindings.size === 1 ? [...bindings][0] : "mixed", byAgent };
}

function summarizeEconomics(rows) {
  const byAgent = [];
  const agents = new Set();
  for (const row of array(rows, "researchUnitEconomics")) {
    exactKeys(row, new Set(["agentId", "reviews", "generatorCalls", "evaluatorCalls", "estimatedCostUsd", "totalLatencyMs", "measurementState"]), "researchUnitEconomics entry");
    const agent = agentId(row.agentId, "researchUnitEconomics.agentId");
    if (agents.has(agent)) throw new TypeError("researchUnitEconomics has duplicate agent rows");
    agents.add(agent);
    const measurementState = text(row.measurementState, "researchUnitEconomics.measurementState");
    if (!ECONOMICS_STATES.has(measurementState)) throw new TypeError("researchUnitEconomics.measurementState is unsupported");
    byAgent.push({
      agentId: agent,
      reviews: count(row.reviews, "researchUnitEconomics.reviews"),
      generatorCalls: count(row.generatorCalls, "researchUnitEconomics.generatorCalls"),
      evaluatorCalls: count(row.evaluatorCalls, "researchUnitEconomics.evaluatorCalls"),
      estimatedCostUsd: amount(row.estimatedCostUsd, "researchUnitEconomics.estimatedCostUsd"),
      totalLatencyMs: amount(row.totalLatencyMs, "researchUnitEconomics.totalLatencyMs"),
      latencyAggregation: "sum_of_call_durations",
      measurementState,
    });
  }
  const orderedAgents = ordered(byAgent);
  const exactCost = orderedAgents.every((row) => row.estimatedCostUsd != null);
  const exactLatency = orderedAgents.every((row) => row.totalLatencyMs != null);
  return {
    reviews: sum(orderedAgents.map((row) => row.reviews)),
    generatorCalls: sum(orderedAgents.map((row) => row.generatorCalls)),
    evaluatorCalls: sum(orderedAgents.map((row) => row.evaluatorCalls)),
    estimatedCostUsd: exactCost ? Number(sum(orderedAgents.map((row) => row.estimatedCostUsd)).toFixed(12)) : null,
    totalLatencyMs: exactLatency ? Number(sum(orderedAgents.map((row) => row.totalLatencyMs)).toFixed(12)) : null,
    latencyAggregation: "sum_of_call_durations",
    byAgent: orderedAgents,
  };
}

function buildSection(input, expectedEvidenceClass) {
  exactKeys(input, SECTION_KEYS, "evidence section");
  if (text(input.evidenceClass, "evidence section.evidenceClass") !== expectedEvidenceClass) {
    throw new TypeError(`evidence section must declare ${expectedEvidenceClass}`);
  }
  const rows = input;
  const operatorBurden = summarizeOperatorBurden(rows.operatorBurden ?? []);
  const decisionLineage = summarizeLineage(rows.decisionLineage ?? []);
  const outcomeTrackingSeeds = summarizeSeeds(rows.outcomeTrackingSeeds ?? []);
  const researchUnitEconomics = summarizeEconomics(rows.researchUnitEconomics ?? []);
  const recorded = [rows.operatorBurden, rows.decisionLineage, rows.outcomeTrackingSeeds, rows.researchUnitEconomics].some((value) => Array.isArray(value) && value.length > 0);
  return { state: recorded ? "available" : "not_recorded", operatorBurden, decisionLineage, outcomeTrackingSeeds, researchUnitEconomics };
}

/**
 * Creates a deterministic, aggregate-only evidence bundle. Organic Phase 0 and
 * synthetic/rehearsal evidence are intentionally rendered as separate sections
 * and are never combined into readiness, performance, or promotion claims.
 */
export function buildPhase0InvestorEvidenceBundle({ metadata = {}, organicPhase0 = {}, syntheticRehearsal = {} } = {}) {
  const normalizedMetadata = metadataFor(metadata);
  const bundle = {
    schemaVersion: "phase0-investor-evidence-bundle-v1",
    metadata: normalizedMetadata,
    conclusion: "not_assessed",
    evidence: {
      organic_phase0: buildSection(organicPhase0, "organic_phase0"),
      synthetic_rehearsal: buildSection(syntheticRehearsal, "synthetic_rehearsal"),
    },
    guardrails: {
      aggregateOnly: true,
      organicSyntheticSeparated: true,
      measurementOnly: true,
      performanceOrPromotionClaim: "not_assessed",
    },
  };
  const machine = JSON.parse(canonicalJson(bundle));
  return { bundle: machine, contentHash: contentHash(machine) };
}

export { EVIDENCE_CLASSES };
