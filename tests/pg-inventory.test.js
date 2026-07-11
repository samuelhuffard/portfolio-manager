import { test } from "node:test";
import assert from "node:assert/strict";
import { buildInventory, LOT_INVENTORY, POSITION_INVENTORY, PROPOSAL_INVENTORY } from "../lib/pg/inventory.js";

test("proposal inventory is order-independent but detects lifecycle changes", () => {
  const pending = { id: "p1", status: "Pending", updatedAt: "2026-07-11T00:00:00.000Z" };
  const other = { id: "p2", status: "Rejected", updatedAt: "2026-07-11T00:01:00.000Z" };
  const first = buildInventory([pending, other], PROPOSAL_INVENTORY);
  const reordered = buildInventory([other, pending], PROPOSAL_INVENTORY);
  const decided = buildInventory([{ ...pending, status: "Rejected" }, other], PROPOSAL_INVENTORY);
  assert.deepEqual(first, reordered);
  assert.equal(first.count, 2);
  assert.notEqual(first.digest, decided.digest);
});

test("proposal inventory detects a pending proposal edit with unchanged lifecycle", () => {
  const original = [{
    id: "p1", agentId: "agent-1", ticker: "NVDA", side: "BUY", amountDollars: 100,
    maxPrice: null, rationale: "Original rationale", riskSummary: "Original risk", status: "Pending",
    decidedAt: null, decidedByUserId: null, decisionNote: null, decisionHmac: null,
    fulfilledAt: null, fulfilledOrderId: null, fulfilledShares: null, updatedAt: "2026-07-11T12:00:00Z",
  }];
  const edited = [{ ...original[0], amountDollars: 125, rationale: "Edited rationale" }];
  assert.notEqual(
    buildInventory(original, PROPOSAL_INVENTORY).digest,
    buildInventory(edited, PROPOSAL_INVENTORY).digest,
  );
});

test("lot inventory detects a closed/share mutation even when row count is unchanged", () => {
  const open = { lotId: "lot-1", ticker: "NVDA", agentId: "agent-1", openDate: "2026-07-11", costPerShare: 100, sharesOriginal: 2, sharesOpen: 2, status: "OPEN" };
  const before = buildInventory([open], LOT_INVENTORY);
  const after = buildInventory([{ ...open, sharesOpen: 0, status: "CLOSED" }], LOT_INVENTORY);
  assert.equal(before.count, after.count);
  assert.notEqual(before.digest, after.digest);
});

test("position inventory normalizes Postgres numeric strings", () => {
  const sheet = buildInventory([
    { ticker: "NVDA", name: "Nvidia", shares: 2, avgCost: 100, costBasis: 200, marketValue: null },
  ], POSITION_INVENTORY);
  const postgres = buildInventory([
    { ticker: "NVDA", name: "Nvidia", shares: "2.0000", avgCost: "100.0000", costBasis: "200.00", marketValue: null },
  ], POSITION_INVENTORY);
  assert.deepEqual(sheet, postgres);
});
