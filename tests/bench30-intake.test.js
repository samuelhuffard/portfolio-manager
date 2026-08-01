import test from "node:test";
import assert from "node:assert/strict";
import { BENCH30_EVIDENCE_PACKETS } from "../fixtures/bench30-evidence-packets.js";
import { buildBench30IntakeReport, BENCH30_INTAKE_VERSION, validateBench30EvidencePacket } from "../lib/bench30-intake.js";

const packet = {
  version: BENCH30_INTAKE_VERSION, slotId: "B01",
  security: { ticker: "ALPHA", shareClass: "common" },
  decisionTime: "2025-01-31T21:00:00.000Z", availableAt: "2025-01-31T19:00:00.000Z", retrievedAt: "2025-01-31T20:00:00.000Z",
  sourceTier: "primary", receipt: { path: "evidence/B01.txt", sha256: "a".repeat(64), retentionNote: "test-only retained receipt" },
  facts: [{ name: "test_fact", value: "test_only" }], missingness: [], expectedDisposition: "blocked_missing",
  policyVersion: "mandate-v3-baseline", eventState: { restatementOrCorporateAction: "none", conflictState: "none" },
};

test("a complete local packet needs chronology, receipt, identity, and policy evidence", () => {
  assert.deepEqual(validateBench30EvidencePacket(packet), { valid: true, errors: [] });
  const invalid = { ...packet, retrievedAt: "2025-02-01T00:00:00.000Z", receipt: { ...packet.receipt, sha256: "missing" } };
  assert.deepEqual(validateBench30EvidencePacket(invalid), { valid: false, errors: ["retrieved_after_decision", "receipt_hash_required"] });
});

test("the empty packet store reports an explicit held corpus rather than Bench30", () => {
  const report = buildBench30IntakeReport(BENCH30_EVIDENCE_PACKETS);
  assert.equal(report.requiredSlots, 30);
  assert.equal(report.presentSlots, 0);
  assert.equal(report.status, "held");
  assert.equal(report.mayCallItBench30, false);
  assert.equal(report.missing.length, 30);
});
