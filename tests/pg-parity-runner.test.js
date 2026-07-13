import { test } from "node:test";
import assert from "node:assert/strict";
import { compareParity } from "../lib/pg/parity.js";
import { failClosedOnReadErrors, isHoldingMarkerRow } from "../lib/pg/parity-runner.js";

test("holdings parity excludes display and MCP provenance rows", () => {
  assert.equal(isHoldingMarkerRow(["NVDA"]), false);
  assert.equal(isHoldingMarkerRow(["Cash"]), true);
  assert.equal(isHoldingMarkerRow(["Last synced: 2026-07-12"]), true);
  assert.equal(isHoldingMarkerRow(["Synced via Robinhood Agentic MCP"]), true);
  assert.equal(isHoldingMarkerRow(["⚠️ Sample data — preview only"]), true);
});

test("an unreadable inventory is not valid parity evidence even when both sides share the same error text", () => {
  const authoritative = { proposals: { error: "offline" } };
  const postgres = { proposals: { error: "offline" } };
  const raw = compareParity(authoritative, postgres);
  assert.equal(raw.ok, true, "raw metric comparison alone cannot distinguish matching errors");

  const checked = failClosedOnReadErrors(raw, authoritative, postgres);
  assert.equal(checked.ok, false);
  assert.equal(checked.matched.length, 0);
  assert.equal(checked.divergences.length, 2);
  assert.match(checked.divergences[0].reason, /read failed/);
});
