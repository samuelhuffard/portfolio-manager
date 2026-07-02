import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verifies the decision signature the dashboard attaches when a manager
 * approves a proposal (see portfolio-dashboard/lib/proposals.ts
 * computeDecisionSignature — the canonical payload lives there and is
 * mirrored here and in the Mac companion; keep the three in sync).
 *
 * Execution trust used to rest on `status === "ApprovedForBrokerReview"`
 * alone, which meant anything holding Redis credentials could forge an
 * approved trade. With the signature, approval authority stays with the
 * dashboard's decision flow.
 */
export function computeDecisionSignature(proposal, secret) {
  const payload = [
    proposal.id,
    proposal.status,
    proposal.agentId,
    proposal.ticker,
    proposal.side,
    String(proposal.amountDollars),
    proposal.maxPrice == null ? "" : String(proposal.maxPrice),
    proposal.decidedAt ?? "",
    proposal.decidedByUserId ?? "",
  ].join("|");
  return createHmac("sha256", secret).update(payload).digest("hex");
}

/**
 * Throws unless the proposal carries a valid decision signature. When no
 * secret is configured in this environment we cannot verify — fail closed
 * unless ALLOW_UNSIGNED_PROPOSALS=true explicitly opts out (mirrors the
 * investor-ledger escape hatch; do not set it where real money executes).
 */
export function assertApprovedProposalSignature(proposal, { secret = resolveSecret() } = {}) {
  if (!secret) {
    if (process.env.ALLOW_UNSIGNED_PROPOSALS === "true") return;
    throw new Error(
      "AUDIT_HMAC_SECRET is not configured — cannot verify the proposal's approval signature. " +
        "Set it (same value as the dashboard) or explicitly set ALLOW_UNSIGNED_PROPOSALS=true."
    );
  }
  if (!proposal.decisionHmac) {
    throw new Error(
      `Proposal ${proposal.id} has no decision signature — it was not approved through the dashboard. Refusing.`
    );
  }
  const expected = Buffer.from(computeDecisionSignature(proposal, secret), "hex");
  const provided = Buffer.from(String(proposal.decisionHmac), "hex");
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    throw new Error(
      `Proposal ${proposal.id} decision signature is INVALID — trade-relevant fields were modified after approval, ` +
        "or the proposal was forged. Refusing."
    );
  }
}

export function resolveSecret() {
  return process.env.AUDIT_HMAC_SECRET?.trim() || null;
}
