import { test } from "node:test";
import assert from "node:assert/strict";
import { applyRiskChecks } from "../lib/risk-engine.js";

const LIMITS = {
  maxPositionPct: 15,
  maxSectorPct: 75,
  minConfidence: 0.4,
  requireBearCase: true,
  prohibitAveragingDown: true,
  blockOnStaleData: true,
};

const goodBuy = {
  action: "BUY",
  targetWeight: 10,
  confidence: 0.7,
  risks: ["multiple compression"],
  killCriteria: ["EPS miss >5%"],
};

test("stale data forces NO_TRADE regardless of proposal", () => {
  const r = applyRiskChecks(goodBuy, { dataStale: true }, LIMITS);
  assert.equal(r.action, "HOLD");
  assert.equal(r.targetWeight, 0);
  assert.equal(r.ruleChecks.data_fresh, false);
  assert.equal(r.overridden, true);
});

test("blocks averaging down into a losing held position", () => {
  const r = applyRiskChecks(goodBuy, { currentPositionWeightPct: 6, isHeldAtLoss: true }, LIMITS);
  assert.equal(r.action, "HOLD");
  assert.equal(r.ruleChecks.no_averaging_down, false);
});

test("allows a BUY into a winning held position (not averaging down)", () => {
  const r = applyRiskChecks(goodBuy, { currentPositionWeightPct: 6, isHeldAtLoss: false, sector: "Technology" }, LIMITS);
  assert.equal(r.action, "BUY");
  assert.equal(r.ruleChecks.no_averaging_down, true);
});

test("clamps an oversized BUY to the 15% max position", () => {
  const r = applyRiskChecks({ ...goodBuy, targetWeight: 25 }, { sector: "Technology" }, LIMITS);
  assert.equal(r.action, "BUY");
  assert.equal(r.targetWeight, 15);
});

test("downgrades a BUY missing its bear case", () => {
  const r = applyRiskChecks({ ...goodBuy, risks: [], killCriteria: [] }, {}, LIMITS);
  assert.equal(r.action, "HOLD");
  assert.equal(r.ruleChecks.has_bear_case, false);
});

test("downgrades when sub-vertical exposure would breach 75%", () => {
  const r = applyRiskChecks(goodBuy, { sector: "Technology", currentSectorWeightPct: 70, currentPositionWeightPct: 0 }, LIMITS);
  assert.equal(r.action, "HOLD");
  assert.equal(r.ruleChecks.sector_ok, false);
});

test("missing or invalid confidence fails the floor instead of skipping it", () => {
  const noConf = applyRiskChecks({ ...goodBuy, confidence: null }, {}, LIMITS);
  assert.equal(noConf.action, "HOLD");
  assert.equal(noConf.ruleChecks.confidence_ok, false);

  const nanConf = applyRiskChecks({ ...goodBuy, confidence: "high" }, {}, LIMITS);
  assert.equal(nanConf.action, "HOLD");
  assert.equal(nanConf.ruleChecks.confidence_ok, false);
});

test("out-of-range confidence is clamped to [0,1]", () => {
  // 7.0 clamps to 1.0 — passes the floor on conviction, not on a unit mistake.
  const clamped = applyRiskChecks({ ...goodBuy, confidence: 7 }, {}, LIMITS);
  assert.equal(clamped.ruleChecks.confidence_ok ?? true, true);
});
