import { contentHash } from "./research-version.js";

export const PARITY_PROOF_SCHEMA_VERSION = "agent-parity-proof-v1";
export const PARITY_WORKFLOW_RECEIPT_VERSION = "agent-parity-workflow-receipt-v1";
export const PARITY_DATA_RECEIPT_VERSION = "agent-parity-data-receipt-v1";
export const DISCOVERY_ACTIVATION_VERSION = "agent-discovery-activation-v1";

export const PARITY_AGENT_IDS = Object.freeze(["agent-1", "agent-2", "agent-3"]);

export const SHARED_MECHANICAL_STAGES = Object.freeze([
  { id: "candidate_bus", contractVersion: "live-research-candidate-bus-v1" },
  { id: "selection_rotation", contractVersion: "candidate-selection-v1" },
  { id: "research_packet", contractVersion: "research-packet-v1" },
  { id: "proposal_queue", contractVersion: "proposal-v1" },
  { id: "independent_evaluator", contractVersion: "evaluator-v1" },
  { id: "downgrade_only_risk", contractVersion: "risk-engine-v1" },
  { id: "human_approval", contractVersion: "approval-command-v1" },
  { id: "ownership_attribution", contractVersion: "ownership-v1" },
  { id: "ledger_recording", contractVersion: "trade-ledger-v1" },
  { id: "approval_signature", contractVersion: "decision-signature-v1" },
  { id: "holding_coverage", contractVersion: "holding-monitor-coverage-v1" },
]);

export const MANDATE_DATA_AREAS = Object.freeze([
  "catalog_screen",
  "evidence_adapter",
  "scoring_inputs",
  "entry_policy_inputs",
  "holding_monitor_inputs",
  "reunderwrite_inputs",
  "add_accounting_state",
]);

export const CANONICAL_COMMON_PATH_IMPLEMENTATIONS = Object.freeze({
  candidate_bus: "lib/research-candidate-bus.js#buildLiveResearchCandidateBus",
  selection_rotation: "lib/candidate-slate.js#buildSlate",
  research_packet: "jobs/research-scan.js#reviewCandidateForAgent",
  proposal_queue: "lib/redis.js#createProposal",
  independent_evaluator: "lib/evaluator.js#evaluateProposal",
  downgrade_only_risk: "lib/risk-engine.js#applyRiskChecks",
  human_approval: "contracts/signature.js#computeDecisionSignature",
  ownership_attribution: "lib/mcp-accounting.js#applyFillToLots",
  ledger_recording: "lib/mcp-accounting.js#recordMcpFill",
  approval_signature: "lib/proposal-signature.js#assertApprovedProposalSignature",
  holding_coverage: "lib/holding-monitor-coverage.js#buildHoldingMonitorCoverage",
});

