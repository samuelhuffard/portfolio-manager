import { test } from "node:test";
import assert from "node:assert/strict";
import { buildInvestorLedgerEntry, parseInvestorLedgerRow, investorLedgerRow } from "../lib/investor-ledger.js";
import { verifyInvestorLedger, verifyAuditRows, computeAuditRowHmac } from "../lib/ledger-verify.js";

const SECRET = "verify-test-secret";

function signedEntry(overrides = {}) {
  return buildInvestorLedgerEntry(
    {
      date: "2026-07-02",
      email: "friend@example.com",
      name: "Friend",
      type: "contribution",
      amount: 50,
      navPerUnit: 1.0,
      units: 50,
      ...overrides,
    },
    SECRET
  );
}

test("a signed entry survives the Sheet round-trip and verifies", () => {
  const entry = signedEntry();
  // Simulate write → Sheet → read: serialize to a row, parse it back.
  const roundTripped = parseInvestorLedgerRow(investorLedgerRow(entry).map((v) => (v == null ? "" : String(v))));
  const result = verifyInvestorLedger([roundTripped], SECRET);
  assert.equal(result.verified, 1);
  assert.equal(result.mismatched.length, 0);
});

test("an in-place edit to a signed row is detected as tampering", () => {
  const entry = signedEntry();
  const tamperedAmount = { ...entry, amount: 5000 }; // someone gave themselves money
  const tamperedUnits = { ...entry, units: 500 };
  const result = verifyInvestorLedger([entry, tamperedAmount, tamperedUnits], SECRET);
  assert.equal(result.verified, 1);
  assert.equal(result.mismatched.length, 2);
});

test("unsigned rows are reported separately, not failed", () => {
  const result = verifyInvestorLedger([{ ...signedEntry(), rowHmac: null }], SECRET);
  assert.equal(result.unsigned.length, 1);
  assert.equal(result.mismatched.length, 0);
});

test("audit rows verify and detect tampering (mirrors dashboard lib/audit.ts format)", () => {
  const event = {
    timestamp: "2026-07-02T18:00:00.000Z",
    userId: "user_sam",
    role: "FundManager",
    action: "APPROVAL_DECISION",
    route: "/api/proposals/abc",
    metadata: { b: 2, a: 1 }, // key order must not matter (sortedJson)
  };
  const row = { ...event, rowHmac: computeAuditRowHmac(event, SECRET) };
  const reordered = { ...row, metadata: { a: 1, b: 2 } };

  const clean = verifyAuditRows([row, reordered], SECRET, { computeHmac: computeAuditRowHmac });
  assert.equal(clean.verified, 2);

  const tampered = verifyAuditRows([{ ...row, action: "PORTFOLIO_READ" }], SECRET, { computeHmac: computeAuditRowHmac });
  assert.equal(tampered.mismatched.length, 1);
});
