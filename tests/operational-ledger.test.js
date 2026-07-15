import test from "node:test";
import assert from "node:assert/strict";
import {
  assertOperationalLedgerEntries,
  assertPerformanceSourceRequestEntries,
  computePerformanceSourceRequestHmac,
  getOperationalLedgerVerificationSecrets,
  signOperationalLedgerEntry,
  verifyOperationalLedgerEntries,
} from "../lib/operational-ledger.js";
import { backfillOperationalLedgers } from "../scripts/backfill-operational-ledgers.js";

const SECRET = "test-operational-ledger-secret";

const performance = { date: "2026-07-10", portfolioValue: 1234.56, spyPrice: 650.1, unitsOutstanding: 1000, navPerUnit: 1.2346 };
const trade = { date: "2026-07-10", ticker: "AAPL", side: "BUY", shares: 2, price: 200, amount: 400, orderId: "ord-1", agentId: "agent-1", proposalId: "prop-1", realizedGain: null };
const lot = { lotId: "lot-1", ticker: "AAPL", openDate: "2026-07-10", agentId: "agent-1", costPerShare: 200, sharesOriginal: 2, sharesOpen: 2, status: "OPEN" };

test("operational ledger signatures verify and detect changed money state", () => {
  for (const [kind, entry] of [["performance", performance], ["trade", trade], ["lot", lot]]) {
    const signed = signOperationalLedgerEntry(kind, entry, SECRET);
    assert.equal(verifyOperationalLedgerEntries(kind, [signed], SECRET).verified, 1);
    const field = kind === "lot" ? "sharesOpen" : kind === "trade" ? "amount" : "portfolioValue";
    assert.equal(verifyOperationalLedgerEntries(kind, [{ ...signed, [field]: signed[field] + 1 }], SECRET).mismatched.length, 1);
  }
});

test("normal integrity assertion fails closed on unsigned rows", () => {
  assert.throws(() => assertOperationalLedgerEntries("performance", [performance], SECRET), /1 unsigned/);
});

test("test-artifact resolutions and legacy approval attestations are independently signed", () => {
  const resolution = signOperationalLedgerEntry("reconciliation_resolution", {
    orderId: "smoke-1", resolution: "legacy_smoke_quarantine", attestedBy: "sam", attestation: "production smoke only", createdAt: "2026-07-14T00:00:00.000Z",
  }, SECRET);
  const attestation = signOperationalLedgerEntry("legacy_approval_attestation", {
    proposalId: "proposal-1", ticker: "NVDA", side: "BUY", attestedBy: "sam", attestation: "routing test only", createdAt: "2026-07-14T00:00:00.000Z",
  }, SECRET);
  assert.equal(verifyOperationalLedgerEntries("reconciliation_resolution", [resolution], SECRET).verified, 1);
  assert.equal(verifyOperationalLedgerEntries("legacy_approval_attestation", [attestation], SECRET).verified, 1);
  assert.equal(verifyOperationalLedgerEntries("legacy_approval_attestation", [{ ...attestation, ticker: "AMD" }], SECRET).mismatched.length, 1);
});

test("a mutated lot requires a new signature", () => {
  const original = signOperationalLedgerEntry("lot", lot, SECRET);
  const consumed = { ...original, sharesOpen: 0, status: "CLOSED" };
  assert.equal(verifyOperationalLedgerEntries("lot", [consumed], SECRET).mismatched.length, 1);
  assert.equal(verifyOperationalLedgerEntries("lot", [signOperationalLedgerEntry("lot", consumed, SECRET)], SECRET).verified, 1);
});

test("performance source request ids are bound to signed money state", () => {
  const signed = signOperationalLedgerEntry("performance", performance, SECRET);
  const entry = {
    ...signed,
    sourceRequestId: "9f1c2b3a-1111-2222-3333-444455556666",
  };
  entry.sourceRequestHmac = computePerformanceSourceRequestHmac(entry, SECRET);
  assert.doesNotThrow(() => assertPerformanceSourceRequestEntries([entry], SECRET));
  assert.throws(() => assertPerformanceSourceRequestEntries([{ ...entry, sourceRequestId: "8f1c2b3a-1111-2222-3333-444455556666" }], SECRET), /source-request integrity/);
  assert.doesNotThrow(() => assertPerformanceSourceRequestEntries([signed], SECRET), "legacy performance rows remain valid");
});

function fakeSheets(tabs) {
  const updates = [];
  return {
    updates,
    spreadsheets: { values: {
      get: async ({ range }) => ({ data: { values: tabs[range.split("!")[0]] || [] } }),
      batchUpdate: async ({ requestBody }) => updates.push(...requestBody.data),
    } },
  };
}