const AGENT_SET = new Set(PARITY_AGENT_IDS);
const STAGE_BY_ID = new Map(SHARED_MECHANICAL_STAGES.map((stage) => [stage.id, stage]));
const DATA_AREA_SET = new Set(MANDATE_DATA_AREAS);
const EVIDENCE_CLASSES = new Set(["organic", "synthetic"]);
const PROOF_SOURCES = new Set(["runtime_config", "canary", "common_path_test"]);
const ACTIVATIONS = new Set(["live", "shadow", "test", "disabled"]);
const DATA_STATUSES = new Set(["complete", "partial", "unavailable", "policy_unresolved"]);
const DISCOVERY_MODES = new Set(["fixed_watchlist", "catalog_shadow", "catalog_live"]);
const SAFE_TOKEN_RE = /^[A-Za-z0-9][A-Za-z0-9._:/+#@-]{0,199}$/;
const REASON_CODE_RE = /^[a-z0-9][a-z0-9_:-]{0,79}$/;
const ISO_WITH_ZONE_RE = /^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/;
const RECEIPT_HASH_RE = /^sha256:[a-f0-9]{64}$/;

function plainObject(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${field} must be an object`);
  }
  return value;
}

function text(value, field) {
  const normalized = String(value ?? "").trim();
  if (!normalized || !SAFE_TOKEN_RE.test(normalized)) {
    throw new TypeError(`${field} must be a bounded machine-safe identifier`);
  }
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

function oneOf(value, allowed, field) {
  const normalized = String(value ?? "").trim();
  if (!allowed.has(normalized)) throw new TypeError(`${field} is unsupported`);
  return normalized;
}

function reasonCodes(value, field = "reasonCodes") {
  if (!Array.isArray(value)) throw new TypeError(`${field} must be an array`);
  const normalized = value.map((item) => String(item ?? "").trim());
  if (normalized.some((item) => !REASON_CODE_RE.test(item))) {
    throw new TypeError(`${field} must contain only bounded reason codes`);
  }
  if (new Set(normalized).size !== normalized.length) throw new TypeError(`${field} must not contain duplicates`);
  return [...normalized].sort();
}

function receiptHash(payload) {
  return `sha256:${contentHash(payload)}`;
}

function externalReceiptHash(value, field, { nullable = false } = {}) {
  if (nullable && value == null) return null;
  const normalized = String(value ?? "").trim();
  if (!RECEIPT_HASH_RE.test(normalized)) throw new TypeError(`${field} must be a sha256 receipt hash`);
  return normalized;
}

function assertReceiptHash(receipt, field) {
  const { receiptHash: supplied, ...payload } = plainObject(receipt, field);
  if (supplied !== receiptHash(payload)) throw new TypeError(`${field}.receiptHash does not match its payload`);
  return receipt;
}

export function buildWorkflowReceipt({
  runId,
  agentId: rawAgentId,
  stageId,
  implementationId,
  contractVersion,
  activation,
  proofSource,
  evidenceClass,
  codeRevision,
  configIdentity,
  jobRunReceiptHash = null,
  observedAt,
}) {
  const stage = STAGE_BY_ID.get(String(stageId ?? "").trim());
  if (!stage) throw new TypeError("stageId is not a required parity stage");
  const normalizedContract = text(contractVersion, "contractVersion");
  if (normalizedContract !== stage.contractVersion) {
    throw new TypeError(`contractVersion must match ${stage.id}'s required contract`);
  }
  const payload = {
    schemaVersion: PARITY_WORKFLOW_RECEIPT_VERSION,
    runId: text(runId, "runId"),
    agentId: agentId(rawAgentId),
    stageId: stage.id,
    implementationId: text(implementationId, "implementationId"),
    contractVersion: normalizedContract,
    activation: oneOf(activation, ACTIVATIONS, "activation"),
    proofSource: oneOf(proofSource, PROOF_SOURCES, "proofSource"),
    evidenceClass: oneOf(evidenceClass, EVIDENCE_CLASSES, "evidenceClass"),
    codeRevision: text(codeRevision, "codeRevision"),
    configIdentity: text(configIdentity, "configIdentity"),
    jobRunReceiptHash: externalReceiptHash(jobRunReceiptHash, "jobRunReceiptHash", { nullable: true }),
    observedAt: iso(observedAt, "observedAt"),
  };
  if (payload.proofSource === "runtime_config" && payload.evidenceClass !== "organic") {
    throw new TypeError("runtime_config receipts must be organic");
  }
  if (payload.proofSource === "runtime_config" && !payload.jobRunReceiptHash) {
    throw new TypeError("runtime_config receipts require a linked jobRunReceiptHash");
  }
  if (payload.proofSource === "common_path_test" && payload.evidenceClass !== "synthetic") {
    throw new TypeError("common_path_test receipts must be synthetic");
  }
  if (payload.proofSource !== "runtime_config" && payload.jobRunReceiptHash) {
    throw new TypeError("only runtime_config receipts may link a live job-run receipt");
  }
  if (payload.activation === "test" && payload.evidenceClass !== "synthetic") {
    throw new TypeError("test activation must be synthetic");
  }
  return Object.freeze({ ...payload, receiptHash: receiptHash(payload) });
}

