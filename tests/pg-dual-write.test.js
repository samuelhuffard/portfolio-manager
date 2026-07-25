import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dualWriteEnabled,
  runShadowOperation,
  shadowWriteProposal,
  shadowWriteLot,
  shadowWriteCapitalEntry,
  shadowWriteNavSnapshot,
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
  for (const fn of [shadowWriteProposal, shadowWriteLot, shadowWriteCapitalEntry, shadowWriteNavSnapshot, shadowWritePosition, shadowReplacePositions]) {
    const res = await fn({ total: "garbage", not: "a real object" });
    assert.deepEqual(res, { ok: false, skipped: true });
  }
});

test("NAV shadow write validates and inserts a complete accounting snapshot", async () => {
  const calls = [];
  const result = await shadowWriteNavSnapshot({
    date: "2026-07-14",
    totalValue: 125.37,
    cash: 110,
    unitsOutstanding: 100,
    navPerUnit: 1.2537,
  }, { enabled: true, pool: { query: async (...args) => calls.push(args) } });
  assert.deepEqual(result, { ok: true });
  assert.equal(calls.length, 1);
  assert.match(calls[0][0], /INSERT INTO nav_snapshots/);
  assert.deepEqual(calls[0][1], ["2026-07-14", 125.37, 110, 100, 1.2537]);
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

test("proposal shadow upsert carries a current approval lifecycle into the shadow", async () => {
  const calls = [];
  const proposal = {
    id: "proposal-approval-state",
    agentId: "agent-3",
    ticker: "GS",
    side: "BUY",
    amountDollars: 6.05,
    maxPrice: null,
    rationale: "Evidence-backed test rationale.",
    riskSummary: "Test risk summary.",
    status: "ApprovedForBrokerReview",
    createdAt: "2026-07-24T15:00:00.000Z",
    updatedAt: "2026-07-24T15:05:00.000Z",
    expiresAt: "2026-07-26T15:00:00.000Z",
    createdByUserId: "generator",
    createdByEmail: null,
    decidedAt: "2026-07-24T15:05:00.000Z",
    decidedByUserId: "fund-manager",
    decisionNote: "Approved after review.",
    decisionHmac: "signed-decision",
    fulfilledAt: null,
    fulfilledOrderId: null,
    fulfilledShares: null,
  };
  const result = await shadowWriteProposal(proposal, {
    enabled: true,
    pool: { query: async (...args) => calls.push(args) },
  });
  assert.deepEqual(result, { ok: true });
  assert.equal(calls.length, 1);
  assert.match(calls[0][0], /ON CONFLICT \(id\) DO UPDATE SET/);
  assert.match(calls[0][0], /decision_hmac = EXCLUDED.decision_hmac/);
  assert.equal(calls[0][1][8], "ApprovedForBrokerReview");
  assert.equal(calls[0][1][14], "2026-07-24T15:05:00.000Z");
  assert.equal(calls[0][1][17], "signed-decision");
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

test("position refresh stores one quote provenance identity with every valuation row", async () => {
  const calls = [];
  const client = { async query(...args) { calls.push(args); }, release() {} };
  const result = await shadowReplacePositions([
    { ticker: "NVDA", shares: 1, avgCost: 100, costBasis: 100, marketValue: 110 },
  ], {
    enabled: true,
    pool: { connect: async () => client },
    valuation: {
      quoteSnapshotVersion: "yahoo-quote-set-v1:abc",
      quoteSource: "yahoo-finance2:quote",
      quoteTimestamp: "2026-07-14T19:59:58.000Z",
    },
  });
  assert.deepEqual(result, { ok: true });
  const insert = calls.find(([sql]) => String(sql).includes("INSERT INTO positions"));
  assert.equal(insert[1][6], "yahoo-quote-set-v1:abc");
  assert.equal(insert[1][7], "yahoo-finance2:quote");
  assert.equal(insert[1][8].toISOString(), "2026-07-14T19:59:58.000Z");
});

test.after(() => {
  if (savedFlag === undefined) delete process.env.PG_DUAL_WRITE;
  else process.env.PG_DUAL_WRITE = savedFlag;
});
