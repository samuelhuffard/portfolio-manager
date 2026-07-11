import { test } from "node:test";
import assert from "node:assert/strict";
import {
  InvestorLedgerEntrySchema,
  PositionSchema,
  NavSnapshotSchema,
  AccountSchema,
  CAPITAL_ENTRY_TYPES,
} from "../contracts/accounting.js";
import { buildInvestorLedgerEntry } from "../lib/investor-ledger.js";

test("InvestorLedgerEntrySchema accepts a real buildInvestorLedgerEntry output (parity)", () => {
  const entry = buildInvestorLedgerEntry(
    { date: "2026-07-11", email: "SAM@Example.com", name: "Sam", type: "contribution", amount: 1000, navPerUnit: 10, units: 100, investorId: "email:sam@example.com" },
    "test-secret"
  );
  assert.doesNotThrow(() => InvestorLedgerEntrySchema.parse(entry));
  assert.equal(entry.email, "sam@example.com"); // normalized
});

test("capital entry types are exactly contribution/withdrawal", () => {
  assert.deepEqual(CAPITAL_ENTRY_TYPES, ["contribution", "withdrawal"]);
});

test("InvestorLedgerEntrySchema rejects an unknown entry type", () => {
  const bad = buildInvestorLedgerEntry(
    { date: "2026-07-11", email: "a@b.com", name: "x", type: "dividend", amount: 5, navPerUnit: 10, units: 0.5, investorId: "email:a@b.com" },
    "s"
  );
  assert.throws(() => InvestorLedgerEntrySchema.parse(bad));
});

test("PositionSchema keeps a null marketValue representable (missing-quote rule)", () => {
  assert.doesNotThrow(() =>
    PositionSchema.parse({ ticker: "NVDA", shares: 10, avgCost: 100, costBasis: 1000, marketValue: null })
  );
  assert.throws(() => PositionSchema.parse({ ticker: "NVDA", shares: -1, avgCost: 100, costBasis: 1000, marketValue: 1300 }));
});

test("NavSnapshot and Account parse a plausible fund state", () => {
  assert.doesNotThrow(() =>
    NavSnapshotSchema.parse({ date: "2026-07-11", totalValue: 12000, cash: 2000, unitsOutstanding: 1200, navPerUnit: 10 })
  );
  assert.doesNotThrow(() =>
    AccountSchema.parse({ cash: 2000, totalValue: 12000, unitsOutstanding: 1200, navPerUnit: 10, updatedAt: "2026-07-11T00:00:00Z" })
  );
});