export function buildMandateDataReceipt({
  runId,
  agentId: rawAgentId,
  areaId,
  status,
  adapterId,
  contractVersion,
  policyVersion,
  evidenceSnapshotVersion,
  reasonCodes: rawReasonCodes = [],
  evidenceClass,
  codeRevision,
  jobRunReceiptHash = null,
  observedAt,
}) {
  const normalizedArea = String(areaId ?? "").trim();
  if (!DATA_AREA_SET.has(normalizedArea)) throw new TypeError("areaId is not a required mandate-data area");
  const normalizedStatus = oneOf(status, DATA_STATUSES, "status");
  const reasons = reasonCodes(rawReasonCodes);
  if (normalizedStatus !== "complete" && reasons.length === 0) {
    throw new TypeError("incomplete mandate-data receipts require an explicit reason code");
  }
  const payload = {
    schemaVersion: PARITY_DATA_RECEIPT_VERSION,
    runId: text(runId, "runId"),
    agentId: agentId(rawAgentId),
    areaId: normalizedArea,
    status: normalizedStatus,
    adapterId: text(adapterId, "adapterId"),
    contractVersion: text(contractVersion, "contractVersion"),
    policyVersion: text(policyVersion, "policyVersion"),
    evidenceSnapshotVersion: text(evidenceSnapshotVersion, "evidenceSnapshotVersion"),
    reasonCodes: reasons,
    evidenceClass: oneOf(evidenceClass, EVIDENCE_CLASSES, "evidenceClass"),
    codeRevision: text(codeRevision, "codeRevision"),
    jobRunReceiptHash: externalReceiptHash(jobRunReceiptHash, "jobRunReceiptHash", { nullable: true }),
    observedAt: iso(observedAt, "observedAt"),
  };
  if (payload.evidenceClass === "organic" && !payload.jobRunReceiptHash) {
    throw new TypeError("organic mandate-data receipts require a linked jobRunReceiptHash");
  }
  if (payload.evidenceClass === "synthetic" && payload.jobRunReceiptHash) {
    throw new TypeError("synthetic mandate-data receipts cannot link a live job-run receipt");
  }
  return Object.freeze({ ...payload, receiptHash: receiptHash(payload) });
}

function receiptMap(receipts, identity, label) {
  const out = new Map();
  for (let index = 0; index < receipts.length; index += 1) {
    const receipt = assertReceiptHash(receipts[index], `${label}[${index}]`);
    const key = identity(receipt);
    if (out.has(key)) throw new TypeError(`${label} contains duplicate receipt ${key}`);
    out.set(key, receipt);
  }
  return out;
}

function summarizeWorkflowAgent(agent, byKey, requiredActivation, requiredSource, requiredEvidenceClass) {
  const blockers = [];
  const receiptHashes = [];
  for (const stage of SHARED_MECHANICAL_STAGES) {
    const receipt = byKey.get(`${agent}:${stage.id}:${requiredEvidenceClass}:${requiredSource}:${requiredActivation}`);
    if (!receipt) {
      blockers.push({ stageId: stage.id, reasonCode: "missing_receipt" });
      continue;
    }
    receiptHashes.push(receipt.receiptHash);
    if (receipt.activation !== requiredActivation) blockers.push({ stageId: stage.id, reasonCode: "activation_not_proven" });
    if (receipt.proofSource !== requiredSource) blockers.push({ stageId: stage.id, reasonCode: "proof_source_mismatch" });
    if (receipt.evidenceClass !== requiredEvidenceClass) blockers.push({ stageId: stage.id, reasonCode: "evidence_class_mismatch" });
  }
  return { agentId: agent, complete: blockers.length === 0, blockers, receiptHashes: receiptHashes.sort() };
}

