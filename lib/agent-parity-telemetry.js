import { buildHoldingMonitorCoverage } from "./holding-monitor-coverage.js";
import { canonicalJson, contentHash } from "./research-version.js";

export const PARITY_COHORT_PACKET_VERSION = "agent-parity-cohort-packet-v1";
export const PARITY_DAILY_REPORT_VERSION = "agent-parity-daily-report-v1";
export const PARITY_TELEMETRY_EVENT_VERSION = "agent-parity-telemetry-event-v1";

export const PARITY_TELEMETRY_AGENT_IDS = Object.freeze(["agent-1", "agent-2", "agent-3"]);

export const FUNNEL_OUTCOME_KEYS = Object.freeze([
  "dataBlocked",
  "generatorDegraded",
  "investmentHold",
  "riskDowngraded",
  "evaluatorRejected",
  "evaluatorError",
  "duplicate",
  "queueFailure",
  "proposalBlocked",
  "paperOnly",
  "budgetDenied",
  "proposalCreated",
  "unknown",
]);

const AGENT_SET = new Set(PARITY_TELEMETRY_AGENT_IDS);
const EVIDENCE_CLASSES = new Set(["organic", "synthetic"]);
const CALL_ROLES = new Set(["generator", "evaluator"]);
const NEAR_MISS_STAGES = new Set(["data", "generator", "risk", "evaluator", "duplicate", "queue", "budget", "policy"]);
const STRENGTH_BANDS = new Set(["highest", "high", "medium", "unknown"]);
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:/+#@-]{0,199}$/;
const REASON_CODE_RE = /^[a-z0-9][a-z0-9_:-]{0,79}$/;
const ISO_WITH_ZONE_RE = /^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/;
const RECEIPT_HASH_RE = /^sha256:[a-f0-9]{64}$/;

function text(value, field) {
  const normalized = String(value ?? "").trim();
  if (!normalized || !SAFE_ID_RE.test(normalized)) throw new TypeError(`${field} must be a bounded machine-safe identifier`);
  return normalized;
}

function iso(value, field) {
  const normalized = String(value ?? "").trim();
  if (!ISO_WITH_ZONE_RE.test(normalized) || Number.isNaN(Date.parse(normalized))) {
    throw new TypeError(`${field} must be an ISO timestamp with an offset`);
  }
  return normalized;
}

function agentId(value) {
  const normalized = String(value ?? "").trim();
  if (!AGENT_SET.has(normalized)) throw new TypeError("agentId must identify agent-1, agent-2, or agent-3");
  return normalized;
}

function evidenceClass(value) {
  const normalized = String(value ?? "").trim();
  if (!EVIDENCE_CLASSES.has(normalized)) throw new TypeError("evidenceClass must be organic or synthetic");
  return normalized;
}

function count(value, field) {
  if (!Number.isInteger(value) || value < 0) throw new TypeError(`${field} must be a non-negative integer`);
  return value;
}

function finite(value, field) {
  if (!Number.isFinite(value) || value < 0) throw new TypeError(`${field} must be a finite non-negative number`);
  return value;
}

function nullableFinite(value, field) {
  return value == null ? null : finite(value, field);
}

function reasonCode(value, field) {
  const normalized = String(value ?? "").trim();
  if (!REASON_CODE_RE.test(normalized)) throw new TypeError(`${field} must be a bounded reason code`);
  return normalized;
}

function increment(record, key, amount = 1) {
  record[key] = (record[key] ?? 0) + amount;
}

function percentile(sorted, fraction) {
  if (!sorted.length) return null;
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}

function receiptHashes(values, field) {
  if (!Array.isArray(values)) throw new TypeError(`${field} must be an array`);
  const normalized = values.map((value) => String(value ?? "").trim());
  if (normalized.some((value) => !RECEIPT_HASH_RE.test(value))) throw new TypeError(`${field} contains an invalid receipt hash`);
  if (new Set(normalized).size !== normalized.length) throw new TypeError(`${field} contains duplicate receipt hashes`);
  return [...normalized].sort();
}

