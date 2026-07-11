import { test } from "node:test";
import assert from "node:assert/strict";
import { dualWriteEnabled, shadowWriteProposal, shadowWriteLot, shadowWriteCapitalEntry } from "../lib/pg/dual-write.js";

// The safety-critical properties of the shadow layer, testable without a DB:
// OFF by default, and a shadow write is always a no-op that never throws when
// disabled. (Live insert/parity behavior is exercised by the manual Neon smoke,
// not the unit suite, so CI never depends on DB connectivity.)

const savedFlag = process.env.PG_DUAL_WRITE;
process.env.PG_DUAL_WRITE = ""; // force disabled regardless of ambient env

test("dualWriteEnabled is false without the explicit flag", () => {
  assert.equal(dualWriteEnabled(), false);
});

test("shadow writes are no-ops that never throw when disabled — even on garbage input", async () => {
  for (const fn of [shadowWriteProposal, shadowWriteLot, shadowWriteCapitalEntry]) {
    const res = await fn({ total: "garbage", not: "a real object" });
    assert.deepEqual(res, { ok: false, skipped: true });
  }
});

test.after(() => {
  if (savedFlag === undefined) delete process.env.PG_DUAL_WRITE;
  else process.env.PG_DUAL_WRITE = savedFlag;
});