function sharedImplementationBlockers(receiptsForScope) {
  const blockers = [];
  for (const stage of SHARED_MECHANICAL_STAGES) {
    const receipts = receiptsForScope.filter((receipt) => receipt.stageId === stage.id);
    if (receipts.length !== PARITY_AGENT_IDS.length) continue;
    const implementations = new Set(receipts.map((receipt) => receipt.implementationId));
    const contracts = new Set(receipts.map((receipt) => receipt.contractVersion));
    const revisions = new Set(receipts.map((receipt) => receipt.codeRevision));
    const configIdentities = new Set(receipts.map((receipt) => receipt.configIdentity));
    if (implementations.size !== 1) blockers.push({ stageId: stage.id, reasonCode: "implementation_mismatch" });
    if (receipts.some((receipt) =>
      receipt.implementationId !== CANONICAL_COMMON_PATH_IMPLEMENTATIONS[stage.id])) {
      blockers.push({ stageId: stage.id, reasonCode: "canonical_implementation_mismatch" });
    }
    if (contracts.size !== 1) blockers.push({ stageId: stage.id, reasonCode: "contract_mismatch" });
    if (revisions.size !== 1) blockers.push({ stageId: stage.id, reasonCode: "code_revision_mismatch" });
    if (configIdentities.size !== 1) blockers.push({ stageId: stage.id, reasonCode: "common_config_identity_mismatch" });
  }
  return blockers;
}

function setLineageBlockers(receipts, label, {
  requiredEvidenceClass = null,
  requiredProofSource = null,
  requiredActivation = null,
} = {}) {
  if (!receipts.length) return [{ reasonCode: `${label}_receipts_missing` }];
  const blockers = [];
  const checks = [
    ["runId", `${label}_run_id_mismatch`],
    ["codeRevision", `${label}_code_revision_mismatch`],
    ["evidenceClass", `${label}_evidence_class_mismatch`],
    ["jobRunReceiptHash", `${label}_job_run_receipt_mismatch`],
  ];
  for (const [field, reasonCode] of checks) {
    if (new Set(receipts.map((receipt) => receipt[field])).size !== 1) blockers.push({ reasonCode });
  }
  if (requiredEvidenceClass && receipts.some((receipt) => receipt.evidenceClass !== requiredEvidenceClass)) {
    blockers.push({ reasonCode: `${label}_not_${requiredEvidenceClass}` });
  }
  if (requiredProofSource && receipts.some((receipt) => receipt.proofSource !== requiredProofSource)) {
    blockers.push({ reasonCode: `${label}_proof_source_mismatch` });
  }
  if (requiredActivation && receipts.some((receipt) => receipt.activation !== requiredActivation)) {
    blockers.push({ reasonCode: `${label}_activation_mismatch` });
  }
  return blockers;
}

function sharedDataContractBlockers(dataReceipts) {
  const blockers = [];
  for (const areaId of MANDATE_DATA_AREAS) {
    const receipts = dataReceipts.filter((receipt) => receipt.areaId === areaId);
    if (receipts.length !== PARITY_AGENT_IDS.length) continue;
    if (new Set(receipts.map((receipt) => receipt.contractVersion)).size !== 1) {
      blockers.push({ areaId, reasonCode: "data_contract_mismatch" });
    }
    if (new Set(receipts.map((receipt) => receipt.evidenceSnapshotVersion)).size !== 1) {
      blockers.push({ areaId, reasonCode: "evidence_snapshot_version_mismatch" });
    }
  }
  return blockers;
}

function crossReceiptLineageBlockers(workflowReceipts, dataReceipts) {
  if (!workflowReceipts.length || !dataReceipts.length) return [];
  const blockers = [];
  const workflowRunIds = new Set(workflowReceipts.map((receipt) => receipt.runId));
  const dataRunIds = new Set(dataReceipts.map((receipt) => receipt.runId));
  const workflowRevisions = new Set(workflowReceipts.map((receipt) => receipt.codeRevision));
  const dataRevisions = new Set(dataReceipts.map((receipt) => receipt.codeRevision));
  const workflowRunReceipts = new Set(workflowReceipts.map((receipt) => receipt.jobRunReceiptHash));
  const dataRunReceipts = new Set(dataReceipts.map((receipt) => receipt.jobRunReceiptHash));
  if (workflowRunIds.size !== 1 || dataRunIds.size !== 1 || [...workflowRunIds][0] !== [...dataRunIds][0]) {
    blockers.push({ reasonCode: "workflow_data_run_id_mismatch" });
  }
  if (workflowRevisions.size !== 1 || dataRevisions.size !== 1 || [...workflowRevisions][0] !== [...dataRevisions][0]) {
    blockers.push({ reasonCode: "workflow_data_code_revision_mismatch" });
  }
  if (workflowRunReceipts.size !== 1 || dataRunReceipts.size !== 1 || [...workflowRunReceipts][0] !== [...dataRunReceipts][0]) {
    blockers.push({ reasonCode: "workflow_data_job_run_receipt_mismatch" });
  }
  return blockers;
}