function hashPayload(payload) {
  return `sha256:${contentHash(payload)}`;
}

export function buildAgentCohortIdentity({
  catalogSnapshotVersion,
  eligibilityPolicyVersion,
  attentionPolicyVersion,
  mandateVersion,
  promptVersion,
  evaluatorVersion,
  outcomeClassifierVersion,
  codeRevision,
}) {
  const identity = {
    catalogSnapshotVersion: text(catalogSnapshotVersion, "catalogSnapshotVersion"),
    eligibilityPolicyVersion: text(eligibilityPolicyVersion, "eligibilityPolicyVersion"),
    attentionPolicyVersion: text(attentionPolicyVersion, "attentionPolicyVersion"),
    mandateVersion: text(mandateVersion, "mandateVersion"),
    promptVersion: text(promptVersion, "promptVersion"),
    evaluatorVersion: text(evaluatorVersion, "evaluatorVersion"),
    outcomeClassifierVersion: text(outcomeClassifierVersion, "outcomeClassifierVersion"),
    codeRevision: text(codeRevision, "codeRevision"),
  };
  return Object.freeze({ ...identity, cohortIdentityHash: hashPayload(identity) });
}

export function buildAgentFunnelTelemetry(input = {}) {
  const catalog = {
    visible: count(input.catalogVisible, "catalogVisible"),
    eligible: count(input.catalogEligible, "catalogEligible"),
    screenedOut: count(input.catalogScreenedOut, "catalogScreenedOut"),
    unsupported: count(input.catalogUnsupported, "catalogUnsupported"),
  };
  const selection = {
    eligible: catalog.eligible,
    selected: count(input.selected, "selected"),
    displaced: count(input.displaced, "displaced"),
    selectedNotAttempted: count(input.selectedNotAttempted, "selectedNotAttempted"),
    buckets: {
      holdings: count(input.selectedHoldings, "selectedHoldings"),
      reunderwrites: count(input.selectedReunderwrites, "selectedReunderwrites"),
      events: count(input.selectedEvents, "selectedEvents"),
      ranked: count(input.selectedRanked, "selectedRanked"),
      exploration: count(input.selectedExploration, "selectedExploration"),
    },
  };
  const attempted = count(input.attempted, "attempted");
  const outcomes = Object.fromEntries(FUNNEL_OUTCOME_KEYS.map((key) => [key, count(input[key], key)]));
  const catalogConserved = catalog.visible === catalog.eligible + catalog.screenedOut + catalog.unsupported;
  const selectionConserved = selection.eligible === selection.selected + selection.displaced;
  const bucketTotal = Object.values(selection.buckets).reduce((sum, value) => sum + value, 0);
  const bucketConserved = selection.selected === bucketTotal;
  const attemptConserved = selection.selected === attempted + selection.selectedNotAttempted;
  const outcomeTotal = Object.values(outcomes).reduce((sum, value) => sum + value, 0);
  const outcomeConserved = attempted === outcomeTotal;
  if (!catalogConserved) throw new Error("catalog funnel does not conserve visible names");
  if (!selectionConserved) throw new Error("selection funnel does not conserve eligible names");
  if (!bucketConserved) throw new Error("selection buckets do not conserve selected names");
  if (!attemptConserved) throw new Error("selected names do not conserve attempted and not-attempted reviews");
  if (!outcomeConserved) throw new Error("attempted reviews do not conserve terminal outcomes");
  return Object.freeze({
    catalog,
    selection,
    attempted,
    outcomes,
    conservation: {
      catalogConserved,
      selectionConserved,
      bucketConserved,
      attemptConserved,
      outcomeConserved,
    },
  });
}

