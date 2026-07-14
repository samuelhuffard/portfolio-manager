import test from "node:test";
import assert from "node:assert/strict";
import { signPhase0Observation, assertPhase0Observation } from "../lib/phase0-observation-ledger.js";

const SECRET = "test-phase0-secret";

test("Phase 0 observation signatures round-trip and detect nested tampering", () => {
  const signed = signPhase0Observation({ dateET: "2026-07-14", checks: [{ name: "jobs", status: "pass" }] }, SECRET);
  assert.equal(assertPhase0Observation(signed, SECRET), signed);
  assert.throws(() => assertPhase0Observation({ ...signed, checks: [{ name: "jobs", status: "fail" }] }, SECRET), /hash mismatch/);
  assert.throws(() => assertPhase0Observation({ ...signed, rowHmac: "00".repeat(32) }, SECRET), /HMAC mismatch/);
  assert.throws(() => assertPhase0Observation({ dateET: "2026-07-14" }, SECRET), /unsigned/);
});