function summarizeDataAgent(agent, byKey, requiredEvidenceClass) {
  const blockers = [];
  const receiptHashes = [];
  for (const areaId of MANDATE_DATA_AREAS) {
    const receipt = byKey.get(`${agent}:${areaId}:${requiredEvidenceClass}`);
    if (!receipt) {
      blockers.push({ areaId, reasonCode: "missing_receipt" });
      continue;
    }
    receiptHashes.push(receipt.receiptHash);
    if (receipt.status !== "complete") {
      blockers.push({ areaId, reasonCode: `data_${receipt.status}`, detailReasonCodes: receipt.reasonCodes });
    }
  }
  return { agentId: agent, complete: blockers.length === 0, blockers, receiptHashes: receiptHashes.sort() };
}

/**
 * Assess receipt-backed capability parity.
 *
 * Mechanical workflow parity and mandate-data completeness are deliberately
 * independent. The result never decides whether a Phase 0 day counts and is
 * not an authorization or promotion record.
 */
export function assessAgentParityProof({
  workflowReceipts = [],
  dataReceipts = [],
  verifiedRuntimeRunReceiptHashes = [],
} = {}) {
  if (!Array.isArray(workflowReceipts) || !Array.isArray(dataReceipts) || !Array.isArray(verifiedRuntimeRunReceiptHashes)) {
    throw new TypeError("workflowReceipts, dataReceipts, and verifiedRuntimeRunReceiptHashes must be arrays");
  }
  const verifiedRunReceipts = new Set(verifiedRuntimeRunReceiptHashes.map((value, index) =>
    externalReceiptHash(value, `verifiedRuntimeRunReceiptHashes[${index}]`)));
  const workflowByKey = receiptMap(
    workflowReceipts,
    (receipt) => `${receipt.agentId}:${receipt.stageId}:${receipt.evidenceClass}:${receipt.proofSource}:${receipt.activation}`,
    "workflowReceipts",
  );
  const dataByKey = receiptMap(
    dataReceipts,
    (receipt) => `${receipt.agentId}:${receipt.areaId}:${receipt.evidenceClass}`,
    "dataReceipts",
  );
  const organicWorkflowReceipts = workflowReceipts.filter((receipt) =>
    receipt.activation === "live"
    && receipt.proofSource === "runtime_config"
    && receipt.evidenceClass === "organic");
  const syntheticWorkflowReceipts = workflowReceipts.filter((receipt) =>
    receipt.activation === "test"
    && receipt.proofSource === "common_path_test"
    && receipt.evidenceClass === "synthetic");
  const organicAgents = PARITY_AGENT_IDS.map((agent) =>
    summarizeWorkflowAgent(agent, workflowByKey, "live", "runtime_config", "organic"));
  const syntheticAgents = PARITY_AGENT_IDS.map((agent) =>
    summarizeWorkflowAgent(agent, workflowByKey, "test", "common_path_test", "synthetic"));
  const organicSharedBlockers = sharedImplementationBlockers(organicWorkflowReceipts);
  const syntheticSharedBlockers = sharedImplementationBlockers(syntheticWorkflowReceipts);
  const organicLineageBlockers = setLineageBlockers(organicWorkflowReceipts, "workflow", {
    requiredEvidenceClass: "organic",
    requiredProofSource: "runtime_config",
    requiredActivation: "live",
  });
  const syntheticLineageBlockers = setLineageBlockers(syntheticWorkflowReceipts, "synthetic_workflow", {
    requiredEvidenceClass: "synthetic",
    requiredProofSource: "common_path_test",
    requiredActivation: "test",
  });
  const organicDataReceipts = dataReceipts.filter((receipt) => receipt.evidenceClass === "organic");
  const dataAgents = PARITY_AGENT_IDS.map((agent) => summarizeDataAgent(agent, dataByKey, "organic"));
  const dataLineageBlockers = setLineageBlockers(organicDataReceipts, "data", {
    requiredEvidenceClass: "organic",
  });
  const dataContractBlockers = sharedDataContractBlockers(organicDataReceipts);
  const runtimeLinkBlockers = [...new Set([
    ...organicWorkflowReceipts,
    ...organicDataReceipts,
  ].filter((receipt) => !verifiedRunReceipts.has(receipt.jobRunReceiptHash))
    .map(() => "unverified_runtime_run_receipt"))].map((reasonCode) => ({ reasonCode }));
  const crossLineageBlockers = crossReceiptLineageBlockers(organicWorkflowReceipts, organicDataReceipts);
  const mechanicalWorkflowParity =
    organicAgents.every((agent) => agent.complete)
    && organicSharedBlockers.length === 0
    && organicLineageBlockers.length === 0
    && runtimeLinkBlockers.length === 0;
  const syntheticCommonPathParity =
    syntheticAgents.every((agent) => agent.complete)
    && syntheticSharedBlockers.length === 0
    && syntheticLineageBlockers.length === 0;
  const mandateDataCompleteness =
    dataAgents.every((agent) => agent.complete)
    && dataLineageBlockers.length === 0
    && dataContractBlockers.length === 0;
  const parityEvidenceComplete =
    mechanicalWorkflowParity
    && mandateDataCompleteness
    && crossLineageBlockers.length === 0;
  return {
    schemaVersion: PARITY_PROOF_SCHEMA_VERSION,
    mechanicalWorkflowParity,
    syntheticCommonPathParity,
    mandateDataCompleteness,
    parityEvidenceComplete,
    mechanicalWorkflow: {
      agents: organicAgents,
      sharedBlockers: organicSharedBlockers,
      lineageBlockers: organicLineageBlockers,
      runtimeLinkBlockers,
    },
    syntheticCommonPath: {
      agents: syntheticAgents,
      sharedBlockers: syntheticSharedBlockers,
      lineageBlockers: syntheticLineageBlockers,
    },
    mandateData: {
      agents: dataAgents,
      lineageBlockers: dataLineageBlockers,
      sharedContractBlockers: dataContractBlockers,
    },
    crossLineageBlockers,
    observerAuthority: "signed_phase0_observer_only",
  };
}

