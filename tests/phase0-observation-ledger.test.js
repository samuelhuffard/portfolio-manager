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

test("observation verification accepts records signed before a dedicated secret existed", () => {
  const legacySecret = "legacy-investor-fallback-secret";
  const dedicatedSecret = "new-dedicated-operational-secret";
  const legacyRecord = signPhase0Observation({ dateET: "2026-07-14", verdict: "FAIL_BOTH", checks: [] }, legacySecret);
  const saved = {};
  const keys = ["OPERATIONAL_LEDGER_HMAC_SECRET", "OPERATIONAL_LEDGER_LEGACY_HMAC_SECRETS", "INVESTOR_LEDGER_HMAC_SECRET", "AUDIT_HMAC_SECRET"];
  for (const key of keys) saved[key] = process.env[key];
  try {
    process.env.OPERATIONAL_LEDGER_HMAC_SECRET = dedicatedSecret;
    process.env.INVESTOR_LEDGER_HMAC_SECRET = legacySecret;
    delete process.env.AUDIT_HMAC_SECRET;
    delete process.env.OPERATIONAL_LEDGER_LEGACY_HMAC_SECRETS;
    assert.throws(() => assertPhase0Observation(legacyRecord, dedicatedSecret), /HMAC mismatch/);
    process.env.OPERATIONAL_LEDGER_LEGACY_HMAC_SECRETS = legacySecret;
    assert.equal(assertPhase0Observation(legacyRecord, dedicatedSecret), legacyRecord);
    assert.equal(assertPhase0Observation(legacyRecord), legacyRecord);
    const forged = signPhase0Observation({ dateET: "2026-07-14", verdict: "PASS_BOTH", checks: [] }, "unconfigured-attacker-secret");
    assert.throws(() => assertPhase0Observation(forged, dedicatedSecret), /HMAC mismatch/);
    delete process.env.OPERATIONAL_LEDGER_LEGACY_HMAC_SECRETS;
    assert.throws(() => assertPhase0Observation(legacyRecord, dedicatedSecret), /HMAC mismatch/);
  } finally {
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
});
