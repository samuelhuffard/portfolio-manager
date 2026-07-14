// Pure, aggregate-safe E7.3 evidence rendering. Inputs are injected; this
// module has no database, market-data, scheduler, proposal, or execution edge.

import { canonicalJson, contentHash } from "./research-version.js";

const CLASSES = ["backtest", "shadow", "paper", "realized_live"];
const STATUSES = ["matured", "immature", "unavailable", "excluded"];
const EXCLUSION_CODES = new Set(["excluded_by_caller", "ineligible", "budget_exempt", "holding", "mandatory_reunderwrite"]);

function plain(value, field) { try { canonicalJson(value); } catch (error) { throw new TypeError(`${field} must be canonical JSON: ${error.message}`); } return value; }
function stable(value) { return [...value].sort((a, b) => canonicalJson(a).localeCompare(canonicalJson(b))); }
function label(value) { return value == null || String(value).trim() === "" ? "not_recorded" : String(value).trim(); }
function avg(values) { const finite = values.filter(Number.isFinite); return finite.length ? Number((finite.reduce((sum, value) => sum + value, 0) / finite.length).toFixed(12)) : null; }
function empty(state = "not_configured") { return { state, sampleCount: 0, missingCount: 0, excludedCount: 0 }; }
function policy(outcome) { return outcome.policyVersions ?? {}; }
function strata(outcome) { return outcome.strata ?? {}; }
function outcomeClass(outcome) {
  const value = outcome.evidenceClass;
  if (!CLASSES.includes(value)) throw new TypeError("outcome.evidenceClass must be explicit and supported");
  return value;
}
function time(value, field) { const parsed = Date.parse(value); if (!Number.isFinite(parsed)) throw new TypeError(`${field} must be a timestamp`); return parsed; }

function snapshotIdentity(outcome, index) {
  const identity = outcome.identity ?? {};
  if (!identity.observationId && !identity.selectionItemId) throw new TypeError(`outcomes[${index}] requires observation or selection-item lineage`);
  const p = policy(outcome);
  if (!p.horizon || !p.benchmark) throw new TypeError(`outcomes[${index}] requires horizon and benchmark policy versions`);
  return {
    observationId: identity.observationId ?? null,
    selectionItemId: identity.selectionItemId ?? null,
    comparisonPairId: identity.comparisonPairId ?? null,
    securityId: identity.securityId ?? identity.ticker ?? null,
    agentId: identity.agentId ?? strata(outcome).agentId ?? null,
    evidenceClass: outcomeClass(outcome),
    policyVersions: { horizon: p.horizon, benchmark: p.benchmark, hit: p.hit ?? null, cost: p.cost ?? null },
    mandateVersion: strata(outcome).mandateVersion ?? null,
    scoringVersion: strata(outcome).scoringVersion ?? null,
  };
}

function latestSnapshots(outcomes) {
  const latest = new Map();
  outcomes.forEach((outcome, index) => {
    plain(outcome, `outcomes[${index}]`);
    if (!STATUSES.includes(outcome.status)) throw new TypeError(`outcomes[${index}].status is unsupported`);
    const key = canonicalJson(snapshotIdentity(outcome, index));
    const rank = [time(outcome.asOf, `outcomes[${index}].asOf`), time(outcome.createdAt ?? outcome.asOf, `outcomes[${index}].createdAt`)];
    const prior = latest.get(key);
    if (prior && rank[0] === prior.rank[0] && rank[1] === prior.rank[1] && canonicalJson(prior.outcome) !== canonicalJson(outcome)) {
      throw new TypeError(`outcomes[${index}] conflicts with another snapshot at the same asOf and createdAt`);
    }
    if (!prior || rank[0] > prior.rank[0] || (rank[0] === prior.rank[0] && rank[1] > prior.rank[1])) latest.set(key, { outcome, rank });
  });
  return stable([...latest.values()].map((entry) => entry.outcome));
}

function metricSummary(rows, costGate) {
  const matured = rows.filter((row) => row.status === "matured" && row.metrics && typeof row.metrics === "object" && !Array.isArray(row.metrics));
  const costVersioned = costGate.accepted ? matured.filter((row) => policy(row).cost === costGate.policyVersion) : [];
  const values = (name, candidates = matured) => candidates.map((row) => row.metrics?.[name]).filter(Number.isFinite);
  return {
    grossReturn: avg(values("forwardTotalReturn")), excessReturn: avg(values("forwardExcessReturn")),
    drawdown: avg(values("maxDrawdown")), turnover: avg(values("turnover")),
    baseNetReturn: avg(values("baseNetReturn", costVersioned)), stressedNetReturn: avg(values("stressedNetReturn", costVersioned)),
    costPolicyVersion: costGate.accepted ? costGate.policyVersion : null,
  };
}

