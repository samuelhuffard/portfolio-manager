import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { classifyResearchOutcome } from "../lib/research-outcomes.js";
import { buildResearchEvidenceReport } from "../lib/research-evidence-report.js";

function outcome(overrides = {}) {
  return classifyResearchOutcome({
    observationId: "obs-1", securityId: "PRIVATE", ticker: "PRIVATE", decisionAt: "2026-01-01T13:00:00.000Z", asOf: "2026-01-20T00:00:00.000Z",
    entry: { securityId: "PRIVATE", ticker: "PRIVATE", executableAt: "2026-01-01T14:00:00.000Z", price: 100 }, exit: { securityId: "PRIVATE", ticker: "PRIVATE", completedAt: "2026-01-11T14:00:00.000Z", price: 90 },
    benchmarkEntry: { securityId: "SPY", completedAt: "2026-01-01T14:00:00.000Z", price: 100 }, benchmarkExit: { securityId: "SPY", completedAt: "2026-01-11T14:00:00.000Z", price: 105 },
    securityPath: [{ securityId: "PRIVATE", completedAt: "2026-01-01T14:00:00.000Z", price: 100 }, { securityId: "PRIVATE", completedAt: "2026-01-11T14:00:00.000Z", price: 90 }],
    horizonPolicy: { version: "horizon-v1", horizonDays: 10, observationToleranceMs: 0 }, benchmarkPolicy: { version: "benchmark-v1", benchmarkSecurityId: "SPY", alignmentToleranceMs: 0 }, hitPolicy: { version: "hit-v1", evaluate: () => false },
    agentId: "agent-1", mandateVersion: "mandate-v1", scoringVersion: "score-v1", scoreCompleteness: "complete", deltaCause: "filing", evidenceClass: "shadow", ...overrides,
  });
}

test("report is deterministic, complete, aggregate-safe, and not promotional", () => {
  const inputs = { metadata: { version: "report-v1", asOf: "2026-07-13T00:00:00.000Z", freshness: "fresh" }, observations: [{ ticker: "PRIVATE", rationale: "private" }], outcomes: [{ ...outcome(), evidenceClass: "shadow" }], backtestArtifacts: { ticker: "PRIVATE" }, counterfactualResults: { rationale: "private" }, sensitivity: { ticker: "PRIVATE" } };
  const first = buildResearchEvidenceReport(inputs); const second = buildResearchEvidenceReport(inputs);
  assert.deepEqual(first, second); assert.equal(first.report.conclusion, "not_assessed");
  for (const section of ["dataCoverage", "evidenceClasses", "stratifiedResults", "backtest", "counterfactuals", "sensitivity"]) assert.ok(first.report.sections[section]);
  assert.equal(first.report.sections.evidenceClasses.paper.state, "not_configured");
  assert.equal(first.report.sections.evidenceClasses.shadow.metrics.baseNetReturn, null);
  assert.doesNotMatch(`${JSON.stringify(first.report)}${first.markdown}`, /PRIVATE|private|edge|promotion|BUY|SELL/i);
});

test("negative and missing results remain explicit, policy versions stay separate, and Q-007 never invents net", () => {
  const missing = outcome({ observationId: "obs-missing", asOf: "2026-01-20T00:00:00.000Z", exit: null, securityPath: [] });
  const versionTwo = outcome({ mandateVersion: "mandate-v2" });
  const report = buildResearchEvidenceReport({ metadata: { version: "report-v1", q007CostStatus: "not_configured" }, outcomes: [{ ...outcome(), evidenceClass: "backtest" }, { ...missing, evidenceClass: "backtest" }, { ...versionTwo, evidenceClass: "backtest" }] }).report;
  assert.equal(report.sections.dataCoverage.statusCounts.unavailable, 1);
  assert.equal(report.sections.evidenceClasses.backtest.metricState, "stratified_only");
  assert.equal(report.sections.evidenceClasses.backtest.metrics, null);
  assert.equal(report.sections.stratifiedResults.groups.every((group) => group.metrics.baseNetReturn === null), true);
  assert.equal(report.sections.stratifiedResults.groups.length, 2);
  assert.equal(report.sections.evidenceClasses.realized_live.state, "not_configured");
});

