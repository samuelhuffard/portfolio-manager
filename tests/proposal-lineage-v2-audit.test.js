import test from "node:test";
import assert from "node:assert/strict";
import { PROPOSAL_SOURCE_INVENTORY } from "../lib/proposal-source-inventory.js";
import { auditProposalWriterPaths, buildV2FixturePayload, findDirectProposalWriters, fixtureDigest } from "../lib/proposal-lineage-v2-audit.js";

const proposal = {
  id: "proposal-1", status: "ApprovedForBrokerReview", agentId: "agent-1", ticker: "NVDA", side: "BUY",
  amountDollars: 100, maxPrice: null, decidedAt: "2026-07-24T12:00:00.000Z", decidedByUserId: "sam",
  strategyProposalFingerprint: "a".repeat(64), signatureVersion: "v2",
};

test("v2 fixture bytes are deterministic, null-safe, and tamper-sensitive", () => {
  const payload = buildV2FixturePayload(proposal);
  assert.equal(payload, `proposal-1|ApprovedForBrokerReview|agent-1|NVDA|BUY|100||2026-07-24T12:00:00.000Z|sam|${"a".repeat(64)}|v2`);
  assert.notEqual(fixtureDigest(proposal), fixtureDigest({ ...proposal, strategyProposalFingerprint: "b".repeat(64) }));
  assert.throws(() => buildV2FixturePayload({ ...proposal, ticker: "NV|DA" }), /unescaped pipe/);
  assert.throws(() => buildV2FixturePayload({ ...proposal, signatureVersion: "v1" }), /must be v2/);
});

test("static writer audit accepts declared paths and rejects a bypass", () => {
  const found = findDirectProposalWriters([
    { path: "jobs/research-scan.js", content: "await createProposal({});" },
    { path: "jobs/unknown-shortcut.js", content: "createProposal({});" },
  ]);
  assert.deepEqual(found, ["jobs/research-scan.js", "jobs/unknown-shortcut.js"]);
  const audit = auditProposalWriterPaths(found, PROPOSAL_SOURCE_INVENTORY);
  assert.equal(audit.valid, false);
  assert.deepEqual(audit.undeclared, ["jobs/unknown-shortcut.js"]);
  assert.equal(auditProposalWriterPaths(["jobs/research-scan.js"], PROPOSAL_SOURCE_INVENTORY).valid, true);
});
