import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalOutcome, classifyResearchOutcome } from "../lib/research-outcomes.js";

const ENTRY_AT = "2026-01-02T14:30:00.000Z";
const TARGET_AT = "2026-01-12T14:30:00.000Z";
const AS_OF = "2026-01-20T00:00:00.000Z";

function input(overrides = {}) {
  return {
    observationId: "observation-1",
    securityId: "NVDA",
    ticker: "NVDA",
    decisionAt: "2026-01-02T13:00:00.000Z",
    asOf: AS_OF,
    entry: { securityId: "NVDA", ticker: "NVDA", executableAt: ENTRY_AT, price: 100 },
    exit: { securityId: "NVDA", ticker: "NVDA", completedAt: TARGET_AT, price: 110 },
    benchmarkEntry: { securityId: "SPY", completedAt: ENTRY_AT, price: 200 },
    benchmarkExit: { securityId: "SPY", completedAt: TARGET_AT, price: 220 },
    securityPath: [
      { id: "p-1", securityId: "NVDA", completedAt: ENTRY_AT, price: 100 },
      { id: "p-2", securityId: "NVDA", completedAt: "2026-01-05T21:00:00.000Z", price: 90 },
      { id: "p-3", securityId: "NVDA", completedAt: "2026-01-08T21:00:00.000Z", price: 120 },
      { id: "p-4", securityId: "NVDA", completedAt: TARGET_AT, price: 110 },
    ],
    horizonPolicy: { version: "horizon-10d-v1", horizonDays: 10, observationToleranceMs: 0 },
    benchmarkPolicy: { version: "spy-total-return-v1", benchmarkSecurityId: "SPY", alignmentToleranceMs: 0 },
    hitPolicy: { version: "positive-excess-v1", evaluate: ({ metrics }) => metrics.forwardExcessReturn > 0 },
    agentId: "agent-1",
    mandateVersion: "mandate-3",
    scoringVersion: "score-1",
    scoreCompleteness: "complete",
    deltaCause: "filing",
    evidenceClass: "shadow",
    ...overrides,
  };
}

test("classifies exact decimal returns and path risk with a supplied hit rule", () => {
  const result = classifyResearchOutcome(input());
  assert.equal(result.status, "matured");
  assert.equal(result.metrics.forwardTotalReturn, 0.1);
  assert.equal(result.metrics.benchmarkTotalReturn, 0.1);
  assert.equal(result.metrics.forwardExcessReturn, 0);
  assert.equal(result.metrics.maxAdverseExcursion, -0.1);
  assert.equal(result.metrics.maxFavorableExcursion, 0.2);
  assert.equal(result.metrics.maxDrawdown, -0.1);
  assert.equal(result.metrics.holdingPeriodDays, 10);
  assert.equal(result.hit, false);
  assert.deepEqual(result.strata, {
    agentId: "agent-1",
    mandateVersion: "mandate-3",
    scoringVersion: "score-1",
    scoreCompleteness: "complete",
    deltaCause: "filing",
    agentStratum: null,
      selectionCategory: null,
      scoreBand: null,
      regime: null,
  });
});

test("missing security or benchmark prices are unavailable, never zero", () => {
  const missingSecurity = classifyResearchOutcome(input({ exit: null, securityPath: [] }));
  assert.equal(missingSecurity.status, "unavailable");
  assert.equal(missingSecurity.metrics, null);

  const missingBenchmark = classifyResearchOutcome(input({ benchmarkExit: null }));
  assert.equal(missingBenchmark.status, "unavailable");
  assert.equal(missingBenchmark.reason, "missing_benchmark_price");
});

test("maturity uses executable entry time and future records fail closed", () => {
  const immature = classifyResearchOutcome(input({
    asOf: "2026-01-10T00:00:00.000Z",
    exit: null,
    benchmarkEntry: null,
    benchmarkExit: null,
    securityPath: [],
  }));
  assert.equal(immature.status, "immature");
  assert.equal(immature.metrics, null);

  assert.throws(() => classifyResearchOutcome(input({
    asOf: "2026-01-10T00:00:00.000Z",
    exit: { securityId: "NVDA", completedAt: "2026-01-11T00:00:00.000Z", price: 110 },
    securityPath: [],
  })), /after asOf/);
  assert.throws(() => classifyResearchOutcome(input({
    decisionAt: ENTRY_AT,
  })), /after decisionAt/);
  assert.throws(() => classifyResearchOutcome(input({ asOf: "not-a-time" })), /ISO timestamp/);
});

test("cost fields remain null without a versioned cost input and reconcile explicit rates", () => {
  const noCosts = classifyResearchOutcome(input());
  assert.equal(noCosts.metrics.baseNetReturn, null);
  assert.equal(noCosts.metrics.stressedNetReturn, null);

  const withCosts = classifyResearchOutcome(input({
    costs: {
      version: "synthetic-cost-v1",
      base: { entryCostRate: 0.01, exitCostRate: 0.02 },
      stressedNetReturn: -0.01,
    },
  }));
  assert.equal(withCosts.metrics.baseNetReturn, 0.06722);
  assert.equal(withCosts.metrics.stressedNetReturn, -0.01);
  assert.throws(() => classifyResearchOutcome(input({
    costs: {
      version: "synthetic-cost-v1",
      base: { entryCostRate: 0.01, exitCostRate: 0.02 },
      baseNetReturn: 0.2,
    },
  })), /diverges/);
});

