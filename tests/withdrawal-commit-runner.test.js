import test from "node:test";
import assert from "node:assert/strict";
import { buildInvestorLedgerEntry } from "../lib/investor-ledger.js";
import { signOperationalLedgerEntry } from "../lib/operational-ledger.js";
import { runWithdrawalCommit } from "../lib/withdrawal-commit-runner.js";

// Fault injection across every write boundary of the withdrawal commit.
//
// The property under test is NOT "each helper is correct" — that is covered in
// withdrawal-commit.test.js. It is the ordering guarantee: a failure at ANY
// boundary must leave money state that a same-key re-run can finish, without
// duplicating a trade row, double-consuming a lot, or double-burning units.
//
// Both HMAC keys are the same string here so the default env-backed secret
// resolution works; the runner still verifies the investor entry explicitly.
const SECRET = "withdrawal-runner-test-secret";
process.env.OPERATIONAL_LEDGER_HMAC_SECRET = SECRET;
process.env.INVESTOR_LEDGER_HMAC_SECRET = SECRET;

const KEY = "withdrawal-runner-key-20260916";
const EMAIL = "investor@example.com";
const INVESTOR_ID = "user_investor";
const NAV = { date: "2026-09-15", sourceInvocationId: "2026-09-15/16:30", portfolioValue: 200, unitsOutstanding: 200, navPerUnit: 1 };

/** A mutable in-memory stand-in for the four Sheet surfaces this touches. */
function makeWorld() {
  return {
    investors: [buildInvestorLedgerEntry({
      date: "2026-09-01", email: EMAIL, name: "Investor", type: "Contribution",
      amount: 200, navPerUnit: 1, units: 200, investorId: INVESTOR_ID, entryId: "seed",
    }, SECRET)],
    performance: [NAV],
    lots: [
      { rowIndex: 0, lotId: "lot-a", ticker: "ABC", openDate: "2025-01-01", agentId: "agent-1", costPerShare: 5, sharesOriginal: 10, sharesOpen: 10, status: "OPEN", rowHmac: "a" },
    ],
    operations: [],
    // A pre-existing unsigned Trade Ledger row from before rows were signed.
    // It is unrelated to this key and must never block the operation — the
    // runner reads the ledger unverified and signature-checks only keyed rows.
    trades: [{
      date: "2025-03-02", ticker: "OLD", side: "SELL", shares: 1, price: 9, amount: 9,
      orderId: null, agentId: "legacy", proposalId: null, realizedGain: 1, rowHmac: null,
    }],
    shadow: [],
  };
}

/** Wraps a world as an io object, optionally throwing at one named boundary. */
function makeIo(world, { failAt = null, hardFailAt = null, duplicateAt = null } = {}) {
  const guard = async (name, effect) => {
    // Three distinct real-world faults:
    //  hardFailAt  — the write genuinely did NOT land.
    //  failAt      — the write LANDS, then the call reports failure (lost response).
    //  duplicateAt — the transport retried a successful append, so it landed TWICE.
    if (hardFailAt === name) throw new Error(`injected failure at ${name}`);
    if (duplicateAt === name) effect();
    effect();
    if (failAt === name) throw new Error(`injected failure at ${name}`);
  };
  return {
    readInvestorLedger: async () => structuredClone(world.investors),
    readPerformanceHistory: async () => structuredClone(world.performance),
    readAllLots: async () => structuredClone(world.lots),
    readWithdrawalOperations: async () => structuredClone(world.operations),
    readTradeLedger: async () => structuredClone(world.trades),
    appendWithdrawalOperation: (op) => guard("plan", () => world.operations.push(structuredClone(op))),
    appendTradeLedgerEntries: (trades) => guard("trades", () => {
      for (const t of trades) world.trades.push(signOperationalLedgerEntry("trade", structuredClone(t), SECRET));
    }),
    applyLotUpdatesToSheet: (updates) => guard("lots", () => {
      for (const u of updates) {
        const lot = world.lots.find((l) => l.lotId === u.lotId);
        Object.assign(lot, { sharesOpen: u.sharesOpen, status: u.status });
      }
    }),
    appendInvestorLedgerEntry: (entry) => guard("investors", () => world.investors.push(structuredClone(entry))),
    shadowWriteCapitalEntry: (entry) => guard("shadow", () => world.shadow.push(structuredClone(entry))),
  };
}

const commit = (io) => runWithdrawalCommit({
  io,
  idempotencyKey: KEY,
  email: EMAIL,
  investorId: INVESTOR_ID,
  requestedAmount: 50,
  sales: [{ ticker: "ABC", shares: 5, price: 12 }],
  previewRealizedGain: 35,
  navSnapshot: NAV,
  secret: SECRET,
  tradeDate: "2026-09-16",
  now: () => "2026-09-16T20:00:00.000Z",
});

function assertSettledExactlyOnce(world, { expectedPlanRows = 1 } = {}) {
  assert.equal(world.operations.length, expectedPlanRows, "plan rows");
  assert.equal(world.operations.filter((o) => o.operationId === KEY).length, expectedPlanRows, "keyed plan rows");
  assert.equal(world.trades.filter((t) => t.proposalId === null).length, 1, "the legacy unsigned row must be left alone");
  assert.equal(world.investors.filter((e) => e.entryId === KEY).length, 1, "exactly one investor row");
  assert.equal(world.trades.filter((t) => t.proposalId === KEY).length, 1, "exactly one keyed trade row");
  assert.equal(world.lots.find((l) => l.lotId === "lot-a").sharesOpen, 5, "lot consumed exactly once");
  assert.equal(world.investors.reduce((sum, e) => sum + e.units, 0), 150, "units burned exactly once");
}

