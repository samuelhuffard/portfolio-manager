import { timingSafeEqual } from "node:crypto";
// The signature payload + HMAC now live single-source in the shared contract
// (contracts/signature.js). This file keeps the backend's fail-closed verify
// wrapper and secret resolution. Execution trust used to rest on
// `status === "ApprovedForBrokerReview"` alone, which meant anything holding
// Redis credentials could forge an approved trade; the signature keeps approval
// authority with the dashboard's decision flow.
export { computeDecisionSignature } from "../contracts/signature.js";
import { computeDecisionSignature } from "../contracts/signature.js";

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

/**
 * Non-throwing signature check for filter/attribution paths (Codex #3): the
 * fill-attribution path must not attribute or fulfill a fill against a proposal
 * whose `decisionHmac` is merely present — it must be VALID. Returns false on a
 * missing secret (fail closed), a missing/malformed signature, or a mismatch.
 */
export function isValidApprovalSignature(proposal, { secret = resolveSecret() } = {}) {
  if (!secret || !proposal || !proposal.decisionHmac) return false;
  let provided;
  try {
    provided = Buffer.from(String(proposal.decisionHmac), "hex");
  } catch {
    return false;
  }
  const expected = Buffer.from(computeDecisionSignature(proposal, secret), "hex");
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}
