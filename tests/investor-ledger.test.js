import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assertInvestorLedgerEntries,
  buildInvestorLedgerEntry,
  calculateInvestorLedgerEntry,
  computeInvestorLedgerHmac,
  defaultInvestorId,
  parseInvestorLedgerRow,
} from "../lib/investor-ledger.js";

const secret = "test-secret";

test("ledger entries include stable investor id, entry id, and row HMAC", () => {
  const entry = buildInvestorLedgerEntry(
    {
      date: "2026-06-18",
      email: "Investor@Example.com",
      name: "Investor",
      type: "Contribution",
      amount: 1000,
      navPerUnit: 1,
      units: 1000,
      investorId: "user_123",
      entryId: "entry_1",
    },
    secret
  );

  assert.equal(entry.email, "investor@example.com");
  assert.equal(entry.investorId, "user_123");
  assert.equal(entry.rowHmac, computeInvestorLedgerHmac(entry, secret));
});

test("money-path investor reads reject unsigned and modified rows", () => {
  const entry = buildInvestorLedgerEntry({
    date: "2026-07-10", email: "investor@example.com", name: "Investor", type: "Contribution",
    amount: 1000, navPerUnit: 1, units: 1000, investorId: "user_123", entryId: "entry_1",
  }, secret);
  assert.equal(assertInvestorLedgerEntries([entry], secret).length, 1);
  assert.throws(() => assertInvestorLedgerEntries([{ ...entry, rowHmac: null }], secret), /1 unsigned/);
  assert.throws(() => assertInvestorLedgerEntries([{ ...entry, amount: 999 }], secret), /1 mismatched/);
});

test("legacy ledger rows fall back to email-based investor ids", () => {
  const parsed = parseInvestorLedgerRow(["2026-06-18", "client@example.com", "Client", "Contribution", "500", "1", "500"]);
  assert.equal(parsed.investorId, defaultInvestorId("client@example.com"));
  assert.equal(parsed.rowHmac, null);
});

test("first non-owner entry is blocked if the agent already has value", () => {
  assert.throws(
    () =>
      calculateInvestorLedgerEntry({
        agentId: "agent-1",
        ledger: [],
        performanceHistory: [{ date: "2026-06-18", portfolioValue: 10000 }],
        email: "client@example.com",
        name: "Client",
        amount: 1000,
        secret,
      }),
    /true owner/
  );
});

test("existing investors must use a current or explicitly accepted NAV date", () => {
  const ledger = [
    buildInvestorLedgerEntry(
      {
        date: "2026-06-18",
        email: "owner@example.com",
        name: "Owner",
        type: "Contribution",
        amount: 1000,
        navPerUnit: 1,
        units: 1000,
        investorId: "user_owner",
        entryId: "entry_1",
      },
      secret
    ),
  ];

  assert.throws(
    () =>
      calculateInvestorLedgerEntry({
        agentId: "agent-1",
        ledger,
        performanceHistory: [{ date: "2026-06-17", portfolioValue: 1100, navPerUnit: 1.1 }],
        email: "client@example.com",
        name: "Client",
        amount: 100,
        now: new Date("2026-06-18T16:00:00-04:00"),
        secret,
      }),
    /Latest NAV is dated 2026-06-17/
  );

  const accepted = calculateInvestorLedgerEntry({
    agentId: "agent-1",
    ledger,
    performanceHistory: [{ date: "2026-06-17", portfolioValue: 1100, navPerUnit: 1.1 }],
    email: "client@example.com",
    name: "Client",
    amount: 110,
    navDate: "2026-06-17",
    now: new Date("2026-06-18T16:00:00-04:00"),
    secret,
  });

  assert.equal(accepted.entry.units, 100);
});

test("existing-capital attribution uses contribution-basis NAV instead of inflated market NAV", () => {
  const ledger = [
    buildInvestorLedgerEntry(
      {
        date: "2026-07-07",
        email: "owner@example.com",
        name: "Owner",
        type: "Contribution",
        amount: 25,
        navPerUnit: 1,
        units: 25,
        investorId: "user_owner",
        entryId: "entry_owner",
      },
      secret
    ),
  ];

  const result = calculateInvestorLedgerEntry({
    agentId: "agent-1",
    ledger,
    performanceHistory: [{ date: "2026-07-07", portfolioValue: 74.55, navPerUnit: 2.9819 }],
    email: "client@example.com",
    name: "Client",
    amount: 25,
    isExistingCapitalAttribution: true,
    existingCapitalNavPerUnit: 1,
    now: new Date("2026-07-07T16:00:00-04:00"),
    secret,
  });

  assert.equal(result.entry.navPerUnit, 1);
  assert.equal(result.entry.units, 25);
  assert.equal(result.unitsOutstandingAfter, 50);
});

test("withdrawals cannot exceed the investor's units", () => {
  const ledger = [
    buildInvestorLedgerEntry(
      {
        date: "2026-06-18",
        email: "client@example.com",
        name: "Client",
        type: "Contribution",
        amount: 100,
        navPerUnit: 1,
        units: 100,
        investorId: "user_client",
        entryId: "entry_1",
      },
      secret
    ),
  ];

  assert.throws(
    () =>
      calculateInvestorLedgerEntry({
        agentId: "agent-1",
        ledger,
        performanceHistory: [{ date: "2026-06-18", portfolioValue: 100, navPerUnit: 1 }],
        email: "client@example.com",
        name: "Client",
        amount: 200,
        isWithdrawal: true,
        investorId: "user_client",
        now: new Date("2026-06-18T16:00:00-04:00"),
        secret,
      }),
    /cannot withdraw/
  );
});