export function aggregateAgentModelCalls(calls = [], { startingBudgetUsd = null, protectedCapacityUsd = null } = {}) {
  if (!Array.isArray(calls)) throw new TypeError("calls must be an array");
  const roles = Object.fromEntries([...CALL_ROLES].map((role) => [role, {
    calls: 0,
    successes: 0,
    failures: 0,
    denials: 0,
    protectedCapacityCalls: 0,
    cacheHits: 0,
    cacheHitKnownCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    tokenKnownCalls: 0,
    estimatedCostUsd: 0,
    costKnownCalls: 0,
    latencyKnownCalls: 0,
    latencyUnknownCalls: 0,
    p50LatencyMs: null,
    p90LatencyMs: null,
  }]));
  const latencies = { generator: [], evaluator: [] };
  for (let index = 0; index < calls.length; index += 1) {
    const call = calls[index];
    if (!call || typeof call !== "object" || Array.isArray(call)) throw new TypeError(`calls[${index}] must be an object`);
    const role = String(call.role ?? "").trim();
    if (!CALL_ROLES.has(role)) throw new TypeError(`calls[${index}].role is unsupported`);
    if (typeof call.denied !== "boolean" || typeof call.success !== "boolean" || typeof call.protectedCapacity !== "boolean") {
      throw new TypeError(`calls[${index}] requires boolean denied, success, and protectedCapacity`);
    }
    if (call.denied && call.success) throw new TypeError(`calls[${index}] cannot be both denied and successful`);
    const summary = roles[role];
    summary.calls += 1;
    if (call.denied) summary.denials += 1;
    else if (call.success) summary.successes += 1;
    else summary.failures += 1;
    if (call.protectedCapacity) summary.protectedCapacityCalls += 1;
    if (typeof call.cacheHit === "boolean") {
      summary.cacheHitKnownCalls += 1;
      if (call.cacheHit) summary.cacheHits += 1;
    }
    if (call.inputTokens != null || call.outputTokens != null) {
      summary.inputTokens += count(call.inputTokens, `calls[${index}].inputTokens`);
      summary.outputTokens += count(call.outputTokens, `calls[${index}].outputTokens`);
      summary.tokenKnownCalls += 1;
    }
    if (call.estimatedCostUsd != null) {
      summary.estimatedCostUsd += finite(call.estimatedCostUsd, `calls[${index}].estimatedCostUsd`);
      summary.costKnownCalls += 1;
    }
    if (call.latencyMs == null) {
      summary.latencyUnknownCalls += 1;
    } else {
      latencies[role].push(finite(call.latencyMs, `calls[${index}].latencyMs`));
      summary.latencyKnownCalls += 1;
    }
  }
  for (const role of CALL_ROLES) {
    latencies[role].sort((left, right) => left - right);
    roles[role].estimatedCostUsd = Number(roles[role].estimatedCostUsd.toFixed(12));
    roles[role].p50LatencyMs = percentile(latencies[role], 0.5);
    roles[role].p90LatencyMs = percentile(latencies[role], 0.9);
  }
  return Object.freeze({
    startingBudgetUsd: nullableFinite(startingBudgetUsd, "startingBudgetUsd"),
    protectedCapacityUsd: nullableFinite(protectedCapacityUsd, "protectedCapacityUsd"),
    roles,
    totals: {
      calls: [...CALL_ROLES].reduce((sum, role) => sum + roles[role].calls, 0),
      successes: [...CALL_ROLES].reduce((sum, role) => sum + roles[role].successes, 0),
      failures: [...CALL_ROLES].reduce((sum, role) => sum + roles[role].failures, 0),
      denials: [...CALL_ROLES].reduce((sum, role) => sum + roles[role].denials, 0),
      estimatedCostUsd: Number([...CALL_ROLES].reduce((sum, role) => sum + roles[role].estimatedCostUsd, 0).toFixed(12)),
      costKnownCalls: [...CALL_ROLES].reduce((sum, role) => sum + roles[role].costKnownCalls, 0),
    },
  });
}

