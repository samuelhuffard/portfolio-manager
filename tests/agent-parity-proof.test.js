import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { ProposalSchema, validateProposalInput } from "../contracts/proposal.js";
import { OrderIntentSchema } from "../contracts/pipeline.js";
import {
  CANONICAL_COMMON_PATH_IMPLEMENTATIONS,
  MANDATE_DATA_AREAS,
  PARITY_AGENT_IDS,
  SHARED_MECHANICAL_STAGES,
  assessAgentParityProof,
  buildMandateDataReceipt,
  buildWorkflowReceipt,
  resolveDiscoveryActivation,
} from "../lib/agent-parity-proof.js";
import { applyRiskChecks } from "../lib/risk-engine.js";
import { parseEvaluatorResponse, resolveFinalVerdict } from "../lib/evaluator.js";
import { computeDecisionSignature, isValidApprovalSignature } from "../lib/proposal-signature.js";
import { applyFillToLots, validateMcpFillInput } from "../lib/mcp-accounting.js";

const NOW = "2026-07-20T18:00:00.000Z";
const CODE_REVISION = "0123456789abcdef";
const JOB_RUN_RECEIPT_HASH = `sha256:${"a".repeat(64)}`;

function workflowReceipts({
  activation = "live",
  proofSource = "runtime_config",
  evidenceClass = "organic",
  implementationOverride = {},
} = {}) {
  return PARITY_AGENT_IDS.flatMap((agentId) =>
    SHARED_MECHANICAL_STAGES.map((stage) => buildWorkflowReceipt({
      runId: "parity-run-2026-07-20",
      agentId,
      stageId: stage.id,
      implementationId: implementationOverride[`${agentId}:${stage.id}`]
        ?? CANONICAL_COMMON_PATH_IMPLEMENTATIONS[stage.id],
      contractVersion: stage.contractVersion,
      activation,
      proofSource,
      evidenceClass,
      codeRevision: CODE_REVISION,
      configIdentity: `config-${stage.id}-v1`,
      jobRunReceiptHash: evidenceClass === "organic" ? JOB_RUN_RECEIPT_HASH : null,
      observedAt: NOW,
    })));
}

function dataReceipts(status = "complete") {
  return PARITY_AGENT_IDS.flatMap((agentId) =>
    MANDATE_DATA_AREAS.map((areaId) => buildMandateDataReceipt({
      runId: "parity-run-2026-07-20",
      agentId,
      areaId,
      status,
      adapterId: `${agentId}-${areaId}-adapter-v1`,
      contractVersion: `${areaId}-contract-v1`,
      policyVersion: `${agentId}-${areaId}-policy-v1`,
      evidenceSnapshotVersion: "evidence-snapshot-v1",
      reasonCodes: status === "complete" ? [] : ["input_unavailable"],
      evidenceClass: "organic",
      codeRevision: CODE_REVISION,
      jobRunReceiptHash: JOB_RUN_RECEIPT_HASH,
      observedAt: NOW,
    })));
}

test("receipt-backed assessor separates mechanical workflow parity from mandate-data completeness", () => {
  const complete = assessAgentParityProof({
    workflowReceipts: workflowReceipts(),
    dataReceipts: dataReceipts(),
    verifiedRuntimeRunReceiptHashes: [JOB_RUN_RECEIPT_HASH],
  });
  assert.equal(complete.mechanicalWorkflowParity, true);
  assert.equal(complete.mandateDataCompleteness, true);
  assert.equal(complete.parityEvidenceComplete, true);
  assert.equal(complete.syntheticCommonPathParity, false);
  assert.equal(complete.observerAuthority, "signed_phase0_observer_only");

  const incompleteData = assessAgentParityProof({
    workflowReceipts: workflowReceipts(),
    dataReceipts: dataReceipts("partial"),
    verifiedRuntimeRunReceiptHashes: [JOB_RUN_RECEIPT_HASH],
  });
  assert.equal(incompleteData.mechanicalWorkflowParity, true);
  assert.equal(incompleteData.mandateDataCompleteness, false);
  assert.equal(incompleteData.parityEvidenceComplete, false);

  const serialized = JSON.stringify(complete);
  assert.doesNotMatch(serialized, /trustObservationEligible|countsTowardSafetyWindow/i);
});

test("synthetic common-path proof cannot masquerade as organic live wiring", () => {
  const assessment = assessAgentParityProof({
    workflowReceipts: workflowReceipts({
      activation: "test",
      proofSource: "common_path_test",
      evidenceClass: "synthetic",
    }),
    dataReceipts: [],
  });
  assert.equal(assessment.syntheticCommonPathParity, true);
  assert.equal(assessment.mechanicalWorkflowParity, false);
  assert.equal(assessment.parityEvidenceComplete, false);
});

