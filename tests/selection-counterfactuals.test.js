import { test } from "node:test";
import assert from "node:assert/strict";
import { compareSelectionCounterfactuals, comparisonPairIdFor } from "../lib/selection-counterfactuals.js";

function outcome(overrides = {}) {
  return {
    status: "matured",
    metrics: { forwardTotalReturn: 0.1, forwardExcessReturn: 0.05 },
    policyVersions: { horizon: "horizon-10d-v1", benchmark: "spy-v1", hit: "hit-v1", cost: null },
    strata: {
      agentId: "agent-1",
      mandateVersion: "mandate-3",
      scoringVersion: "score-1",
      scoreCompleteness: "complete",
      deltaCause: "filing",
    },
    evidenceClass: "shadow",
    ...overrides,
  };
}

function row(side, item, overrides = {}) {
  const selectionRunId = overrides.selectionRunId ?? "run-1";
  const agentId = overrides.agentId ?? "agent-1";
  const suffix = String(item).replace(/[^a-z0-9]/gi, "").toUpperCase();
  const selectedTicker = overrides.selectedTicker ?? `S${suffix}`;
  const displacedTicker = overrides.displacedTicker ?? `D${suffix}`;
  return {
    comparisonPairId: comparisonPairIdFor({ selectionRunId, agentId, selectedTicker, displacedTicker }),
    selectionRunId,
    selectionItemId: item,
    agentId,
    selectedTicker,
    displacedTicker,
    ticker: side === "selected" ? selectedTicker : displacedTicker,
    side,
    outcome: outcome(overrides.outcome),
    ...overrides,
  };
}

test("pairs durable selected/displaced lineage and computes decimal differences", () => {
  const result = compareSelectionCounterfactuals({
    comparisonType: "event_vs_rotation",
    selected: [row("selected", "1")],
    displaced: [row("displaced", "1", { outcome: outcome({ metrics: { forwardTotalReturn: 0.2, forwardExcessReturn: 0.1 } }) })],
  });
  assert.equal(result.sampleCount, 1);
  assert.equal(result.aggregate.selectedAverageTotalReturn, 0.1);
  assert.equal(result.aggregate.displacedAverageTotalReturn, 0.2);
  assert.equal(result.aggregate.opportunityCostTotalReturn, 0.1);
  assert.equal(result.aggregate.opportunityCostExcessReturn, 0.05);
});

test("derives E3/E4 lineage from distinct selection items and candidate tickers", () => {
  const selected = {
    selectionRunId: "run-2",
    selectionItemId: "selected-item",
    agentId: "agent-1",
    ticker: "NVDA",
    displacedTicker: "AMD",
    outcome: outcome(),
  };
  const displaced = {
    selectionRunId: "run-2",
    selectionItemId: "displaced-item",
    agentId: "agent-1",
    ticker: "AMD",
    selectedTicker: "NVDA",
    outcome: outcome({ metrics: { forwardTotalReturn: 0.2, forwardExcessReturn: 0.1 } }),
  };
  const result = compareSelectionCounterfactuals({ comparisonType: "event_vs_rotation", selected: [selected], displaced: [displaced] });
  assert.equal(result.sampleCount, 1);
  assert.notEqual(selected.selectionItemId, displaced.selectionItemId);
});

test("holdings and mandatory re-underwrites are excluded only from this comparison", () => {
  const result = compareSelectionCounterfactuals({
    comparisonType: "top_score_vs_exploration",
    selected: [row("selected", "holding", { selectionCategory: "holding" })],
    displaced: [row("displaced", "holding", { budgetExempt: true })],
  });
  assert.equal(result.sampleCount, 0);
  assert.equal(result.counts.excluded, 2);
  assert.equal(result.aggregate.selectedAverageTotalReturn, null);

  const bucket = compareSelectionCounterfactuals({
    comparisonType: "top_score_vs_exploration",
    selected: [row("selected", "mandatory", { bucket: "mandatory_reunderwrite" })],
    displaced: [row("displaced", "mandatory")],
  });
  assert.equal(bucket.counts.excluded, 1);
});

test("unmatched and immature pairs are counted without aggregation", () => {
  const result = compareSelectionCounterfactuals({
    comparisonType: "ai_vs_finalist",
    selected: [row("selected", "unmatched"), row("selected", "immature")],
    displaced: [row("displaced", "immature", { outcome: outcome({ status: "immature", metrics: null }) })],
  });
  assert.equal(result.sampleCount, 0);
  assert.equal(result.counts.missing, 1);
  assert.equal(result.counts.immature, 1);
  assert.equal(result.aggregate.sampleCount, 0);
});