export function aggregateNearMisses(items = []) {
  if (!Array.isArray(items)) throw new TypeError("near misses must be an array");
  const byReason = {};
  const byStage = {};
  const byStrengthBand = {};
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new TypeError(`nearMisses[${index}] must be an object`);
    const reason = reasonCode(item.reasonCode, `nearMisses[${index}].reasonCode`);
    const stage = String(item.stage ?? "").trim();
    const strengthBand = String(item.strengthBand ?? "").trim();
    if (!NEAR_MISS_STAGES.has(stage)) throw new TypeError(`nearMisses[${index}].stage is unsupported`);
    if (!STRENGTH_BANDS.has(strengthBand)) throw new TypeError(`nearMisses[${index}].strengthBand is unsupported`);
    increment(byReason, reason);
    increment(byStage, stage);
    increment(byStrengthBand, strengthBand);
  }
  return Object.freeze({
    count: items.length,
    byReason: Object.fromEntries(Object.entries(byReason).sort()),
    byStage: Object.fromEntries(Object.entries(byStage).sort()),
    byStrengthBand: Object.fromEntries(Object.entries(byStrengthBand).sort()),
  });
}

export function buildAgentHoldingCoverage(input = {}) {
  const coverage = buildHoldingMonitorCoverage(input);
  return Object.freeze({
    status: coverage.expected === 0 && coverage.complete ? "not_applicable" : coverage.complete ? "complete" : "incomplete",
    ...coverage,
  });
}

function degradationCounts(values) {
  if (!Array.isArray(values)) throw new TypeError("degradationReasons must be an array");
  const counts = {};
  for (let index = 0; index < values.length; index += 1) {
    increment(counts, reasonCode(values[index], `degradationReasons[${index}]`));
  }
  return Object.fromEntries(Object.entries(counts).sort());
}

export function buildAgentParityCohortPacket({
  runId,
  agentId: rawAgentId,
  evidenceClass: rawEvidenceClass,
  source,
  startedAt,
  completedAt,
  cohortIdentity,
  funnel,
  modelCalls = [],
  startingBudgetUsd = null,
  protectedCapacityUsd = null,
  holdingCoverage,
  nearMisses = [],
  degradationReasons = [],
  workflowReceiptHashes = [],
  dataReceiptHashes = [],
  rollbackReceiptHash = null,
}) {
  const started = iso(startedAt, "startedAt");
  const completed = iso(completedAt, "completedAt");
  if (Date.parse(completed) < Date.parse(started)) throw new RangeError("completedAt must not precede startedAt");
  if (!cohortIdentity || typeof cohortIdentity !== "object" || !RECEIPT_HASH_RE.test(cohortIdentity.cohortIdentityHash)) {
    throw new TypeError("cohortIdentity must come from buildAgentCohortIdentity");
  }
  const payload = {
    schemaVersion: PARITY_COHORT_PACKET_VERSION,
    runId: text(runId, "runId"),
    agentId: agentId(rawAgentId),
    evidenceClass: evidenceClass(rawEvidenceClass),
    source: text(source, "source"),
    startedAt: started,
    completedAt: completed,
    cohortIdentity: { ...cohortIdentity },
    funnel: buildAgentFunnelTelemetry(funnel),
    capacity: aggregateAgentModelCalls(modelCalls, { startingBudgetUsd, protectedCapacityUsd }),
    holdingCoverage: buildAgentHoldingCoverage(holdingCoverage),
    nearMisses: aggregateNearMisses(nearMisses),
    degradationReasonCounts: degradationCounts(degradationReasons),
    workflowReceiptHashes: receiptHashes(workflowReceiptHashes, "workflowReceiptHashes"),
    dataReceiptHashes: receiptHashes(dataReceiptHashes, "dataReceiptHashes"),
    rollbackReceiptHash: rollbackReceiptHash == null ? null : receiptHashes([rollbackReceiptHash], "rollbackReceiptHash")[0],
  };
  return Object.freeze({ ...payload, packetHash: hashPayload(payload) });
}

