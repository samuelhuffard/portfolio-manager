import { test } from "node:test";
import assert from "node:assert/strict";
import { createPointInTimeLoader } from "../backtest/loaders/point-in-time.js";
import { runMandateBacktest, selectDeterministicRandomBaseline } from "../backtest/run-mandate-backtest.js";

function fixtureLoader() {
  return createPointInTimeLoader({
    universeEvents: [
      { securityId: "OLD", action: "add", availableAt: "2025-01-01T00:00:00Z", eligible: true },
      { securityId: "OLD", action: "remove", availableAt: "2025-01-25T00:00:00Z", reason: "delisted" },
      { securityId: "NEW", action: "add", availableAt: "2025-01-01T00:00:00Z", eligible: true },
    ],
    evidenceEvents: [{ id: "filing", securityId: "OLD", acceptedAt: "2025-01-10T20:00:00Z" }],
    marketData: [
      { securityId: "OLD", completedAt: "2025-01-10T21:00:00Z", executableAt: "2025-01-13T14:30:00Z", price: 100 },
      { securityId: "OLD", completedAt: "2025-01-23T21:00:00Z", executableAt: "2025-01-24T14:30:00Z", price: 120 },
      { securityId: "SPY", completedAt: "2025-01-13T21:00:00Z", executableAt: "2025-01-14T14:30:00Z", price: 200 },
    ],
    policies: [{ policyType: "selection", version: "selection-v1", introducedAt: "2025-01-01T00:00:00Z", activeAt: "2025-01-01T00:00:00Z" }],
  });
}

function options(overrides = {}) {
  return {
    loader: fixtureLoader(),
    decisions: [
      { id: "discovery-old", securityId: "OLD", decisionAt: "2025-01-10T21:00:00Z", selectionCategory: "discovery", notional: 100 },
      { id: "holding-old", securityId: "OLD", decisionAt: "2025-01-10T21:00:00Z", selectionCategory: "holding", notional: 50 },
      { id: "new-missing", securityId: "NEW", decisionAt: "2025-01-10T21:00:00Z", selectionCategory: "discovery" },
    ],
    runId: "run-1",
    codeRevision: "code-1",
    methodologyVersion: "v1",
    mandateVersion: "mandate-3",
    scoringVersion: "score-1",
    universeVersion: "universe-1",
    selectionVersion: "selection-1",
    snapshotIds: { universe: "u-1" },
    snapshotHashes: { universe: "abc" },
    params: { fixture: true, hitDefinitionVersion: "positive-total-return-v1" },
    seed: "seed-a",
    startAt: "2025-01-01T00:00:00Z",
    endAt: "2025-01-31T00:00:00Z",
    asOf: "2025-01-31T00:00:00Z",
    benchmarkSecurityId: "SPY",
    horizonDays: 10,
    hitDefinition: (row) => row.metrics.forwardTotalReturn > 0,
    ...overrides,
  };
}

test("replay is reproducible, retains delisted names, and keeps holdings out of discovery comparisons", () => {
  const first = runMandateBacktest(options());
  const second = runMandateBacktest(options());
  assert.equal(first.canonicalResult, second.canonicalResult);
  assert.equal(first.artifact.resultHash, second.artifact.resultHash);
  assert.equal(first.artifact.results.overall.matured, 2);
  assert.equal(first.artifact.results.discovery.matured, 1);
  assert.equal(first.artifact.results.mandatoryOrHoldings.matured, 1);
  assert.equal(first.artifact.results.discovery.unavailable, 1);
  assert.equal(first.artifact.results.outcomes.find((row) => row.id === "discovery-old").metrics.forwardTotalReturn, 0.2);
  assert.equal(first.artifact.results.outcomes.find((row) => row.id === "discovery-old").metrics.forwardExcessReturn, null);
  assert.ok(first.artifact.results.outcomes.find((row) => row.id === "discovery-old").visibleEvidenceIds.includes("filing"));
  assert.notEqual(first.artifact.resultHash, runMandateBacktest(options({ seed: "seed-b" })).artifact.resultHash);
  assert.notEqual(first.artifact.resultHash, runMandateBacktest(options({ scoringVersion: "score-2" })).artifact.resultHash);
  assert.notEqual(first.artifact.resultHash, runMandateBacktest(options({ snapshotHashes: { universe: "def" } })).artifact.resultHash);
});