function labelsFor(outcome) {
  const s = strata(outcome); const p = policy(outcome);
  return {
    evidenceClass: outcomeClass(outcome), agentId: label(s.agentId ?? outcome.identity?.agentId), mandateVersion: label(s.mandateVersion),
    scoreBand: label(s.scoreBand), deltaCause: label(s.deltaCause), regime: label(s.regime), completeness: label(s.scoreCompleteness),
    scoringVersion: label(s.scoringVersion), horizonPolicyVersion: label(p.horizon), benchmarkPolicyVersion: label(p.benchmark),
    hitPolicyVersion: label(p.hit), costPolicyVersion: label(p.cost),
  };
}

function groupOutcomes(outcomes, costGate) {
  const groups = new Map();
  for (const outcome of outcomes) { const labels = labelsFor(outcome); const key = canonicalJson(labels); if (!groups.has(key)) groups.set(key, { labels, rows: [] }); groups.get(key).rows.push(outcome); }
  return stable([...groups.values()].map(({ labels, rows }) => ({ labels, counts: {
    sample: rows.length, matured: rows.filter((row) => row.status === "matured").length, missing: rows.filter((row) => row.status === "unavailable").length,
    excluded: rows.filter((row) => row.status === "excluded").length, immature: rows.filter((row) => row.status === "immature").length,
  }, metrics: metricSummary(rows, costGate) })));
}

function evidenceSections(outcomes, costGate) {
  const entries = {};
  for (const evidenceClass of CLASSES) {
    const rows = outcomes.filter((outcome) => outcomeClass(outcome) === evidenceClass);
    if (!rows.length) { entries[evidenceClass] = empty(); continue; }
    const groups = groupOutcomes(rows, costGate);
    entries[evidenceClass] = { state: "available", counts: { sample: rows.length, ...Object.fromEntries(STATUSES.map((status) => [status, rows.filter((row) => row.status === status).length])) },
      metricState: groups.length === 1 ? "available" : "stratified_only", metrics: groups.length === 1 ? groups[0].metrics : null, stratumCount: groups.length };
  }
  return entries;
}