export function buildAgentParityTelemetryEvent(packet) {
  if (!packet || packet.schemaVersion !== PARITY_COHORT_PACKET_VERSION) {
    throw new TypeError("packet must be an agent parity cohort packet");
  }
  const { packetHash, ...payload } = packet;
  if (packetHash !== hashPayload(payload)) throw new TypeError("packetHash does not match packet payload");
  const eventPayload = {
    schemaVersion: PARITY_TELEMETRY_EVENT_VERSION,
    runId: packet.runId,
    agentId: packet.agentId,
    evidenceClass: packet.evidenceClass,
    cohortIdentityHash: packet.cohortIdentity.cohortIdentityHash,
    packetHash,
    createdAt: packet.completedAt,
  };
  return Object.freeze({
    ...eventPayload,
    id: `agent-parity-event:${contentHash(eventPayload)}`,
  });
}

function sumObject(records, keys) {
  return Object.fromEntries(keys.map((key) => [key, records.reduce((sum, record) => sum + record[key], 0)]));
}

function aggregatePacketsForAgent(agent, packets) {
  const identityHashes = [...new Set(packets.map((packet) => packet.cohortIdentity.cohortIdentityHash))].sort();
  const outcomes = sumObject(packets.map((packet) => packet.funnel.outcomes), FUNNEL_OUTCOME_KEYS);
  const roles = Object.fromEntries([...CALL_ROLES].map((role) => {
    const summaries = packets.map((packet) => packet.capacity.roles[role]);
    return [role, {
      calls: summaries.reduce((sum, value) => sum + value.calls, 0),
      successes: summaries.reduce((sum, value) => sum + value.successes, 0),
      failures: summaries.reduce((sum, value) => sum + value.failures, 0),
      denials: summaries.reduce((sum, value) => sum + value.denials, 0),
      estimatedCostUsd: Number(summaries.reduce((sum, value) => sum + value.estimatedCostUsd, 0).toFixed(12)),
      costKnownCalls: summaries.reduce((sum, value) => sum + value.costKnownCalls, 0),
      perRunLatency: packets.map((packet) => ({
        runId: packet.runId,
        knownCalls: packet.capacity.roles[role].latencyKnownCalls,
        unknownCalls: packet.capacity.roles[role].latencyUnknownCalls,
        p50LatencyMs: packet.capacity.roles[role].p50LatencyMs,
        p90LatencyMs: packet.capacity.roles[role].p90LatencyMs,
      })),
    }];
  }));
  const holding = {
    expected: packets.reduce((sum, packet) => sum + packet.holdingCoverage.expected, 0),
    monitored: packets.reduce((sum, packet) => sum + packet.holdingCoverage.monitored, 0),
    degraded: packets.reduce((sum, packet) => sum + packet.holdingCoverage.degraded, 0),
    failed: packets.reduce((sum, packet) => sum + packet.holdingCoverage.failed, 0),
    completeRuns: packets.filter((packet) => packet.holdingCoverage.complete).length,
    notApplicableRuns: packets.filter((packet) => packet.holdingCoverage.status === "not_applicable").length,
  };
  const nearMissesByReason = {};
  const degradationReasonCounts = {};
  for (const packet of packets) {
    for (const [key, value] of Object.entries(packet.nearMisses.byReason)) increment(nearMissesByReason, key, value);
    for (const [key, value] of Object.entries(packet.degradationReasonCounts)) increment(degradationReasonCounts, key, value);
  }
  return {
    agentId: agent,
    present: true,
    runCount: packets.length,
    cohortComparable: identityHashes.length === 1,
    cohortIdentityHashes: identityHashes,
    attemptedReviews: packets.reduce((sum, packet) => sum + packet.funnel.attempted, 0),
    selectedNotAttempted: packets.reduce((sum, packet) => sum + packet.funnel.selection.selectedNotAttempted, 0),
    outcomes,
    capacity: { roles },
    holdingCoverage: holding,
    nearMisses: {
      count: packets.reduce((sum, packet) => sum + packet.nearMisses.count, 0),
      byReason: Object.fromEntries(Object.entries(nearMissesByReason).sort()),
    },
    degradationReasonCounts: Object.fromEntries(Object.entries(degradationReasonCounts).sort()),
    packetHashes: packets.map((packet) => packet.packetHash).sort(),
  };
}

