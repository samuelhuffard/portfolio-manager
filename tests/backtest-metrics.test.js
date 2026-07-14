import { test } from "node:test";
import assert from "node:assert/strict";
import { applyTransactionCosts, computeForwardMetrics, summarizeSamples } from "../backtest/metrics.js";

test("pure metrics use total-return inputs, expose unavailable benchmarks, and calculate path risk", () => {
  const metrics = computeForwardMetrics({
    securityEntry: { price: 100 },
    securityExit: { price: 110 },
    benchmarkEntry: null,
    benchmarkExit: null,
    pricePath: [{ price: 90 }, { price: 120 }, { price: 110 }],
  });
  assert.equal(metrics.forwardTotalReturn, 0.1);
  assert.equal(metrics.forwardExcessReturn, null);
  assert.equal(metrics.maxAdverseExcursion, -0.1);
  assert.equal(metrics.maxFavorableExcursion, 0.2);
  assert.equal(metrics.maxDrawdown, -0.1);
});

test("transaction cost application is parameterized and has no invented default", () => {
  assert.equal(applyTransactionCosts({ grossReturn: 0.1, entryCostRate: 0.01, exitCostRate: 0.02 }), 0.06722);
  assert.throws(() => applyTransactionCosts({ grossReturn: 0.1, entryCostRate: null, exitCostRate: null }), /cost rates/);
});

test("sample summaries do not score hits without a caller-supplied hit definition", () => {
  const outcomes = [
    { status: "matured", metrics: { forwardTotalReturn: 0.1, forwardExcessReturn: 0.02 } },
    { status: "immature", metrics: null },
    { status: "unavailable", metrics: null },
    { status: "excluded", metrics: null },
  ];
  const unavailable = summarizeSamples({ outcomes });
  assert.equal(unavailable.hitRate, null);
  assert.equal(unavailable.missing, 1);
  assert.equal(unavailable.immature, 1);
  const scored = summarizeSamples({ outcomes, hitDefinition: (row) => row.metrics.forwardTotalReturn > 0 });
  assert.equal(scored.hits, 1);
  assert.equal(scored.hitRate, 1);
  assert.deepEqual(scored.confidenceInterval95, { lower: 0.206543291474, upper: 1 });
});