test("canonical hashes are deterministic and identities/record IDs are validated", () => {
  const first = classifyResearchOutcome(input());
  const second = classifyResearchOutcome(input({
    entry: { price: 100, executableAt: ENTRY_AT, ticker: "NVDA", securityId: "NVDA" },
    exit: { price: 110, completedAt: TARGET_AT, ticker: "NVDA", securityId: "NVDA" },
  }));
  assert.equal(first.outcomeHash, second.outcomeHash);
  assert.equal(canonicalOutcome(first), canonicalOutcome(second));
  assert.throws(() => classifyResearchOutcome(input({ exit: { securityId: "AMD", completedAt: TARGET_AT, price: 110 } })), /security identity/);
  assert.throws(() => classifyResearchOutcome(input({ benchmarkExit: { securityId: "QQQ", completedAt: TARGET_AT, price: 220 } })), /benchmarkPolicy/);
  assert.throws(() => classifyResearchOutcome(input({ observationId: null, selectionItemId: null, comparisonPairId: null })), /durable|observationId/);
});

test("holdings remain measurable and path chronology is enforced", () => {
  const holding = classifyResearchOutcome(input({ selectionCategory: "holding" }));
  assert.equal(holding.status, "matured");
  assert.equal(holding.strata.selectionCategory, "holding");
  assert.throws(() => classifyResearchOutcome(input({
    securityPath: [{ id: "before", completedAt: "2026-01-01T21:00:00.000Z", price: 95 }],
  })), /before entryAt/);
  assert.throws(() => classifyResearchOutcome(input({
    securityPath: [{ id: "after", completedAt: "2026-01-13T21:00:00.000Z", price: 95 }],
  })), /after exitAt/);
  assert.throws(() => classifyResearchOutcome(input({
    securityPath: [{ id: "wrong-security", securityId: "AMD", completedAt: ENTRY_AT, price: 95 }],
  })), /security identity/);
});

test("evidence class, reporting strata, ticker identity, and turnover are canonical", () => {
  assert.throws(() => classifyResearchOutcome(input({ evidenceClass: null })), /evidenceClass/);
  const result = classifyResearchOutcome(input({ securityId: "nvda", ticker: "nvda", entry: { securityId: "nvda", ticker: "nvda", executableAt: ENTRY_AT, price: 100 },
    exit: { securityId: "nvda", ticker: "nvda", completedAt: TARGET_AT, price: 110 }, scoreBand: "80-89", regime: "risk_on", turnover: 0.25 }));
  assert.equal(result.identity.securityId, "NVDA");
  assert.equal(result.evidenceClass, "shadow");
  assert.equal(result.strata.scoreBand, "80-89");
  assert.equal(result.strata.regime, "risk_on");
  assert.equal(result.metrics.turnover, 0.25);
  assert.throws(() => classifyResearchOutcome(input({ turnover: -0.1 })), /nonnegative/);
});

test("frozen horizon rejects late or benchmark-misaligned observations", () => {
  const late = "2026-01-13T14:30:00.000Z";
  const securityLate = classifyResearchOutcome(input({ exit: { securityId: "NVDA", completedAt: late, price: 110 }, asOf: "2026-01-20T00:00:00.000Z",
    securityPath: [{ securityId: "NVDA", completedAt: late, price: 110 }] }));
  assert.equal(securityLate.status, "unavailable");
  assert.equal(securityLate.reason, "security_price_not_aligned_to_horizon");
  const benchmarkLate = classifyResearchOutcome(input({ benchmarkExit: { securityId: "SPY", completedAt: late, price: 220 } }));
  assert.equal(benchmarkLate.status, "unavailable");
  assert.equal(benchmarkLate.reason, "benchmark_price_not_aligned");
  assert.throws(() => classifyResearchOutcome(input({ horizonPolicy: { version: "h", horizonDays: 10 } })), /observationToleranceMs/);
  assert.throws(() => classifyResearchOutcome(input({ benchmarkPolicy: { version: "b", benchmarkSecurityId: "SPY" } })), /alignmentToleranceMs/);
  const nextDay = "2026-01-13T14:30:00.000Z";
  const tolerated = classifyResearchOutcome(input({
    horizonPolicy: { version: "horizon-10d-next-session-v1", horizonDays: 10, observationToleranceMs: 86400000 },
    benchmarkPolicy: { version: "aligned-next-session-v1", benchmarkSecurityId: "SPY", alignmentToleranceMs: 0 },
    exit: { securityId: "NVDA", completedAt: nextDay, price: 110 }, benchmarkExit: { securityId: "SPY", completedAt: nextDay, price: 220 },
    securityPath: [{ securityId: "NVDA", completedAt: nextDay, price: 110 }],
  }));
  assert.equal(tolerated.status, "matured");
  assert.equal(tolerated.timingRules.observationToleranceMs, 86400000);
});