test("organic and synthetic receipts can coexist without overwriting each other", () => {
  const assessment = assessAgentParityProof({
    workflowReceipts: [
      ...workflowReceipts(),
      ...workflowReceipts({
        activation: "test",
        proofSource: "common_path_test",
        evidenceClass: "synthetic",
      }),
    ],
    dataReceipts: dataReceipts(),
    verifiedRuntimeRunReceiptHashes: [JOB_RUN_RECEIPT_HASH],
  });
  assert.equal(assessment.mechanicalWorkflowParity, true);
  assert.equal(assessment.syntheticCommonPathParity, true);
  assert.equal(assessment.mandateDataCompleteness, true);
  assert.equal(assessment.parityEvidenceComplete, true);
});

test("organic receipts remain unproven until their linked live job receipt is independently verified", () => {
  const assessment = assessAgentParityProof({
    workflowReceipts: workflowReceipts(),
    dataReceipts: dataReceipts(),
  });
  assert.equal(assessment.mechanicalWorkflowParity, false);
  assert.equal(assessment.mandateDataCompleteness, true);
  assert.equal(assessment.parityEvidenceComplete, false);
  assert.deepEqual(assessment.mechanicalWorkflow.runtimeLinkBlockers, [{
    reasonCode: "unverified_runtime_run_receipt",
  }]);
});

test("missing, mismatched, or tampered receipts fail closed", () => {
  const missing = workflowReceipts().slice(1);
  assert.equal(assessAgentParityProof({ workflowReceipts: missing }).mechanicalWorkflowParity, false);

  const mismatched = workflowReceipts({
    implementationOverride: {
      "agent-3:proposal_queue": "lib/other-proposals.js#createProposal",
    },
  });
  const mismatchAssessment = assessAgentParityProof({ workflowReceipts: mismatched });
  assert.equal(mismatchAssessment.mechanicalWorkflowParity, false);
  assert.deepEqual(mismatchAssessment.mechanicalWorkflow.sharedBlockers, [
    { stageId: "proposal_queue", reasonCode: "implementation_mismatch" },
    { stageId: "proposal_queue", reasonCode: "canonical_implementation_mismatch" },
  ]);

  const unanimouslyWrong = workflowReceipts({
    implementationOverride: Object.fromEntries(PARITY_AGENT_IDS.map((agentId) =>
      [`${agentId}:candidate_bus`, "lib/wrong-bus.js#buildWrongBus"])),
  });
  const wrongAssessment = assessAgentParityProof({ workflowReceipts: unanimouslyWrong });
  assert.equal(wrongAssessment.mechanicalWorkflowParity, false);
  assert.deepEqual(wrongAssessment.mechanicalWorkflow.sharedBlockers, [{
    stageId: "candidate_bus",
    reasonCode: "canonical_implementation_mismatch",
  }]);

  const tampered = workflowReceipts();
  tampered[0] = { ...tampered[0], activation: "disabled" };
  assert.throws(
    () => assessAgentParityProof({ workflowReceipts: tampered }),
    /receiptHash does not match/,
  );
});

test("stale or cross-run receipt mixtures cannot assemble a parity proof", () => {
  const mixedWorkflow = workflowReceipts();
  mixedWorkflow[0] = buildWorkflowReceipt({
    ...mixedWorkflow[0],
    runId: "older-run",
  });
  const workflowAssessment = assessAgentParityProof({ workflowReceipts: mixedWorkflow });
  assert.equal(workflowAssessment.mechanicalWorkflowParity, false);
  assert.deepEqual(workflowAssessment.mechanicalWorkflow.lineageBlockers, [{
    reasonCode: "workflow_run_id_mismatch",
  }]);

  const mixedData = dataReceipts();
  mixedData[0] = buildMandateDataReceipt({
    ...mixedData[0],
    runId: "older-run",
  });
  const dataAssessment = assessAgentParityProof({
    workflowReceipts: workflowReceipts(),
    dataReceipts: mixedData,
  });
  assert.equal(dataAssessment.mandateDataCompleteness, false);
  assert.equal(dataAssessment.parityEvidenceComplete, false);
  assert.ok(dataAssessment.crossLineageBlockers.some((item) =>
    item.reasonCode === "workflow_data_run_id_mismatch"));
});

