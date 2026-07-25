import { test } from "node:test";
import assert from "node:assert/strict";
import { reconcileProposalShadow } from "../lib/pg/proposal-shadow-reconciler.js";
import { runProposalShadowReconcile } from "../jobs/proposal-shadow-reconcile.js";

test("proposal reconciliation replays every authoritative row and retains only aggregate receipt data", async () => {
  const mirrored = [];
  const result = await reconcileProposalShadow({
    listProposals: async () => [{ id: "private-a" }, { id: "private-b" }],
    mirrorProposal: async (proposal) => { mirrored.push(proposal.id); return { ok: true }; },
  });
  assert.deepEqual(mirrored, ["private-a", "private-b"]);
  assert.deepEqual(result, { authoritativeCount: 2, mirrored: 2, failed: 0, ok: true });
  assert.equal(JSON.stringify(result).includes("private-a"), false);
});

test("proposal reconciliation records a failed delivery and does not claim a clean retry", async () => {
  const writes = [];
  await assert.rejects(
    runProposalShadowReconcile({
      redis: { set: async (...args) => writes.push(args) },
      listProposals: async () => [{ id: "private-a" }],
      mirrorProposal: async () => ({ ok: false, error: "offline" }),
    }),
    /failed for 1 record/,
  );
  const receipt = JSON.parse(writes[0][1]);
  assert.deepEqual({
    authoritativeCount: receipt.authoritativeCount,
    mirrored: receipt.mirrored,
    failed: receipt.failed,
    ok: receipt.ok,
  }, { authoritativeCount: 1, mirrored: 0, failed: 1, ok: false });
  assert.equal(writes[0][1].includes("private-a"), false);
});
