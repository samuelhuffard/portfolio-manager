import { createHash } from "node:crypto";

function stableReference(kind, value) {
  if (value == null || value === "") return null;
  return `${kind}_${createHash("sha256").update(String(value)).digest("hex").slice(0, 12)}`;
}

/**
 * Convert operational proposal data into a review packet. This is intentionally
 * one-way: no signature, user identifier, broker order id, or audit metadata
 * leaves the production store.
 */
export function redactProposalForReview(proposal) {
  return {
    proposalRef: stableReference("proposal", proposal?.id),
    agentId: proposal?.agentId ?? null,
    ticker: proposal?.ticker ?? null,
    side: proposal?.side ?? null,
    amountDollars: proposal?.amountDollars ?? null,
    maxPrice: proposal?.maxPrice ?? null,
    sellOwnerShareLimit: proposal?.sellOwnerShareLimit ?? null,
    rationale: proposal?.rationale ?? null,
    riskSummary: proposal?.riskSummary ?? null,
    buyDossier: proposal?.buyDossier ?? null,
    sellDossier: proposal?.sellDossier ?? null,
    status: proposal?.status ?? null,
    createdAt: proposal?.createdAt ?? null,
    updatedAt: proposal?.updatedAt ?? null,
    expiresAt: proposal?.expiresAt ?? null,
    decidedAt: proposal?.decidedAt ?? null,
    decisionNote: proposal?.decisionNote ?? null,
    fulfilledAt: proposal?.fulfilledAt ?? null,
    fulfilledShares: proposal?.fulfilledShares ?? null,
    executionFailedAt: proposal?.executionFailedAt ?? null,
    executionFailureReason: proposal?.executionFailureReason ?? null,
  };
}

export function redactResearchDecisionForReview(record) {
  return {
    source: record?.source ?? null,
    runRef: stableReference("run", record?.runId),
    agentId: record?.agentId ?? null,
    ticker: record?.ticker ?? null,
    decidedAt: record?.decidedAt ?? null,
    quantScore: record?.quantScore ?? null,
    generatorAction: record?.generatorAction ?? null,
    finalAction: record?.finalAction ?? null,
    evaluatorState: record?.evaluatorState ?? null,
    evaluatorVerdict: record?.evaluatorVerdict ?? null,
    evaluatorCritique: record?.evaluatorCritique ?? [],
    proposalDisposition: record?.proposalDisposition ?? null,
    proposalRef: stableReference("proposal", record?.proposalId),
    reason: record?.reason ?? null,
    ruleCheck: record?.ruleCheck ?? [],
    generatorThesis: record?.generatorThesis ?? null,
    finalThesis: record?.finalThesis ?? null,
    rationale: record?.rationale ?? null,
    requestedTargetWeight: record?.requestedTargetWeight ?? null,
    finalTargetWeight: record?.finalTargetWeight ?? null,
    evaluatorRevisions: record?.evaluatorRevisions ?? null,
    kairosOutcome: record?.kairosOutcome ?? null,
    kairosExplanation: record?.kairosExplanation ?? [],
  };
}

export function redactActivityForReview(event) {
  return {
    timestamp: event?.timestamp ?? null,
    role: event?.role ?? null,
    action: event?.action ?? null,
    route: event?.route ?? null,
  };
}

export function buildProposalAuditReviewPacket({ proposals = [], researchDecisions = [], activity = [], generatedAt = new Date().toISOString() } = {}) {
  return {
    schemaVersion: "proposal-audit-review-packet-v1",
    generatedAt,
    redaction: {
      excluded: [
        "Redis credentials and all secrets",
        "approval, audit, and ledger HMAC values",
        "user IDs, email addresses, and audit metadata",
        "broker order IDs",
      ],
      correlation: "Proposal and run references are deterministic one-way hashes within this packet.",
    },
    proposals: proposals.map(redactProposalForReview),
    researchDecisions: researchDecisions.map(redactResearchDecisionForReview),
    activity: activity.map(redactActivityForReview),
  };
}