test("a clean commit writes the plan first, then trades, lots, and the investor row", async () => {
  const world = makeWorld();
  const result = await commit(makeIo(world));
  assert.equal(result.alreadyRecorded, false);
  assert.equal(result.replayed, false);
  assert.equal(result.overdrawWarning, null);
  assertSettledExactlyOnce(world);
});

test("a failure at any write boundary is repaired by a same-key re-run, exactly once", async () => {
  for (const boundary of ["plan", "trades", "lots", "investors", "shadow"]) {
    const world = makeWorld();
    await assert.rejects(commit(makeIo(world, { hardFailAt: boundary })), /injected failure/, `${boundary}: first attempt must surface the error`);
    await commit(makeIo(world)); // retry, same key
    assertSettledExactlyOnce(world);
  }
});

test("a write that landed despite reporting failure is not applied twice on retry", async () => {
  for (const boundary of ["plan", "trades", "lots", "investors"]) {
    const world = makeWorld();
    await assert.rejects(commit(makeIo(world, { failAt: boundary })), /injected failure/);
    await commit(makeIo(world)); // retry sees the landed write and completes around it
    assertSettledExactlyOnce(world);
  }
});

test("an append the transport duplicated is detected and fails closed, never accepted", async () => {
  // Investors and Trade Ledger duplicates are real money-state corruption: both
  // rows verify, so nothing else in the system would ever notice them.
  for (const [boundary, pattern] of [["trades", /refusing automatic repair/], ["investors", /refusing automatic repair/]]) {
    const world = makeWorld();
    await assert.rejects(commit(makeIo(world, { failAt: boundary, duplicateAt: boundary })), /injected failure/);
    await assert.rejects(commit(makeIo(world)), pattern, `${boundary}: duplicate must fail closed`);
  }

  // A duplicated plan row is byte-identical and therefore the same immutable
  // plan — safe to replay rather than bricking the key. A duplicated lot write
  // is an absolute value applied twice, which is idempotent.
  for (const boundary of ["plan", "lots"]) {
    const world = makeWorld();
    await assert.rejects(commit(makeIo(world, { failAt: boundary, duplicateAt: boundary })), /injected failure/);
    await commit(makeIo(world));
    // Two byte-identical plan rows are the same immutable plan, so the money
    // state must still settle exactly once even though the row is duplicated.
    assertSettledExactlyOnce(world, { expectedPlanRows: boundary === "plan" ? 2 : 1 });
  }
});

test("a completed operation replays as a no-op rather than re-burning units", async () => {
  const world = makeWorld();
  await commit(makeIo(world));
  const second = await commit(makeIo(world));
  assert.equal(second.alreadyRecorded, true);
  assertSettledExactlyOnce(world);
});

test("reusing the key for a different request is refused before anything is written", async () => {
  const world = makeWorld();
  await assert.rejects(commit(makeIo(world, { hardFailAt: "investors" })), /injected failure/);
  const before = structuredClone(world);
  await assert.rejects(runWithdrawalCommit({
    io: makeIo(world), idempotencyKey: KEY, email: EMAIL, investorId: INVESTOR_ID,
    requestedAmount: 75, // changed amount
    sales: [{ ticker: "ABC", shares: 5, price: 12 }],
    previewRealizedGain: 35, navSnapshot: NAV, secret: SECRET, tradeDate: "2026-09-16",
  }), /already bound to a different request/);
  assert.deepEqual(world.investors, before.investors);
  assert.deepEqual(world.trades, before.trades);
});

test("a replay overdrawn by a concurrent capital entry completes but reports it", async () => {
  const world = makeWorld();
  await assert.rejects(commit(makeIo(world, { hardFailAt: "investors" })), /injected failure/);
  // Another withdrawal drains the investor between the failure and the retry.
  world.investors.push(buildInvestorLedgerEntry({
    date: "2026-09-16", email: EMAIL, name: "Investor", type: "Withdrawal",
    amount: 190, navPerUnit: 1, units: -190, investorId: INVESTOR_ID, entryId: "concurrent",
  }, SECRET));

  const result = await commit(makeIo(world));
  assert.equal(result.alreadyRecorded, false);
  assert.ok(result.overdrawWarning, "overdraw must be surfaced, not silent");
  assert.equal(result.overdrawWarning.overdrawn, true);
  assert.ok(result.overdrawWarning.projectedUnits < 0);
  // It still completes: its lots and trade rows were already committed.
  assert.equal(world.investors.filter((e) => e.entryId === KEY).length, 1);
});

test("a tampered plan cannot smuggle an unsigned investor entry into the ledger", async () => {
  const world = makeWorld();
  await assert.rejects(commit(makeIo(world, { hardFailAt: "trades" })), /injected failure/);
  const plan = JSON.parse(world.operations[0].planJson);
  plan.entry = { ...plan.entry, units: -190, amount: 190 }; // rowHmac no longer matches
  world.operations[0].planJson = JSON.stringify(plan);

  await assert.rejects(commit(makeIo(world)), /not validly signed with the investor-ledger key/);
  assert.equal(world.investors.filter((e) => e.entryId === KEY).length, 0, "nothing appended");
});

test("lots altered outside the plan block repair instead of being overwritten", async () => {
  const world = makeWorld();
  await assert.rejects(commit(makeIo(world, { hardFailAt: "investors" })), /injected failure/);
  world.lots.find((l) => l.lotId === "lot-a").sharesOpen = 7; // neither before nor after
  await assert.rejects(commit(makeIo(world)), /no longer matches its signed plan/);
});