function exclusionCounts(rows) {
  const counts = {};
  for (const row of rows.filter((candidate) => candidate.status === "excluded")) {
    const code = EXCLUSION_CODES.has(String(row.reason ?? "")) ? String(row.reason) : "other";
    counts[code] = (counts[code] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

function renderMetrics(metrics) {
  if (!metrics) return ["Metrics: stratified_only"];
  return Object.entries(metrics).map(([key, value]) => `${key}: ${value == null ? "null" : value}`);
}

function counterfactualSection(value) {
  if (value == null) return empty();
  plain(value, "counterfactualResults");
  const numeric = (object) => Object.fromEntries(Object.entries(object ?? {}).filter(([, item]) => item == null || Number.isFinite(item)).sort(([a], [b]) => a.localeCompare(b)));
  const summary = value && typeof value === "object" && !Array.isArray(value) ? {
    comparisonType: typeof value.comparisonType === "string" ? value.comparisonType : "not_recorded",
    sampleCount: Number.isFinite(value.sampleCount) ? value.sampleCount : null,
    counts: numeric(value.counts), aggregate: numeric(value.aggregate),
    stratumCount: Array.isArray(value.strata) ? value.strata.length : null,
  } : null;
  return { state: "available", contentHash: contentHash(value), summary };
}

function markdown(report) {
  const coverage = report.sections.dataCoverage;
  const lines = ["# Research Evidence Report", "", `Report version: ${report.metadata.version}`, `As of: ${report.metadata.asOf ?? "not_recorded"}`, `Conclusion: ${report.conclusion}`, "",
    "## Data coverage, freshness, and exclusions", "", `State: ${coverage.state}`, `Stored snapshots: ${coverage.snapshotCount}`, `Distinct outcome samples: ${coverage.outcomeCount}`,
    `Observations: ${coverage.observationCount}`, `Freshness: ${coverage.freshness}`, `Outcome status counts: ${canonicalJson(coverage.statusCounts)}`, `Snapshot status counts: ${canonicalJson(coverage.snapshotStatusCounts)}`, `Exclusions: ${canonicalJson(coverage.exclusions)}`, "", "## Evidence classes", ""];
  for (const evidenceClass of CLASSES) {
    const entry = report.sections.evidenceClasses[evidenceClass];
    lines.push(`### ${evidenceClass}`, "", `State: ${entry.state}`, `Samples: ${entry.sampleCount ?? entry.counts.sample}`);
    if (entry.counts) lines.push(`Counts: ${canonicalJson(entry.counts)}`, `Metric state: ${entry.metricState}`, ...renderMetrics(entry.metrics));
    lines.push("");
  }
  lines.push("## Stratified results", "", `State: ${report.sections.stratifiedResults.state}`, `Confidence intervals: ${canonicalJson(report.sections.stratifiedResults.confidenceIntervals)}`);
  for (const group of report.sections.stratifiedResults.groups) lines.push("", `### ${contentHash(group.labels).slice(0, 12)}`, "", `Labels: ${canonicalJson(group.labels)}`, `Counts: ${canonicalJson(group.counts)}`, ...renderMetrics(group.metrics));
  for (const name of ["backtest", "counterfactuals", "sensitivity"]) { const section = report.sections[name]; lines.push("", `## ${name[0].toUpperCase()}${name.slice(1)}`, "", `State: ${section.state}`, `Content hash: ${section.contentHash ?? "null"}`); if (section.summary !== undefined) lines.push(`Aggregate summary: ${canonicalJson(section.summary)}`); }
  lines.push("", "## Conclusion", "", "not_assessed", "");
  return `${lines.join("\n")}\n`;
}

/** Build a deterministic report with no edge or promotion conclusion. */
export function buildResearchEvidenceReport({ metadata = {}, observations = null, outcomes = null, counterfactualResults = null, backtestArtifacts = null, sensitivity = null } = {}) {
  plain(metadata, "metadata"); if (!metadata.version || !String(metadata.version).trim()) throw new TypeError("metadata.version is required");
  if (observations != null && !Array.isArray(observations)) throw new TypeError("observations must be an array or null");
  if (outcomes != null && !Array.isArray(outcomes)) throw new TypeError("outcomes must be an array or null");
  const accepted = metadata.q007CostStatus === "accepted";
  const approvedCostPolicyVersion = metadata.approvedCostPolicyVersion == null ? null : String(metadata.approvedCostPolicyVersion).trim();
  if (accepted && !approvedCostPolicyVersion) throw new TypeError("accepted Q007 status requires approvedCostPolicyVersion");
  if (!accepted && approvedCostPolicyVersion) throw new TypeError("approvedCostPolicyVersion requires accepted Q007 status");
  const costGate = { accepted, policyVersion: approvedCostPolicyVersion };
  const snapshots = outcomes ?? [];
  const rows = outcomes == null ? [] : latestSnapshots(snapshots);
  const zeroCounts = () => Object.fromEntries(STATUSES.map((status) => [status, 0]));
  const counts = (values) => Object.fromEntries(STATUSES.map((status) => [status, values.filter((row) => row.status === status).length]));
  const dataCoverage = outcomes == null ? { ...empty(), observationCount: observations?.length ?? 0, snapshotCount: 0, outcomeCount: 0, statusCounts: zeroCounts(), snapshotStatusCounts: zeroCounts(), freshness: label(metadata.freshness), exclusions: {} } : {
    state: "available", observationCount: observations?.length ?? 0, snapshotCount: snapshots.length, outcomeCount: rows.length, statusCounts: counts(rows), snapshotStatusCounts: counts(snapshots),
    freshness: label(metadata.freshness), exclusions: exclusionCounts(rows),
  };
  const report = {
    schemaVersion: "research-evidence-report-v1", metadata: { version: String(metadata.version).trim(), asOf: metadata.asOf ?? null, methodologyVersion: metadata.methodologyVersion ?? null,
      q007CostStatus: metadata.q007CostStatus ?? "not_configured", approvedCostPolicyVersion }, conclusion: "not_assessed",
    sections: {
      dataCoverage, evidenceClasses: evidenceSections(rows, costGate),
      stratifiedResults: outcomes == null ? { ...empty(), groups: [], confidenceIntervals: "not_configured" } : { state: "available", groups: groupOutcomes(rows, costGate), confidenceIntervals: metadata.confidenceIntervals ?? "not_configured" },
      backtest: backtestArtifacts == null ? empty() : { state: "available", contentHash: contentHash(plain(backtestArtifacts, "backtestArtifacts")) },
      counterfactuals: counterfactualSection(counterfactualResults),
      sensitivity: sensitivity == null ? empty() : { state: "available", contentHash: contentHash(plain(sensitivity, "sensitivity")) },
    },
  };
  const machine = JSON.parse(canonicalJson(report)); const markdownOutput = markdown(machine);
  return { report: machine, markdown: markdownOutput, contentHash: contentHash({ report: machine, markdown: markdownOutput }) };
}

export default buildResearchEvidenceReport;
