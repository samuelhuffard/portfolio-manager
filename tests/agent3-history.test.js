import test from "node:test";
import assert from "node:assert/strict";
import { deriveAgent3History, windowCagr, VOLATILE_YEAR_SPREAD_POINTS } from "../lib/agent3-history.js";
import { ttmWindows, windowGrowthSeries } from "../lib/edgar-metrics.js";
import { assembleMandateInputs } from "../lib/mandate-evidence.js";

/** 16 consecutive quarters ending 2026-03-31, values supplied oldest→newest. */
function quarters(values, { unit = "USD", startYear = 2022 } = {}) {
  const ends = [];
  for (let y = startYear; ends.length < values.length; y++) {
    for (const md of ["-03-31", "-06-30", "-09-30", "-12-31"]) {
      if (ends.length < values.length) ends.push(`${y}${md}`);
    }
  }
  return values.map((val, i) => ({ end: ends[i], start: null, val, fy: 0, fp: "Q", form: "10-Q", filed: ends[i], frame: null, concept: unit }));
}

/** Minimal companyfacts shim: one concept chain per tag. */
function facts(byTag) {
  const units = {};
  for (const [tag, { rows, unit = "USD" }] of Object.entries(byTag)) {
    units[tag] = { units: { [unit]: rows.map((r) => ({ end: r.end, start: r.start ?? subQuarter(r.end), val: r.val, fy: r.fy ?? 0, fp: r.fp ?? "Q", form: r.form ?? "10-Q", filed: r.filed ?? r.end })) } };
  }
  return { cik: 1, entityName: "Test Co", facts: { "us-gaap": units } };
}
const subQuarter = (end) => new Date(Date.parse(end) - 90 * 86400000).toISOString().slice(0, 10);

const instant = (rows) => rows.map((r) => ({ end: r.end, val: r.val, fy: 0, fp: "FY", form: "10-Q", filed: r.end }));

// A steady compounder: revenue grows ~15%/yr with low variance across 4 TTM windows.
const steadyRevenue = [
  100, 100, 100, 100,
  115, 115, 115, 115,
  132, 132, 132, 132,
  152, 152, 152, 152,
];

test("ttmWindows are non-overlapping and yield three independent comparisons", () => {
  const windows = ttmWindows(quarters(steadyRevenue));
  assert.equal(windows.length, 4);
  assert.equal(windows[0].val, 400);
  assert.equal(windows[3].val, 608);
  assert.equal(windowGrowthSeries(windows).length, 3, "four windows → three years");
});

test("a gap in the filing history truncates rather than splicing two distant quarters", () => {
  const rows = quarters(steadyRevenue);
  rows.splice(6, 1); // drop one quarter mid-history
  const windows = ttmWindows(rows);
  assert.ok(windows.length < 4, "a spliced hole must not present as a clean year");
});

test("windowCagr measures elapsed time from filed period ends", () => {
  const windows = ttmWindows(quarters(steadyRevenue));
  const growth = windowCagr(windows);
  assert.ok(growth > 0.14 && growth < 0.16, `expected ~15%/yr, got ${growth}`);
  assert.equal(windowCagr([{ end: "2026-03-31", val: 10 }]), null, "one window is not a CAGR");
  assert.equal(windowCagr([{ end: "2023-03-31", val: -5 }, { end: "2026-03-31", val: 10 }]), null, "no CAGR off a negative base");
});

test("a steady compounder scores full revGrowth inputs", () => {
  const out = deriveAgent3History(facts({ Revenues: { rows: quarters(steadyRevenue) } }));
  assert.equal(out.revGrowth.positiveGrowthYears, 3);
  assert.equal(out.revGrowth.negativeGrowthYears, 0);
  assert.ok(out.revGrowth.revenueCagr3yPct > 14);
  assert.ok(out.revGrowth.maxAnnualGrowthSpreadPoints < VOLATILE_YEAR_SPREAD_POINTS);
  assert.equal(out.revGrowth.materiallyErraticGrowth, false);
  assert.equal(out.revGrowth.volatileYears, 0);
});

test("erratic growth is flagged from the mandate's own 15pp consistency anchor", () => {
  // Same endpoints, wildly different path: +60%, -25%, +60%.
  const erratic = [100, 100, 100, 100, 160, 160, 160, 160, 120, 120, 120, 120, 192, 192, 192, 192];
  const out = deriveAgent3History(facts({ Revenues: { rows: quarters(erratic) } }));
  assert.ok(out.revGrowth.maxAnnualGrowthSpreadPoints > VOLATILE_YEAR_SPREAD_POINTS);
  assert.equal(out.revGrowth.materiallyErraticGrowth, true);
  assert.equal(out.revGrowth.negativeGrowthYears, 1);
});

test("fewer than four windows reports missing and substitutes nothing", () => {
  const out = deriveAgent3History(facts({ Revenues: { rows: quarters(steadyRevenue.slice(0, 8)) } }));
  assert.equal(out.revGrowth, null);
  assert.equal(out.epsTrajectory, null);
  assert.equal(out.complete, false);
  assert.equal(out.windows, 2);
});