test("latest snapshot is one sample while snapshot coverage remains explicit", () => {
  const early = outcome({ asOf: "2026-01-10T00:00:00.000Z", exit: null, benchmarkEntry: null, benchmarkExit: null, securityPath: [] });
  const firstMatured = outcome({ asOf: "2026-01-20T00:00:00.000Z" });
  const laterMatured = outcome({ asOf: "2026-01-21T00:00:00.000Z" });
  const report = buildResearchEvidenceReport({ metadata: { version: "report-v1" }, outcomes: [early, firstMatured, laterMatured] }).report;
  assert.equal(report.sections.dataCoverage.snapshotCount, 3);
  assert.equal(report.sections.dataCoverage.outcomeCount, 1);
  assert.equal(report.sections.dataCoverage.snapshotStatusCounts.matured, 2);
  assert.equal(report.sections.evidenceClasses.shadow.counts.sample, 1);
});

test("declared cost policy remains one sample across immature and matured snapshots", () => {
  const costs = { version: "cost-v1", base: { entryCostRate: 0.01, exitCostRate: 0.01 } };
  const immature = outcome({ asOf: "2026-01-10T00:00:00.000Z", exit: null, benchmarkEntry: null, benchmarkExit: null, securityPath: [], costs });
  const matured = outcome({ asOf: "2026-01-20T00:00:00.000Z", costs });
  assert.equal(immature.policyVersions.cost, "cost-v1");
  const report = buildResearchEvidenceReport({ metadata: { version: "report-v1" }, outcomes: [immature, matured] }).report;
  assert.equal(report.sections.dataCoverage.snapshotCount, 2);
  assert.equal(report.sections.dataCoverage.outcomeCount, 1);
  assert.equal(report.sections.evidenceClasses.shadow.counts.sample, 1);
});

test("Q007 requires accepted exact cost policy before net metrics render", () => {
  const costed = outcome({ costs: { version: "cost-v1", base: { entryCostRate: 0.01, exitCostRate: 0.01 } } });
  const blocked = buildResearchEvidenceReport({ metadata: { version: "r", q007CostStatus: "not_configured" }, outcomes: [costed] }).report;
  assert.equal(blocked.sections.evidenceClasses.shadow.metrics.baseNetReturn, null);
  assert.throws(() => buildResearchEvidenceReport({ metadata: { version: "r", q007CostStatus: "accepted" }, outcomes: [costed] }), /approvedCostPolicyVersion/);
  const wrong = buildResearchEvidenceReport({ metadata: { version: "r", q007CostStatus: "accepted", approvedCostPolicyVersion: "cost-v2" }, outcomes: [costed] }).report;
  assert.equal(wrong.sections.evidenceClasses.shadow.metrics.baseNetReturn, null);
  const accepted = buildResearchEvidenceReport({ metadata: { version: "r", q007CostStatus: "accepted", approvedCostPolicyVersion: "cost-v1" }, outcomes: [costed] }).report;
  assert.equal(Number.isFinite(accepted.sections.evidenceClasses.shadow.metrics.baseNetReturn), true);
});

test("private exclusion text is taxonomized and Markdown renders negative and null metrics", () => {
  const excluded = outcome({ observationId: "obs-excluded", excluded: true, exclusionReason: "private thesis: CEO health", entry: null, exit: null, benchmarkEntry: null, benchmarkExit: null, securityPath: [] });
  const built = buildResearchEvidenceReport({ metadata: { version: "r" }, outcomes: [excluded, outcome()] });
  assert.deepEqual(built.report.sections.dataCoverage.exclusions, { other: 1 });
  assert.doesNotMatch(`${JSON.stringify(built.report)}${built.markdown}`, /CEO health|private thesis/i);
  assert.match(built.markdown, /grossReturn: -0\.1/);
  assert.match(built.markdown, /baseNetReturn: null/);
  assert.match(built.markdown, /Confidence intervals: "not_configured"/);
});

test("read-only CLI derives deterministic asOf and emits a content hash", () => {
  const source = readFileSync(new URL("../scripts/research-evidence-report.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /new Date\(\)\.toISOString|--detailed/);
  assert.match(source, /contentHash/);
  assert.match(source, /latestTimestamp/);
});
