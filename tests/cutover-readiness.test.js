import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateCanonicalCutoverReadiness } from "../lib/pg/cutover-readiness.js";

function exactRecord(day) {
  return { comparedAt: `${day}T20:00:00.000Z`, ok: true, valuation: { status: "EXACT_MATCH" } };
}

const proof = {
  provider: "neon", method: "pitr", status: "verified", digestVerified: true,
  ledgerVerified: true, sequenceVerified: true, writerCoverageVerified: true, rollbackDrillVerified: true,
};

test("canonical cutover stays blocked until all 30 exact-parity calendar days exist", () => {
  const start = Date.parse("2026-06-27T00:00:00.000Z");
  const parityHistory = Array.from({ length: 29 }, (_, index) => exactRecord(new Date(start + index * 86400000).toISOString().slice(0, 10)));
  const result = evaluateCanonicalCutoverReadiness({
    parityHistory, reconciliation: { ok: true, failed: 0 }, recoveryProof: proof, asOf: "2026-07-25T22:00:00.000Z",
  });
  assert.equal(result.ok, false);
  assert.equal(result.gates.parityWindow, false);
});

test("canonical cutover requires exact valuation, replay health, recovery, writer, and rollback proof", () => {
  const start = Date.parse("2026-06-26T00:00:00.000Z");
  const parityHistory = Array.from({ length: 30 }, (_, index) => exactRecord(new Date(start + index * 86400000).toISOString().slice(0, 10)));
  const result = evaluateCanonicalCutoverReadiness({
    parityHistory, reconciliation: { ok: true, failed: 0 }, recoveryProof: proof, asOf: "2026-07-25T22:00:00.000Z",
  });
  assert.equal(result.ok, true);
  assert.equal(result.cleanDays, 30);
});
