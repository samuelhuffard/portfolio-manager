import test from "node:test";
import assert from "node:assert/strict";
import { buildInvestorLedgerEntry } from "../lib/investor-ledger.js";
import { prepareSignedWithdrawalLedgerEntry, withdrawalCommitAlreadyRecorded } from "../lib/withdrawal-pricing.js";

const secret = "withdrawal-pricing-test-secret";

test("withdrawal preview NAV and committed units use the same latest signed close", () => {
  const ledger = [buildInvestorLedgerEntry({
    date: "2026-09-09", email: "investor@example.com", name: "Investor", type: "Contribution",
    amount: 100, navPerUnit: 1, units: 100, investorId: "user_investor", entryId: "seed",
  }, secret)];
  const performanceHistory = [
    { date: "2026-09-10", sourceInvocationId: "2026-09-10/16:30", portfolioValue: 110, unitsOutstanding: 100, navPerUnit: 1.1 },
    { date: "2026-09-11", sourceInvocationId: "2026-09-11/15:00", portfolioValue: 120, unitsOutstanding: 100, navPerUnit: 1.2 },
  ];

  const { navSnapshot, entryResult } = prepareSignedWithdrawalLedgerEntry({
    ledger, performanceHistory, email: "investor@example.com", name: "Investor", amount: 55,
    investorId: "user_investor", entryId: "withdrawal-idempotency-key-20260910", secret,
  });

  assert.equal(navSnapshot.date, "2026-09-10");
  assert.equal(entryResult.entry.navPerUnit, navSnapshot.navPerUnit);
  assert.equal(entryResult.entry.units, -50);
  assert.equal(entryResult.entry.entryId, "withdrawal-idempotency-key-20260910");
});

test("a repeated withdrawal idempotency key is recognized before any further ledger writes", () => {
  const entryId = "withdrawal-idempotency-key-20260910";
  const existing = [{ entryId }];
  assert.equal(withdrawalCommitAlreadyRecorded(existing, entryId), true);
  assert.equal(withdrawalCommitAlreadyRecorded(existing, "another-immutable-key"), false);
  // Rows parsed from the sheet carry entryId: null when the column is blank, and
  // an unreadable ledger must never read as "already recorded".
  assert.equal(withdrawalCommitAlreadyRecorded([{ entryId: null }], undefined), false);
  assert.equal(withdrawalCommitAlreadyRecorded([{ entryId: null }], null), false);
  assert.equal(withdrawalCommitAlreadyRecorded(null, entryId), false);
});

test("the unit ceiling is enforced against the ledger supplied at commit time", () => {
  const performanceHistory = [
    { date: "2026-09-10", sourceInvocationId: "2026-09-10/16:30", portfolioValue: 110, unitsOutstanding: 100, navPerUnit: 1.1 },
  ];
  const entry = (units, entryId) => buildInvestorLedgerEntry({
    date: "2026-09-09", email: "investor@example.com", name: "Investor",
    type: units > 0 ? "Contribution" : "Withdrawal", amount: Math.abs(units), navPerUnit: 1,
    units, investorId: "user_investor", entryId,
  }, secret);
  const withdraw = (ledger) => prepareSignedWithdrawalLedgerEntry({
    ledger, performanceHistory, email: "investor@example.com", name: "Investor", amount: 55,
    investorId: "user_investor", entryId: "withdrawal-idempotency-key-20260910", secret,
  });

  // Priced off a stale pre-lock ledger this passes; against the ledger actually
  // being appended to — after a concurrent withdrawal — it must fail closed.
  assert.equal(withdraw([entry(100, "seed")]).entryResult.entry.units, -50);
  assert.throws(
    () => withdraw([entry(100, "seed"), entry(-60, "concurrent")]),
    /only holds/,
  );
});

test("a withdrawal pricing snapshot that disagrees with the signed close is refused", () => {
  const performanceHistory = [
    { date: "2026-09-10", sourceInvocationId: "2026-09-10/16:30", portfolioValue: 110, unitsOutstanding: 100, navPerUnit: 1.1 },
  ];
  const ledger = [buildInvestorLedgerEntry({
    date: "2026-09-09", email: "investor@example.com", name: "Investor", type: "Contribution",
    amount: 100, navPerUnit: 1, units: 100, investorId: "user_investor", entryId: "seed",
  }, secret)];

  assert.throws(() => prepareSignedWithdrawalLedgerEntry({
    ledger, performanceHistory, email: "investor@example.com", name: "Investor", amount: 55,
    investorId: "user_investor", entryId: "withdrawal-idempotency-key-20260910", secret,
    navSnapshot: { sourceInvocationId: "2026-09-11/15:00", navPerUnit: 1.2 },
  }), /does not match the latest signed 16:30 ET close/);
});
