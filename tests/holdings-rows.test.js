import { test } from "node:test";
import assert from "node:assert/strict";
import { holdingRowLabel, isHoldingMarkerRow, isSecurityHoldingRow } from "../lib/holdings-rows.js";

test("holdings rows normalize labels and distinguish markers from securities", () => {
  assert.equal(holdingRowLabel(["  NVDA  "]), "NVDA");
  assert.equal(holdingRowLabel("  Cash  "), "Cash");

  assert.equal(isHoldingMarkerRow([""]), true);
  assert.equal(isHoldingMarkerRow(["Cash"]), true);
  assert.equal(isHoldingMarkerRow(["  cAsH  "]), true);
  assert.equal(isHoldingMarkerRow(["Last synced: 2026-07-12"]), true);
  assert.equal(isHoldingMarkerRow(["last synced: 2026-07-12"]), true);
  assert.equal(isHoldingMarkerRow(["Synced via Robinhood Agentic MCP"]), true);
  assert.equal(isHoldingMarkerRow(["synced via robinhood agentic mcp"]), true);
  assert.equal(isHoldingMarkerRow(["⚠️ Sample data — preview only"]), true);

  assert.equal(isSecurityHoldingRow(["NVDA"]), true);
  assert.equal(isSecurityHoldingRow(["BRK.B"]), true);
  assert.equal(isSecurityHoldingRow(["BF-B"]), true);
  assert.equal(isSecurityHoldingRow(["  NVDA  "]), true);
  assert.equal(isSecurityHoldingRow(["Cash"]), false);
  assert.equal(isSecurityHoldingRow(["cash"]), false);
  assert.equal(isSecurityHoldingRow(["Last synced: 2026-07-12"]), false);
  assert.equal(isSecurityHoldingRow(["⚠️ Sample data — preview only"]), false);
  assert.equal(isSecurityHoldingRow(["Total Portfolio Value"]), false);
});
