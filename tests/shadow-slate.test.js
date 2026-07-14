import { test } from "node:test";
import assert from "node:assert/strict";
import { compareShadowSlate } from "../lib/shadow-slate.js";

const NOW = new Date("2026-07-13T20:00:00.000Z");
const item = (ticker, overrides = {}) => ({ ticker, agentId: "agent-1", ...overrides });

test("holdings are protected and excluded from novelty, displacement, and turnover claims", () => {
  const result = compareShadowSlate({
    currentSlate: [item("HELD"), item("OLD")],
    proposedSlate: [item("HELD"), item("NEW")],
    holdings: ["HELD"],
    now: NOW,
  });
  assert.deepEqual(result.overlap.tickers, ["HELD"]);
  assert.deepEqual(result.overlap.nonHoldingTickers, []);
  assert.deepEqual(result.novelty.tickers, ["NEW"]);
  assert.deepEqual(result.displacedNonHoldings.map((entry) => entry.ticker), ["OLD"]);
  assert.equal(result.turnover.added, 1);
  assert.equal(result.turnover.removed, 1);
});

test("preserves lineage and returns deterministic concentration and evidence-age measurements", () => {
  const result = compareShadowSlate({
    currentSlate: [item("AAA", { sector: "Technology", marketCap: 10, evidenceAt: "2026-07-10T20:00:00.000Z" })],
    proposedSlate: [item("BBB", { sector: "Health Care", marketCap: 30, reasonCodes: ["material_event"], triggeringEventId: "event-2", triggeringObservationId: "obs-2", evidenceAt: "2026-07-12T20:00:00.000Z" })],
    holdings: [],
    now: NOW,
  });
  assert.equal(result.selected[0].lineage.triggeringEventId, "event-2");
  assert.equal(result.selected[0].lineage.triggeringObservationId, "obs-2");
  assert.deepEqual(result.sectorConcentration.proposed.bySector, [{ sector: "Health Care", count: 1, share: 1 }]);
  assert.deepEqual(result.marketCapConcentration.proposed.marketCaps, [{ ticker: "BBB", marketCap: 30, share: 1 }]);
  assert.equal(result.evidenceAge.proposed.knownCount, 1);
  assert.equal(result.evidenceAge.proposed.agesMs[0], 24 * 60 * 60 * 1000);
});

test("duplicate and invalid slate tickers fail closed", () => {
  assert.throws(() => compareShadowSlate({ currentSlate: ["AAA", "aaa"] }), /duplicate ticker/);
  assert.throws(() => compareShadowSlate({ proposedSlate: ["not a ticker"] }), /canonical ticker/);
});

test("empty slates are valid and comparison is deterministic", () => {
  const input = { currentSlate: [], proposedSlate: [], holdings: [], now: NOW };
  const first = compareShadowSlate(input);
  const second = compareShadowSlate(input);
  assert.deepEqual(first, second);
  assert.equal(first.turnover.count, 0);
  assert.equal(first.evidenceAge.proposed.unknownCount, 0);
});
