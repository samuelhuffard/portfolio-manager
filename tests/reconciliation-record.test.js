import { test } from "node:test";
import assert from "node:assert/strict";
import { signOperationalLedgerEntry, verifyOperationalLedgerEntries, assertOperationalLedgerEntries } from "../lib/operational-ledger.js";

// The durable reconciliation record is signed with the operational-ledger HMAC
// (a new "reconciliation" kind) so it can't be forged and survives as tamper-
// evident state until repaired. This verifies the sign/verify round-trip and
// that a tampered field is caught.
const SECRET = "recon-secret";

test("a reconciliation record signs and verifies round-trip", () => {
  const entry = signOperationalLedgerEntry(
    "reconciliation",
    { orderId: "o1", proposalId: "p1", ticker: "NVDA", side: "SELL", shares: 6, reason: "lots not updated", createdAt: "2026-07-11T00:00:00Z" },
    SECRET
  );
  assert.ok(entry.rowHmac);
  const res = verifyOperationalLedgerEntries("reconciliation", [entry], SECRET);
  assert.equal(res.verified, 1);
  assert.equal(res.mismatched.length, 0);
  assert.doesNotThrow(() => assertOperationalLedgerEntries("reconciliation", [entry], SECRET));
});

test("a tampered reconciliation record fails verification", () => {
  const entry = signOperationalLedgerEntry(
    "reconciliation",
    { orderId: "o1", proposalId: "p1", ticker: "NVDA", side: "SELL", shares: 6, reason: "x", createdAt: "2026-07-11T00:00:00Z" },
    SECRET
  );
  const res = verifyOperationalLedgerEntries("reconciliation", [{ ...entry, shares: 9999 }], SECRET);
  assert.equal(res.mismatched.length, 1);
  assert.throws(() => assertOperationalLedgerEntries("reconciliation", [{ ...entry, shares: 9999 }], SECRET));
});
