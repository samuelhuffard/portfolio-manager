import { getRedis, listAllProposals } from "../lib/redis.js";
import { shadowWriteProposal } from "../lib/pg/dual-write.js";
import { reconcileProposalShadow } from "../lib/pg/proposal-shadow-reconciler.js";

export const PROPOSAL_SHADOW_RECONCILE_KEY = "pm:proposal-shadow-reconcile:latest";

export async function runProposalShadowReconcile({ redis = getRedis(), listProposals = listAllProposals, mirrorProposal = shadowWriteProposal } = {}) {
  if (!redis) throw new Error("Redis is unavailable; proposal shadow reconciliation cannot verify authoritative delivery.");
  const result = await reconcileProposalShadow({ listProposals, mirrorProposal });
  const receipt = {
    ...result,
    completedAt: new Date().toISOString(),
  };
  await redis.set(PROPOSAL_SHADOW_RECONCILE_KEY, JSON.stringify(receipt));
  if (!result.ok) throw new Error(`Proposal shadow reconciliation failed for ${result.failed} record(s).`);
  return receipt;
}
