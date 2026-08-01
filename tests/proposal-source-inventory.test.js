import test from "node:test";
import assert from "node:assert/strict";
import {
  PROPOSAL_SOURCE_INVENTORY,
  PROPOSAL_SOURCE_INVENTORY_VERSION,
  verifyProposalSourceInventory,
} from "../lib/proposal-source-inventory.js";

test("Phase 1 proposal-source inventory is complete, supported, and explicitly legacy", () => {
  const result = verifyProposalSourceInventory();
  assert.equal(PROPOSAL_SOURCE_INVENTORY_VERSION, "phase1-source-inventory-v1");
  assert.equal(result.valid, true, result.errors.join("; "));
  assert.equal(result.sourceCount, 5);
  assert.deepEqual(
    PROPOSAL_SOURCE_INVENTORY.map((source) => source.id),
    ["scheduled-discovery", "lab", "exit-monitor", "intraday-stop", "manual-dashboard"]
  );
});

test("inventory verification rejects an unrecognized shortcut source", () => {
  const result = verifyProposalSourceInventory([
    {
      id: "unreviewed-shortcut",
      intentSource: "shortcut",
      entryPoint: "unknown",
      writer: "unknown",
      lineage: "legacy_allocation_only",
    },
  ]);
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /unsupported intent source/);
});

test("a declared intent source still fails without a compiler-routing plan", () => {
  const result = verifyProposalSourceInventory([{
    id: "new-declared-source",
    intentSource: "manual",
    entryPoint: "future",
    writer: "future",
    lineage: "legacy_allocation_only",
  }]);
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /lacks compiler-routing plan/);
});
