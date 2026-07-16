import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyCapitalEntryHmacMigration,
  planCapitalEntryHmacMigration,
  summarizeCapitalEntryHmacPlan,
} from "../lib/pg/capital-hmac-migration.js";

const oldHmac = "a".repeat(64);
const newHmac = "b".repeat(64);
const entry = {
  entryId: "capital-1",
  date: "2026-07-15",
  email: "sam@example.com",
  name: "Sam",
  type: "contribution",
  amount: 85,
  navPerUnit: 1,
  units: 85,
  investorId: "investor-1",
  rowHmac: newHmac,
};

test("plans a signature-only migration when every signed payload field matches", () => {
  const plan = planCapitalEntryHmacMigration(
    [entry],
    [{ ...entry, amount: "85.00", navPerUnit: "1.000000", units: "85.000000", rowHmac: oldHmac }],
  );
  assert.deepEqual(summarizeCapitalEntryHmacPlan(plan), {
    authoritativeCount: 1,
    shadowCount: 1,
    updateCount: 1,
    safeToApply: true,
    blockerCounts: {
      missingFromAuthoritative: 0,
      missingFromShadow: 0,
      payloadMismatches: 0,
      invalidAuthoritativeHmacs: 0,
    },
  });
});

test("refuses migration when any non-signature field differs", () => {
  const plan = planCapitalEntryHmacMigration([entry], [{ ...entry, amount: 84, rowHmac: oldHmac }]);
  assert.equal(plan.safeToApply, false);
  assert.equal(plan.updateCount, 0);
  assert.deepEqual(plan.blockers.payloadMismatches, [{ entryId: "capital-1", fields: ["amount"] }]);
});

test("refuses migration for missing, duplicate, or invalid authoritative rows", () => {
  assert.equal(planCapitalEntryHmacMigration([entry], []).safeToApply, false);
  assert.equal(planCapitalEntryHmacMigration([], [{ ...entry, rowHmac: oldHmac }]).safeToApply, false);
  assert.equal(planCapitalEntryHmacMigration([{ ...entry, rowHmac: "invalid" }], [{ ...entry, rowHmac: oldHmac }]).safeToApply, false);
  assert.throws(() => planCapitalEntryHmacMigration([entry, entry], []), /duplicate capital entry IDs/);
});

test("updates only row_hmac through one compare-and-swap transaction", async () => {
  const plan = planCapitalEntryHmacMigration([entry], [{ ...entry, rowHmac: oldHmac }]);
  const calls = [];
  const result = await applyCapitalEntryHmacMigration(plan, {
    transaction: async (fn) => fn({
      async query(sql, params) {
        calls.push({ sql, params });
        return { rowCount: 1 };
      },
    }),
  });
  assert.equal(result.updated, 1);
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /^UPDATE capital_entries/);
  assert.doesNotMatch(calls[0].sql, /amount\s*=/);
  assert.deepEqual(calls[0].params, [newHmac, "capital-1", oldHmac]);
});

test("compare-and-swap failure aborts the migration", async () => {
  const plan = planCapitalEntryHmacMigration([entry], [{ ...entry, rowHmac: oldHmac }]);
  await assert.rejects(
    applyCapitalEntryHmacMigration(plan, {
      transaction: async (fn) => fn({ query: async () => ({ rowCount: 0 }) }),
    }),
    /shadow state changed during migration/,
  );
});