function buildEvidenceSection(packets, classification) {
  const matching = packets.filter((packet) => packet.evidenceClass === classification);
  return {
    evidenceClass: classification,
    runPacketCount: matching.length,
    agents: PARITY_TELEMETRY_AGENT_IDS.map((agent) => {
      const agentPackets = matching.filter((packet) => packet.agentId === agent);
      return agentPackets.length
        ? aggregatePacketsForAgent(agent, agentPackets)
        : { agentId: agent, present: false, runCount: 0, reasonCode: "no_packet" };
    }),
  };
}

export function buildDailyParityCohortReport({ reportingDate, packets = [], parityAssessment = null } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(reportingDate ?? ""))) {
    throw new TypeError("reportingDate must be YYYY-MM-DD");
  }
  if (!Array.isArray(packets)) throw new TypeError("packets must be an array");
  const seen = new Set();
  for (let index = 0; index < packets.length; index += 1) {
    const packet = packets[index];
    if (!packet || packet.schemaVersion !== PARITY_COHORT_PACKET_VERSION) throw new TypeError(`packets[${index}] is invalid`);
    const { packetHash, ...payload } = packet;
    if (packetHash !== hashPayload(payload)) throw new TypeError(`packets[${index}] packetHash mismatch`);
    if (seen.has(packetHash)) throw new TypeError("packets contains a duplicate packet");
    seen.add(packetHash);
  }
  const paritySummary = parityAssessment == null ? null : {
    schemaVersion: text(parityAssessment.schemaVersion, "parityAssessment.schemaVersion"),
    mechanicalWorkflowParity: parityAssessment.mechanicalWorkflowParity === true,
    syntheticCommonPathParity: parityAssessment.syntheticCommonPathParity === true,
    mandateDataCompleteness: parityAssessment.mandateDataCompleteness === true,
    parityEvidenceComplete: parityAssessment.parityEvidenceComplete === true,
    observerAuthority: "signed_phase0_observer_only",
  };
  const payload = {
    schemaVersion: PARITY_DAILY_REPORT_VERSION,
    reportingDate,
    paritySummary,
    organic: buildEvidenceSection(packets, "organic"),
    synthetic: buildEvidenceSection(packets, "synthetic"),
  };
  return Object.freeze({ ...payload, reportHash: hashPayload(payload) });
}

export function formatDailyParityCohortReport(report) {
  if (!report || report.schemaVersion !== PARITY_DAILY_REPORT_VERSION) {
    throw new TypeError("report must be a daily parity cohort report");
  }
  const lines = [`Agent parity cohort ${report.reportingDate}`];
  for (const sectionName of ["organic", "synthetic"]) {
    const section = report[sectionName];
    lines.push(`${section.evidenceClass.toUpperCase()}: ${section.runPacketCount} run packet(s)`);
    for (const agent of section.agents) {
      lines.push(agent.present
        ? `${agent.agentId}: ${agent.attemptedReviews} attempted, ${agent.outcomes.proposalCreated} proposals, ${agent.capacity.roles.generator.estimatedCostUsd + agent.capacity.roles.evaluator.estimatedCostUsd} USD estimated, holding failures ${agent.holdingCoverage.failed}`
        : `${agent.agentId}: no packet`);
    }
  }
  return lines.join("\n");
}

export function assertAggregateSafeParityArtifact(value) {
  const serialized = canonicalJson(value);
  const forbiddenKeys = [
    "ticker", "symbol", "company", "name", "rationale", "thesis", "riskSummary",
    "prompt", "evidence", "holding", "account", "investor", "email", "cookie", "secret",
  ];
  for (const key of forbiddenKeys) {
    if (new RegExp(`"${key}"\\s*:`, "i").test(serialized)) {
      throw new Error(`aggregate parity artifact contains forbidden key: ${key}`);
    }
  }
  return true;
}
