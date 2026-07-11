import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dualWriteEnabled,
  runShadowOperation,
  shadowWriteProposal,
  shadowWriteLot,
  shadowWriteCapitalEntry,
  shadowWritePosition,
  shadowReplacePositions,
} from "../lib/pg/dual-write.js";

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
  for (const fn of [shadowWriteProposal, shadowWriteLot, shadowWriteCapitalEntry, shadowWritePosition, shadowReplacePositions]) {
    const res = await fn({ total: "garbage", not: "a real object" });
    assert.deepEqual(res, { ok: false, skipped: true });
  }
});

test("an enabled shadow failure is reported but never thrown into the authoritative path", async () => {
  const originalError = console.error;
  const errors = [];
  console.error = (...args) => errors.push(args.join(" "));
  try {
    const result = await runShadowOperation(
      "failure-test",
      async () => { throw new Error("database unavailable"); },
      { enabled: true, pool: {} }
    );
    assert.deepEqual(result, { ok: false, error: "database unavailable" });
    assert.match(errors[0], /authoritative write unaffected/);
  } finally {
    console.error = originalError;
  }
});

test("position refresh rolls back a partial shadow transaction and still does not throw", async () => {
  const queries = [];
  const client = {
    async query(sql) {
      queries.push(sql);
      if (String(sql).startsWith("INSERT INTO positions") && queries.filter((q) => String(q).startsWith("INSERT INTO positions")).length === 2) {
        throw new Error("second row failed");
      }
    },
    release() {},
  };
  const originalError = console.error;
  console.error = () => {};
  try {
    const result = await shadowReplacePositions([
      { ticker: "NVDA", shares: 1, avgCost: 100, costBasis: 100, marketValue: 110 },
      { ticker: "AMD", shares: 2, avgCost: 50, costBasis: 100, marketValue: 105 },
    ], { enabled: true, pool: { connect: async () => client } });
    assert.deepEqual(result, { ok: false, error: "second row failed" });
    assert.ok(queries.includes("ROLLBACK"));
    assert.ok(!queries.includes("COMMIT"));
  } finally {
    console.error = originalError;
  }
});

test.after(() => {
  if (savedFlag === undefined) delete process.env.PG_DUAL_WRITE;
  else process.env.PG_DUAL_WRITE = savedFlag;
});