/**
 * Independent, fail-closed discovery activation for every specialist agent.
 * Falling back is always explicit in the returned receipt.
 */
export function resolveDiscoveryActivation({
  agentId: rawAgentId,
  requestedMode,
  emergencyDisable = false,
  candidateBusReady = false,
  catalogReady = false,
  switchVersion,
  configIdentity,
  codeRevision,
  observedAt,
}) {
  const normalizedAgent = agentId(rawAgentId);
  const requested = oneOf(requestedMode, DISCOVERY_MODES, "requestedMode");
  if (typeof emergencyDisable !== "boolean" || typeof candidateBusReady !== "boolean" || typeof catalogReady !== "boolean") {
    throw new TypeError("discovery readiness and emergency flags must be boolean");
  }
  let effectiveMode = requested;
  let reasonCode = "requested_mode_active";
  if (emergencyDisable) {
    effectiveMode = "fixed_watchlist";
    reasonCode = "emergency_disable_active";
  } else if (requested === "catalog_live" && (!candidateBusReady || !catalogReady)) {
    effectiveMode = "fixed_watchlist";
    reasonCode = !candidateBusReady ? "candidate_bus_not_ready" : "catalog_not_ready";
  }
  const payload = {
    schemaVersion: DISCOVERY_ACTIVATION_VERSION,
    agentId: normalizedAgent,
    requestedMode: requested,
    effectiveMode,
    emergencyDisable,
    candidateBusReady,
    catalogReady,
    rollbackApplied: requested !== effectiveMode,
    reasonCode,
    switchVersion: text(switchVersion, "switchVersion"),
    configIdentity: text(configIdentity, "configIdentity"),
    codeRevision: text(codeRevision, "codeRevision"),
    observedAt: iso(observedAt, "observedAt"),
    protectedBoundariesChanged: false,
  };
  return Object.freeze({ ...payload, receiptHash: receiptHash(payload) });
}
