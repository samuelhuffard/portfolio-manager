import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const scan = readFileSync(new URL("../jobs/research-scan.js", import.meta.url), "utf8");

test("live scan wires one shared bus, fair agent caps, and verified owned holdings", () => {
  assert.equal((scan.match(/await getUniverseCatalog\(\)/g) ?? []).length, 1);
  assert.match(scan, /buildLiveResearchCandidateBus\(/);
  assert.match(scan, /allocateFairAgentRunCaps\(/);
  assert.match(scan, /await readAllLots\(sheets, spreadsheetId\)/);
  assert.match(scan, /projectAgentOwnedHoldings\(/);
  assert.match(scan, /rec\.action === "SELL"[\s\S]*ownedPositionValueByTicker/);
});

test("catalog rollback preserves attributed holding reviews and emits degraded discovery state", () => {
  assert.match(scan, /\[\.\.\.holdingTickers, \.\.\.watchlist\.tickers, \.\.\.scanTickers\]/);
  assert.match(scan, /source: catalogMode\.degraded \? "watchlist-rollback" : "watchlist"/);
  assert.match(scan, /degraded: catalogMode\.degraded/);
  assert.match(scan, /reasonCode: catalogMode\.reasonCode/);
});