test("all three agent IDs traverse the same proposal, evaluator, downgrade, approval, signature, ownership, and ledger-shaped path", () => {
  const riskLimits = {
    blockOnStaleData: true,
    prohibitAveragingDown: true,
    requireBearCase: true,
    minConfidence: 0.5,
    maxPositionPct: 15,
    maxSectorPct: 60,
  };
  const secret = "synthetic-common-path-secret";

  for (const agentId of PARITY_AGENT_IDS) {
    const proposalInput = validateProposalInput({
      agentId,
      ticker: "TEST",
      side: "BUY",
      amountDollars: 100,
      maxPrice: 10,
      rationale: "Synthetic common-path contract fixture.",
      riskSummary: "Synthetic fixture; no recommendation.",
    });
    assert.equal(proposalInput.ok, true);
    assert.equal(proposalInput.value.agentId, agentId);

    const downgraded = applyRiskChecks({
      action: "BUY",
      targetWeight: 5,
      confidence: null,
      risks: ["synthetic risk"],
      killCriteria: ["synthetic criterion"],
    }, {
      currentSectorWeightPct: 0,
      currentPositionWeightPct: 0,
      isHeldAtLoss: false,
      dataStale: false,
    }, riskLimits);
    assert.equal(downgraded.action, "HOLD");
    assert.equal(downgraded.ruleChecks.confidence_ok, false);

    const malformedEvaluation = parseEvaluatorResponse("not-json");
    assert.equal(malformedEvaluation.verdict, "REJECT");
    assert.equal(resolveFinalVerdict({ verdict: "REVISE", critique: [] }).verdict, "REJECT");

    const approved = {
      id: `proposal-${agentId}`,
      agentId,
      ticker: "TEST",
      side: "BUY",
      amountDollars: 100,
      maxPrice: 10,
      rationale: "Synthetic common-path contract fixture.",
      riskSummary: "Synthetic fixture; no recommendation.",
      status: "ApprovedForBrokerReview",
      createdAt: NOW,
      updatedAt: NOW,
      expiresAt: "2026-07-22T18:00:00.000Z",
      createdByUserId: "system:research-scan",
      createdByEmail: null,
      decidedAt: NOW,
      decidedByUserId: "user:synthetic-manager",
      decisionNote: "synthetic test only",
      fulfilledAt: null,
      fulfilledOrderId: null,
      fulfilledShares: null,
      decisionHmac: null,
    };
    approved.decisionHmac = computeDecisionSignature(approved, secret);
    assert.equal(ProposalSchema.parse(approved).agentId, agentId);
    assert.equal(isValidApprovalSignature(approved, { secret }), true);
    assert.equal(OrderIntentSchema.parse({
      proposalId: approved.id,
      refId: approved.id,
      agentId,
      ticker: approved.ticker,
      side: approved.side,
      amountDollars: approved.amountDollars,
      maxPrice: approved.maxPrice,
      approvedAt: approved.decidedAt,
      decisionHmac: approved.decisionHmac,
    }).agentId, agentId);

    const trade = validateMcpFillInput({
      proposal: approved,
      existingTrades: [],
      orderId: `order-${agentId}`,
      ticker: "TEST",
      side: "BUY",
      shares: 10,
      price: 10,
      agentId,
      signatureSecret: secret,
    });
    assert.equal(trade.agentId, agentId);
    assert.equal(trade.proposalId, approved.id);
    assert.equal(trade.orderId, `order-${agentId}`);

    const lotResult = applyFillToLots(trade, []);
    assert.equal(lotResult.newLots.length, 1);
    assert.equal(lotResult.newLots[0].agentId, agentId);
  }

  const scanSource = readFileSync(new URL("../jobs/research-scan.js", import.meta.url), "utf8");
  assert.match(scanSource, /async function reviewCandidateForAgent\(agent, c, ctx\)/);
  assert.match(scanSource, /applyRiskChecks\(/);
  assert.match(scanSource, /evaluateProposal\(/);
  assert.match(scanSource, /createProposal\(\{\s*agentId: agent\.id/s);
});

test("all three discovery switches roll back independently and visibly", () => {
  const common = {
    requestedMode: "catalog_live",
    candidateBusReady: true,
    catalogReady: true,
    switchVersion: "discovery-switch-v1",
    configIdentity: "discovery-config-v1",
    codeRevision: CODE_REVISION,
    observedAt: NOW,
  };
  const agent2 = resolveDiscoveryActivation({ ...common, agentId: "agent-2" });
  const agent3 = resolveDiscoveryActivation({ ...common, agentId: "agent-3", emergencyDisable: true });
  const agent1 = resolveDiscoveryActivation({ ...common, agentId: "agent-1" });
  assert.equal(agent1.effectiveMode, "catalog_live");
  assert.equal(agent1.rollbackApplied, false);
  assert.equal(agent2.effectiveMode, "catalog_live");
  assert.equal(agent2.rollbackApplied, false);
  assert.equal(agent3.effectiveMode, "fixed_watchlist");
  assert.equal(agent3.rollbackApplied, true);
  assert.equal(agent3.reasonCode, "emergency_disable_active");
  assert.equal(agent3.protectedBoundariesChanged, false);

  const unready = resolveDiscoveryActivation({
    ...common,
    agentId: "agent-2",
    candidateBusReady: false,
  });
  assert.equal(unready.effectiveMode, "fixed_watchlist");
  assert.equal(unready.reasonCode, "candidate_bus_not_ready");
});
