import { test } from "node:test";
import assert from "node:assert/strict";
import { applyRiskChecks, findFabricatedMetricClaims } from "../lib/risk-engine.js";

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

test("mandate market-cap and liquidity floors fail closed for BUYs", () => {
  const limits = { ...LIMITS, minMarketCap: 300_000_000, minAvgDollarVolume: 10_000_000 };
  const tooSmall = applyRiskChecks(goodBuy, { marketCap: 299_000_000, avgDollarVolume: 11_000_000 }, limits);
  assert.equal(tooSmall.action, "HOLD");
  assert.equal(tooSmall.ruleChecks.market_cap_ok, false);

  const illiquid = applyRiskChecks(goodBuy, { marketCap: 500_000_000, avgDollarVolume: 9_000_000 }, limits);
  assert.equal(illiquid.action, "HOLD");
  assert.equal(illiquid.ruleChecks.liquidity_ok, false);

  const eligible = applyRiskChecks(goodBuy, { marketCap: 500_000_000, avgDollarVolume: 11_000_000 }, limits);
  assert.equal(eligible.action, "BUY");
});

test("findFabricatedMetricClaims flags an analyst figure cited when no analyst data was supplied", () => {
  const flags = findFabricatedMetricClaims(
    { thesis: "Backed by 37 buy ratings from analysts.", risks: [], killCriteria: [] },
    { analystTrend: null, insiderActivity: "net buying of 1,000 shares" }
  );
  assert.equal(flags.length, 1);
  assert.match(flags[0], /analyst figure cited/);
});

test("findFabricatedMetricClaims flags an insider figure cited when no insider data was supplied", () => {
  const flags = findFabricatedMetricClaims(
    { thesis: "Insider net buying of 98,888 shares supports the case.", risks: [], killCriteria: [] },
    { analystTrend: "3 buy, 1 hold", insiderActivity: null }
  );
  assert.equal(flags.length, 1);
  assert.match(flags[0], /insider figure cited/);
});

test("findFabricatedMetricClaims does not flag analyst/insider mentions with no numbers", () => {
  const flags = findFabricatedMetricClaims(
    { thesis: "Analyst sentiment is broadly positive; insider activity is unremarkable.", risks: [], killCriteria: [] },
    { analystTrend: null, insiderActivity: null }
  );
  assert.deepEqual(flags, []);
});

test("findFabricatedMetricClaims does not flag a real figure that matches supplied data", () => {
  const flags = findFabricatedMetricClaims(
    { thesis: "37 buy, 3 hold analyst consensus supports the case.", risks: [], killCriteria: [] },
    { analystTrend: "37 buy, 3 hold", insiderActivity: null }
  );
  assert.deepEqual(flags, []);
});

test("applyRiskChecks downgrades a BUY to HOLD when it cites an unsupported analyst/insider figure", () => {
  const rec = {
    action: "BUY",
    targetWeight: 8,
    confidence: 0.8,
    thesis: "Insider net buying of 98,888 shares (14 buy vs 5 sell) supports the thesis.",
    risks: ["multiple compression"],
    killCriteria: ["EPS miss >5%"],
  };
  const r = applyRiskChecks(rec, { analystTrend: null, insiderActivity: null, sector: "Technology" }, LIMITS);
  assert.equal(r.action, "HOLD");
  assert.equal(r.ruleChecks.evidence_grounded, false);
  assert.match(r.overrideNotes.join("; "), /insider figure cited/);
});

test("applyRiskChecks allows a BUY that cites a figure matching supplied analyst/insider data", () => {
  const rec = {
    action: "BUY",
    targetWeight: 8,
    confidence: 0.8,
    thesis: "37 buy, 3 hold analyst consensus supports the thesis.",
    risks: ["multiple compression"],
    killCriteria: ["EPS miss >5%"],
  };
  const r = applyRiskChecks(rec, { analystTrend: "37 buy, 3 hold", insiderActivity: "net buying of 1,000 shares", sector: "Technology" }, LIMITS);
  assert.equal(r.action, "BUY");
  assert.equal(r.ruleChecks.evidence_grounded, true);
});