test("version mismatch is visible and distinct strata never mix", () => {
  const secondSelected = row("selected", "2", { outcome: outcome({ strata: { ...outcome().strata, mandateVersion: "mandate-4" } }) });
  const secondDisplaced = row("displaced", "2", { outcome: outcome({ strata: { ...outcome().strata, mandateVersion: "mandate-4" }, metrics: { forwardTotalReturn: 0.3, forwardExcessReturn: 0.2 } }) });
  const mismatch = compareSelectionCounterfactuals({
    comparisonType: "evaluator_disposition",
    selected: [row("selected", "1")],
    displaced: [row("displaced", "1", { outcome: outcome({ strata: { ...outcome().strata, mandateVersion: "mandate-4" } }) })],
  });
  assert.equal(mismatch.sampleCount, 0);
  assert.equal(mismatch.counts.versionMismatch, 1);
  assert.equal(mismatch.versionMismatchStrata[0].reason, "version_strata_mismatch");
  assert.equal(mismatch.versionMismatchStrata[0].selected.mandateVersion, "mandate-3");
  assert.equal(mismatch.versionMismatchStrata[0].displaced.mandateVersion, "mandate-4");

  const stratified = compareSelectionCounterfactuals({
    comparisonType: "event_vs_rotation",
    selected: [row("selected", "1"), secondSelected],
    displaced: [row("displaced", "1"), secondDisplaced],
  });
  assert.equal(stratified.sampleCount, 2);
  assert.equal(stratified.strata.length, 2);
  assert.equal(stratified.aggregate.sampleCount, 0);
  assert.equal(stratified.strata.every((stratum) => stratum.labels.mandateVersion), true);
});

test("duplicate identities fail closed and labels remain non-promotional", () => {
  assert.throws(() => compareSelectionCounterfactuals({
    comparisonType: "event_vs_rotation",
    selected: [row("selected", "1"), row("selected", "1")],
    displaced: [row("displaced", "1")],
  }), /duplicate/);
  const runAPair = comparisonPairIdFor({ selectionRunId: "run-a", agentId: "agent-1", selectedTicker: "NVDA", displacedTicker: "AMD" });
  assert.throws(() => compareSelectionCounterfactuals({
    comparisonType: "event_vs_rotation",
    selected: [row("selected", "1", { selectionRunId: "run-a", selectedTicker: "NVDA", displacedTicker: "AMD", comparisonPairId: runAPair })],
    displaced: [row("displaced", "1", { selectionRunId: "run-b", selectedTicker: "NVDA", displacedTicker: "AMD", comparisonPairId: runAPair })],
  }), /deterministic selection lineage/);
  assert.throws(() => compareSelectionCounterfactuals({
    comparisonType: "event_vs_rotation",
    selected: [row("selected", "1", { outcome: outcome({ metrics: { forwardTotalReturn: "not-a-number", forwardExcessReturn: 0 } }) })],
    displaced: [row("displaced", "1")],
  }), /finite number/);
  assert.throws(() => compareSelectionCounterfactuals({
    comparisonType: "unsupported",
    selected: [],
    displaced: [],
  }), /comparisonType/);
  const result = compareSelectionCounterfactuals({ comparisonType: "ai_vs_finalist", selected: [], displaced: [] });
  assert.doesNotMatch(JSON.stringify(result), /BUY|SELL|confidence|promotion|edge|threshold/i);
});

test("evidence, hit, and cost policy strata cannot mix", () => {
  const selected = row("selected", "policy", { outcome: outcome({ evidenceClass: "backtest", policyVersions: { horizon: "horizon-10d-v1", benchmark: "spy-v1", hit: "hit-v1", cost: "cost-v1" } }) });
  const displaced = row("displaced", "policy", { outcome: outcome({ evidenceClass: "realized_live", policyVersions: { horizon: "horizon-10d-v1", benchmark: "spy-v1", hit: "hit-v2", cost: "cost-v2" } }) });
  const result = compareSelectionCounterfactuals({ comparisonType: "event_vs_rotation", selected: [selected], displaced: [displaced] });
  assert.equal(result.sampleCount, 0);
  assert.equal(result.counts.versionMismatch, 1);
  assert.equal(result.versionMismatchStrata[0].selected.evidenceClass, "backtest");
  assert.equal(result.versionMismatchStrata[0].displaced.costPolicyVersion, "cost-v2");
});
