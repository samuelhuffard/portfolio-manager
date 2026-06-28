import { test } from "node:test";
import assert from "node:assert/strict";
import { assembleEntrySignals, assessConviction } from "../lib/conviction.js";

const LIMITS = { maxPositionPct: 15, minPositionPct: 2 };
const NOW = new Date("2026-06-26T00:00:00Z");

test("High conviction: 2+ strong signals + imminent catalyst + price confirm => 10–15%", () => {
  const r = assessConviction({ strongCount: 3, catalystImminent: true, priceConfirm: true }, LIMITS);
  assert.equal(r.tier, "High");
  assert.equal(r.maxWeightPct, 15);
  assert.ok(r.qualified);
});

test("Medium: 2 strong but no catalyst/price confirm caps at 10%", () => {
  const r = assessConviction({ strongCount: 2, catalystImminent: false, priceConfirm: false }, LIMITS);
  assert.equal(r.tier, "Medium");
  assert.equal(r.maxWeightPct, 10);
});

test("Speculative: single strong signal caps at 5%", () => {
  const r = assessConviction({ strongCount: 1 }, LIMITS);
  assert.equal(r.tier, "Speculative");
  assert.equal(r.maxWeightPct, 5);
});

test("Unqualified: zero strong signals => no entry", () => {
  const r = assessConviction({ strongCount: 0 }, LIMITS);
  assert.equal(r.tier, "None");
  assert.equal(r.qualified, false);
  assert.equal(r.maxWeightPct, 0);
});

test("assembleEntrySignals counts strong fundamentals and an imminent catalyst", () => {
  const candidate = {
    raw: {
      financialData: { earningsGrowth: 0.4, revenueGrowth: 0.3, profitMargins: 0.18, grossMargins: 0.7 },
      defaultKeyStatistics: { forwardPE: 22 },
      summaryDetail: { trailingPE: 35 },
    },
    momentum1m: 0.08,
    momentum3m: 0.2,
    rsi: 60,
    epsSurprisePct: 9,
    nextEarningsDate: "2026-07-01",
  };
  const s = assembleEntrySignals(candidate, { now: NOW });
  assert.ok(s.strongCount >= 2);
  assert.equal(s.catalystImminent, true);
  assert.equal(s.priceConfirm, true);
  assert.equal(s.confirmatory.fwdPeBelowTrailing, true);

  const conviction = assessConviction(s, LIMITS);
  assert.equal(conviction.tier, "High");
});

test("a weak candidate with no strong signals does not qualify", () => {
  const s = assembleEntrySignals({ raw: { financialData: {} }, momentum1m: -0.1, momentum3m: -0.2, rsi: 35 }, { now: NOW });
  assert.equal(s.strongCount, 0);
  assert.equal(assessConviction(s, LIMITS).qualified, false);
});