test("backfill signs legacy rows and writes signature headers", async () => {
  const sheets = fakeSheets({
    Performance: [[performance.date, performance.portfolioValue, performance.spyPrice, performance.unitsOutstanding, performance.navPerUnit]],
    "Trade Ledger": [[trade.date, trade.ticker, trade.side, trade.shares, trade.price, trade.amount, trade.orderId, trade.agentId, trade.proposalId, ""]],
    Lots: [[lot.lotId, lot.ticker, lot.openDate, lot.agentId, lot.costPerShare, lot.sharesOriginal, lot.sharesOpen, lot.status]],
  });
  const summary = await backfillOperationalLedgers({ sheets, spreadsheetId: "sheet", secret: SECRET });
  assert.deepEqual(summary.Performance, { total: 1, alreadySigned: 0, backfilled: 1 });
  assert.equal(sheets.updates.length, 6);
  assert.deepEqual(sheets.updates.slice(0, 3).map((update) => update.range), ["Performance!F1", "Trade Ledger!K1", "Lots!I1"]);
});

test("backfill refuses to overwrite an existing invalid signature", async () => {
  const sheets = fakeSheets({
    Performance: [[performance.date, performance.portfolioValue, performance.spyPrice, performance.unitsOutstanding, performance.navPerUnit, "bad"]],
    "Trade Ledger": [],
    Lots: [],
  });
  await assert.rejects(() => backfillOperationalLedgers({ sheets, spreadsheetId: "sheet", secret: SECRET }), /refusing backfill/);
  assert.equal(sheets.updates.length, 0);
});

test("verification accepts rows signed with a configured fallback secret and signing stays primary", () => {
  const legacySecret = "legacy-investor-fallback-secret";
  const dedicatedSecret = "new-dedicated-operational-secret";
  const legacySigned = signOperationalLedgerEntry("performance", performance, legacySecret);
  const saved = {};
  const keys = ["OPERATIONAL_LEDGER_HMAC_SECRET", "OPERATIONAL_LEDGER_LEGACY_HMAC_SECRETS", "INVESTOR_LEDGER_HMAC_SECRET", "AUDIT_HMAC_SECRET"];
  for (const key of keys) saved[key] = process.env[key];
  try {
    process.env.OPERATIONAL_LEDGER_HMAC_SECRET = dedicatedSecret;
    process.env.INVESTOR_LEDGER_HMAC_SECRET = legacySecret;
    delete process.env.AUDIT_HMAC_SECRET;
    delete process.env.OPERATIONAL_LEDGER_LEGACY_HMAC_SECRETS;
    // A key needed by another subsystem is not automatically trusted for the
    // operational ledger after the dedicated-key cutover.
    assert.equal(verifyOperationalLedgerEntries("performance", [legacySigned], dedicatedSecret).mismatched.length, 1);
    process.env.OPERATIONAL_LEDGER_LEGACY_HMAC_SECRETS = legacySecret;
    // Historical row signed with the fallback still verifies under the new primary.
    assert.equal(verifyOperationalLedgerEntries("performance", [legacySigned], dedicatedSecret).verified, 1);
    assert.doesNotThrow(() => assertOperationalLedgerEntries("performance", [legacySigned], dedicatedSecret));
    // A row signed with a secret outside the configured chain still fails.
    const foreign = signOperationalLedgerEntry("performance", performance, "unconfigured-attacker-secret");
    assert.equal(verifyOperationalLedgerEntries("performance", [foreign], dedicatedSecret).mismatched.length, 1);
    // New signatures use the primary secret.
    const fresh = signOperationalLedgerEntry("performance", performance);
    assert.equal(verifyOperationalLedgerEntries("performance", [fresh], dedicatedSecret).verified, 1);
    delete process.env.OPERATIONAL_LEDGER_LEGACY_HMAC_SECRETS;
    assert.equal(verifyOperationalLedgerEntries("performance", [legacySigned], dedicatedSecret).mismatched.length, 1);
  } finally {
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
});

test("dedicated-key cutover trusts legacy keys only through the explicit migration list", () => {
  const shared = {
    INVESTOR_LEDGER_HMAC_SECRET: "investor-secret",
    AUDIT_HMAC_SECRET: "audit-secret",
  };
  assert.deepEqual(getOperationalLedgerVerificationSecrets(shared), ["investor-secret", "audit-secret"]);
  assert.deepEqual(getOperationalLedgerVerificationSecrets({
    ...shared,
    OPERATIONAL_LEDGER_HMAC_SECRET: "dedicated-secret",
  }), ["dedicated-secret"]);
  assert.deepEqual(getOperationalLedgerVerificationSecrets({
    ...shared,
    OPERATIONAL_LEDGER_HMAC_SECRET: "dedicated-secret",
    OPERATIONAL_LEDGER_LEGACY_HMAC_SECRETS: "old-one, old-two, old-one",
  }), ["dedicated-secret", "old-one", "old-two"]);
});
