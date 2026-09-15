import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assertInvestorLedgerEntries,
  buildInvestorLedgerEntry,
  calculateInvestorLedgerEntry,
  computeUnattributedCapital,
  computeInvestorLedgerHmac,
  defaultInvestorId,
  investorLedgerEntryHmacMatches,
  parseInvestorLedgerRow,
} from "../lib/investor-ledger.js";

const secret = "test-secret";

test("the withdrawal ceiling is checked against the rounded units actually persisted", () => {
  // Holds 1.00006 units; the raw quotient equals that exactly, but the row
  // stores round4 => 1.0001, which would burn more than the investor owns.
  const ledger = [buildInvestorLedgerEntry({
    date: "2026-09-01", email: "client@example.com", name: "Client", type: "Contribution",
    amount: 10000.6, navPerUnit: 10000, units: 1.00006, investorId: "user_client", entryId: "seed",
  }, secret)];

  assert.throws(() => calculateInvestorLedgerEntry({
    agentId: "agent-1", ledger, performanceHistory: [], email: "client@example.com", name: "Client",
    amount: 10000.6, isWithdrawal: true, investorId: "user_client", pricingNavPerUnit: 10000, secret,
  }), /cannot withdraw/);

  // A withdrawal that rounds within the holding still succeeds, and never burns
  // more than the ceiling check approved.
  const ok = calculateInvestorLedgerEntry({
    agentId: "agent-1", ledger, performanceHistory: [], email: "client@example.com", name: "Client",
    amount: 10000, isWithdrawal: true, investorId: "user_client", pricingNavPerUnit: 10000, secret,
  });
  assert.equal(ok.entry.units, -1);
  assert.ok(Math.abs(ok.entry.units) <= 1.00006);
});

test("a single investor entry's signature can be verified independently of the ledger read", () => {
  const entry = buildInvestorLedgerEntry({
    date: "2026-09-16", email: "client@example.com", name: "Client", type: "Withdrawal",
    amount: 50, navPerUnit: 1, units: -50, investorId: "user_client", entryId: "op-key",
  }, secret);

  assert.equal(investorLedgerEntryHmacMatches(entry, secret), true);
  // A plan signed with a different key must not smuggle in an investor entry.
  assert.equal(investorLedgerEntryHmacMatches(entry, "operational-ledger-secret"), false);
  assert.equal(investorLedgerEntryHmacMatches({ ...entry, units: -60 }, secret), false);
  assert.equal(investorLedgerEntryHmacMatches({ ...entry, rowHmac: null }, secret), false);
  assert.equal(investorLedgerEntryHmacMatches({ ...entry, rowHmac: "" }, secret), false);
  assert.equal(investorLedgerEntryHmacMatches(undefined, secret), false);
});

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

test("existing investors require an explicit signed pricing NAV", () => {
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
    /require an explicit signed pricing NAV/
  );

  const accepted = calculateInvestorLedgerEntry({
    agentId: "agent-1",
    ledger,
    performanceHistory: [{ date: "2026-06-17", portfolioValue: 1100, navPerUnit: 1.1 }],
    email: "client@example.com",
    name: "Client",
    amount: 110,
    pricingNavPerUnit: 1.1,
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

test("unmatched broker capital uses cash plus cost basis and excludes market gains", () => {
  const ledger = [{ type: "Contribution", amount: 25 }, { type: "Withdrawal", amount: 5 }];
  const unmatched = computeUnattributedCapital(
    [{ costBasis: 20, marketValue: 80 }],
    25,
    ledger
  );
  assert.deepEqual(unmatched, { amount: 25, capitalIn: 45, netContributions: 20, detected: true });
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
        pricingNavPerUnit: 1,
        secret,
      }),
    /cannot withdraw/
  );
});