test("immature horizons are not compared and open Q-007 leaves net returns unavailable", () => {
  const result = runMandateBacktest(options({ asOf: "2025-01-15T00:00:00Z", endAt: "2025-01-15T00:00:00Z" }));
  assert.equal(result.artifact.results.overall.matured, 0);
  assert.equal(result.artifact.results.overall.immature, 2);
  assert.equal(result.artifact.results.overall.unavailable, 1);

  const costs = runMandateBacktest(options({
    costPolicy: {
      version: "synthetic-cost-v1",
      base: ({ phase }) => phase === "entry" ? 0.01 : 0.02,
      stressed: () => 0.03,
    },
  }));
  const matured = costs.artifact.results.outcomes.find((row) => row.id === "discovery-old");
  assert.equal(matured.metrics.baseNetReturn, 0.16424);
  assert.equal(matured.metrics.stressedNetReturn, 0.12908);
  const noCosts = runMandateBacktest(options()).artifact.results.outcomes.find((row) => row.id === "discovery-old");
  assert.equal(noCosts.metrics.baseNetReturn, null);
  assert.equal(noCosts.metrics.stressedNetReturn, null);
});

test("seeded random baseline is deterministic and identity-preserving", () => {
  const eligible = [{ securityId: "A" }, { securityId: "B" }, { securityId: "C" }];
  assert.deepEqual(selectDeterministicRandomBaseline({ eligible, count: 2, seed: "fixed" }), selectDeterministicRandomBaseline({ eligible, count: 2, seed: "fixed" }));
  const one = runMandateBacktest(options({ randomBaseline: { count: 1 } }));
  const two = runMandateBacktest(options({ randomBaseline: { count: 1 } }));
  assert.deepEqual(one.artifact.results.randomBaseline, two.artifact.results.randomBaseline);
  assert.equal(one.artifact.results.randomBaseline.selectedSecurityIds.length, 1);
});

test("replay rejects time-window leaks, unlabeled decisions, and unreproducible hit rules", () => {
  assert.throws(() => runMandateBacktest(options({
    startAt: "2025-02-01T00:00:00Z",
  })), /startAt must be earlier/);
  assert.throws(() => runMandateBacktest(options({
    endAt: "2025-02-01T00:00:00Z",
    asOf: "2025-01-31T00:00:00Z",
  })), /endAt must be earlier/);
  assert.throws(() => runMandateBacktest(options({
    decisions: [{ id: "outside", securityId: "OLD", decisionAt: "2024-12-31T21:00:00Z", selectionCategory: "discovery" }],
  })), /inside the declared/);
  assert.throws(() => runMandateBacktest(options({
    decisions: [{ id: "unlabeled", securityId: "OLD", decisionAt: "2025-01-10T21:00:00Z" }],
  })), /selectionCategory is required/);
  assert.throws(() => runMandateBacktest(options({
    decisions: [{ id: "bad-label", securityId: "OLD", decisionAt: "2025-01-10T21:00:00Z", selectionCategory: "maybe_holding" }],
  })), /selectionCategory is unsupported/);
  assert.throws(() => runMandateBacktest(options({
    params: { fixture: true },
  })), /hitDefinitionVersion/);
});

test("random baseline cannot snapshot outside the declared window or after as-of", () => {
  assert.throws(() => runMandateBacktest(options({
    randomBaseline: { count: 1, at: "2024-12-31T00:00:00Z" },
  })), /randomBaseline.at must be inside/);
  assert.throws(() => runMandateBacktest(options({
    randomBaseline: { count: 1, at: "2025-02-01T00:00:00Z" },
  })), /randomBaseline.at must be inside/);
});