test("normalized EPS is operating income per diluted share, not GAAP EPS", () => {
  const opInc = [10, 10, 10, 10, 12, 12, 12, 12, 14, 14, 14, 14, 17, 17, 17, 17];
  const out = deriveAgent3History(facts({
    Revenues: { rows: quarters(steadyRevenue) },
    OperatingIncomeLoss: { rows: quarters(opInc) },
    WeightedAverageNumberOfDilutedSharesOutstanding: { rows: quarters(new Array(16).fill(100)), unit: "shares" },
    // A catastrophic one-time net-income item that must NOT touch the trajectory.
    EarningsPerShareDiluted: { rows: quarters(new Array(16).fill(-50)), unit: "USD/shares" },
  }));
  assert.ok(out.epsTrajectory.normalizedEpsCagr3yPct > 18, "operating trajectory survives a one-time hit");
  assert.equal(out.epsTrajectory.positiveEpsYears, 3);
  assert.equal(out.epsTrajectory.persistentDeterioration, false);
});

test("two consecutive declining years is persistent deterioration", () => {
  const declining = [20, 20, 20, 20, 18, 18, 18, 18, 15, 15, 15, 15, 12, 12, 12, 12];
  const out = deriveAgent3History(facts({
    Revenues: { rows: quarters(steadyRevenue) },
    OperatingIncomeLoss: { rows: quarters(declining) },
    WeightedAverageNumberOfDilutedSharesOutstanding: { rows: quarters(new Array(16).fill(100)), unit: "shares" },
  }));
  assert.equal(out.epsTrajectory.persistentDeterioration, true);
  assert.equal(out.epsTrajectory.persistentTwoYearDecline, true);
  assert.equal(out.epsTrajectory.positiveCumulativeTrajectory, false);
  assert.ok(out.epsTrajectory.worstAnnualDeclinePct < 0);
});

test("Q-001 extends to the medians: a negative-EBITDA year drops out instead of sorting best", () => {
  // Year 3 swings to a large operating loss, so its EBITDA is negative.
  const opInc = [50, 50, 50, 50, 55, 55, 55, 55, -400, -400, -400, -400, 60, 60, 60, 60];
  const companyfacts = facts({
    Revenues: { rows: quarters(steadyRevenue) },
    OperatingIncomeLoss: { rows: quarters(opInc) },
    DepreciationDepletionAndAmortization: { rows: quarters(new Array(16).fill(10)) },
    InterestExpense: { rows: quarters(new Array(16).fill(5)) },
  });
  companyfacts.facts["us-gaap"].LongTermDebtNoncurrent = { units: { USD: instant(quarters(new Array(16).fill(1000))) } };
  companyfacts.facts["us-gaap"].CashAndCashEquivalentsAtCarryingValue = { units: { USD: instant(quarters(new Array(16).fill(200))) } };

  const out = deriveAgent3History(companyfacts);
  const median = out.balanceSheet.medianNetDebtEbitda3y;
  assert.ok(median > 0, "a negative-EBITDA year must not drag the median negative");
  assert.equal(Number.isFinite(median), true);
});

test("agent 3 binds its long-horizon metrics through the evidence adapter", () => {
  const companyfacts = facts({
    Revenues: { rows: quarters(steadyRevenue) },
    GrossProfit: { rows: quarters(steadyRevenue.map((v) => v * 0.6)) },
    OperatingIncomeLoss: { rows: quarters([10, 10, 10, 10, 12, 12, 12, 12, 14, 14, 14, 14, 17, 17, 17, 17]) },
    DepreciationDepletionAndAmortization: { rows: quarters(new Array(16).fill(3)) },
    InterestExpense: { rows: quarters(new Array(16).fill(1)) },
    WeightedAverageNumberOfDilutedSharesOutstanding: { rows: quarters(new Array(16).fill(100)), unit: "shares" },
  });
  companyfacts.facts["us-gaap"].LongTermDebtNoncurrent = { units: { USD: instant(quarters(new Array(16).fill(50))) } };
  companyfacts.facts["us-gaap"].CashAndCashEquivalentsAtCarryingValue = { units: { USD: instant(quarters(new Array(16).fill(80))) } };

  const out = assembleMandateInputs({
    agentId: "agent-3",
    metrics: { peerValuation: 14 },
    derived: { revYoY: 0.2 },
    companyfacts,
  });
  assert.equal(out.supported, true);
  assert.equal(out.longHorizonWindows, 4);
  for (const metricId of ["revGrowth", "epsTrajectory", "marginTrend", "balanceSheet", "peerValuation"]) {
    assert.ok(out.boundMetrics.includes(metricId), `expected ${metricId} bound`);
  }
  // Agent 1/2's short-window scalars are still never substituted.
  assert.notEqual(out.metricVector.revGrowth, 20);
});

test("agent 3 without a history bundle scores exactly as it did before", () => {
  const out = assembleMandateInputs({ agentId: "agent-3", metrics: { peerValuation: 14 }, derived: { revYoY: 0.22 } });
  assert.deepEqual(out.boundMetrics, ["peerValuation"]);
  assert.equal(out.metricVector.revGrowth, null);
});
