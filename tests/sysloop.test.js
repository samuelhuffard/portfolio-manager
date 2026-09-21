import { test } from "node:test";
import assert from "node:assert/strict";
import { assertSentinelPublished } from "../jobs/system-sentinel.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { normalizeLine, fingerprintLine, clusterLogLines, isKnownYahooValidationNoise } from "../lib/sysloop/fingerprint.js";
import {
  checkPm2, checkHealthDeps, checkJobFreshness, checkDashboard, checkApprovalsFlow,
  checkCompanionHeartbeat, checkRedisQueue, checkProposalLifecycle, checkSheetsSchema,
  checkSheetsFreshness, checkLogClusters, checkDocPaths, runChecks, checkPhase0Throughput,
  checkReconciliationQueue, checkResearchDataHealth, checkTrackedFindings,
  checkExitMonitorCoverage, checkPhase0ObservationContinuity,
} from "../lib/sysloop/checks.js";

test("checkReconciliationQueue is quiet when empty, P1 per open item, fail-closed on unreadable", () => {
  assert.deepEqual(checkReconciliationQueue({ openReconciliations: [] }), []);
  const out = checkReconciliationQueue({
    openReconciliations: [{ orderId: "o1", proposalId: "p1", ticker: "NVDA", reason: "lots not updated", verified: true }],
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].severity, "P1");
  assert.match(out[0].title, /NVDA/);
});

test("checkReconciliationQueue fails closed when the queue is unreadable (null)", () => {
  // Codex blocker 2: null (unreadable) must NOT read as all-clear.
  const nullCase = checkReconciliationQueue({ openReconciliations: null });
  assert.equal(nullCase.length, 1);
  assert.match(nullCase[0].title, /input UNKNOWN/);
  assert.equal(checkReconciliationQueue({}).length, 1); // undefined too
});

test("checkReconciliationQueue flags a record that failed verify-on-read as an integrity P1", () => {
  // Codex blocker 3: an unverified/tampered record is MORE alarming, not dropped.
  const out = checkReconciliationQueue({
    openReconciliations: [{ orderId: "o2", ticker: "AMD", verified: false }],
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].severity, "P1");
  assert.match(out[0].title, /FAILED integrity check/);
});

test("checkPhase0Throughput stays quiet early in the window", () => {
  assert.deepEqual(
    checkPhase0Throughput({ actionableProposals: 0, evaluatorApprovals: 0, tradingDaysElapsed: 3 }),
    []
  );
});

test("checkPhase0Throughput flags a maturing window that hasn't proven throughput", () => {
  const out = checkPhase0Throughput({ actionableProposals: 1, evaluatorApprovals: 0, tradingDaysElapsed: 9 });
  assert.equal(out.length, 1);
  assert.equal(out[0].severity, "P2");
  assert.match(out[0].detail, /1\/3 actionable proposals and 0\/1 evaluator APPROVE/);
});

test("checkPhase0Throughput passes when the bar is met", () => {
  assert.deepEqual(
    checkPhase0Throughput({ actionableProposals: 4, evaluatorApprovals: 2, tradingDaysElapsed: 10 }),
    []
  );
});

test("checkPhase0Throughput fails closed on unreadable counts", () => {
  const out = checkPhase0Throughput({ tradingDaysElapsed: 9 });
  assert.equal(out.length, 1);
  assert.match(out[0].title, /input UNKNOWN/);
});
import { upsertFindings, loadFindings, openFindingsSummary, renderFixlist } from "../lib/sysloop/findings.js";

const NOW = Date.parse("2026-07-06T22:15:00Z"); // 18:15 ET on a Monday
const ET = { date: "2026-07-06", hour: 18, minute: 15, weekday: "Mon", iso: "2026-07-06T22:15:00Z" };

test("system sentinel refuses to report a successful scheduled run without durable publication", () => {
  assert.equal(assertSentinelPublished(true), true);
  assert.throws(() => assertSentinelPublished(false), /not durably published/);
});

// ── fingerprinting ───────────────────────────────────────────────────────────

test("same error with different timestamps/ids fingerprints identically", () => {
  const a = "[2026-07-01T21:15:03Z] [Research] Scan error: 401 for req 4f3a9b2c11de";
  const b = "[2026-07-05T09:02:47Z] [Research] Scan error: 401 for req aa00bb11cc22";
  assert.equal(fingerprintLine(a), fingerprintLine(b));
});

test("different errors fingerprint differently", () => {
  assert.notEqual(fingerprintLine("[Research] Scan error: 401"), fingerprintLine("[Holdings] ENOENT python3"));
});

test("normalizeLine strips volatile tokens", () => {
  const n = normalizeLine("2026-07-05 18:15:22 order 4be2a1c9-0d3f-4a1b-9c8d-aa00bb11cc22 filled at $190.55");
  assert.ok(!/2026/.test(n) && !/190/.test(n) && !/4be2a1c9/.test(n), n);
});

test("normalizeLine collapses ticker-specific variants", () => {
  assert.equal(
    normalizeLine("[Athena] request for NVDA failed in news:NVDA"),
    normalizeLine("[Athena] request for AMD failed in news:AMD")
  );
});

test("clusterLogLines groups and counts", () => {
  const clusters = clusterLogLines([
    "[Research] error: 401 at 10:00:01", "[Research] error: 401 at 11:30:02", "[Holdings] ENOENT",
  ]);
  assert.equal(clusters.length, 2);
  assert.equal(clusters[0].count, 2);
});

test("Yahoo validation notice clusters are provider degradation, never P1 growth", () => {
  const noticeLines = [
    "The following result did not validate with schema: #/definitions/QuoteSummaryResult",
    "missing netSharePurchaseActivity.netInstSharesBuying",
    "missing netSharePurchaseActivity.netInstBuyingPercent",
    "Additionally, your yahoo-finance2 version out of date: 3.15.4 < 4.0.0",
  ];
  assert.equal(isKnownYahooValidationNoise(noticeLines[0]), true);
  assert.equal(isKnownYahooValidationNoise("HTTP 503 upstream unavailable"), false);
  const clusters = clusterLogLines(Array.from({ length: 12 }, () => noticeLines).flat());
  const out = checkLogClusters({
    clusters: clusters.map((cluster) => ({ ...cluster, count: 12 })),
    prevClusters: clusters.map((cluster) => ({ fingerprint: cluster.fingerprint, count: 2 })),
  });
  assert.ok(out.length > 0);
  assert.ok(out.every((finding) => finding.severity === "P2"));
  assert.ok(out.every((finding) => /Yahoo provider-data degradation/.test(finding.title)));
  assert.ok(out.every((finding) => !/growing fast/.test(finding.title)));
});

// ── fail-closed on unavailable inputs ────────────────────────────────────────

test("every check fails closed when its input is missing", () => {
  const anomalies = runChecks({
    pm2: {}, health: {}, jobs: {}, dashboard: {}, approvals: {}, companion: {},
    redisQueue: {}, lifecycle: {}, sheetsSchema: {}, sheetsFreshness: {}, logs: {}, docs: {},
  });
  assert.ok(anomalies.length >= 10, `expected >=10 unavailable anomalies, got ${anomalies.length}`);
  assert.ok(anomalies.every((a) => a.severity !== undefined && a.fingerprint));
});

// ── individual checks ────────────────────────────────────────────────────────

test("pm2: offline, missing baselines, and every unexplained restart delta are P1", () => {
  const offline = checkPm2({ processes: [{ name: "portfolio-manager", pm2_env: { status: "errored", restart_time: 4 } }] });
  assert.equal(offline[0].severity, "P1");
  const flapping = checkPm2({
    processes: [{ name: "portfolio-manager", pm2_env: { status: "online", restart_time: 9, unstable_restarts: 4, exit_code: 1 } }],
    prevRestarts: 2,
    prevUnstableRestarts: 0,
  });
  assert.equal(flapping[0].severity, "P1");
  const controlled = checkPm2({
    processes: [{ name: "portfolio-manager", pm2_env: { status: "online", restart_time: 9, unstable_restarts: 0, exit_code: 0 } }],
    prevRestarts: 2,
    prevUnstableRestarts: 0,
  });
  assert.equal(controlled[0].severity, "P1");
  assert.match(controlled[0].title, /cause.*untrusted/i);
  const unexplained = checkPm2({
    processes: [{ name: "portfolio-manager", pm2_env: { status: "online", restart_time: 9 } }],
    prevRestarts: 2,
  });
  assert.equal(unexplained[0].severity, "P1");
  assert.match(unexplained[0].title, /cause.*untrusted/i);
  const missingBaseline = checkPm2({
    processes: [{ name: "portfolio-manager", pm2_env: { status: "online", restart_time: 9, unstable_restarts: 0, exit_code: 0 } }],
  });
  assert.equal(missingBaseline[0].severity, "P1");
  assert.match(missingBaseline[0].title, /baseline.*unavailable/i);
  const missingUnstableBaseline = checkPm2({
    processes: [{ name: "portfolio-manager", pm2_env: { status: "online", restart_time: 9, unstable_restarts: 0, exit_code: 0 } }],
    prevRestarts: 2,
  });
  assert.match(missingUnstableBaseline[0].title, /cause.*untrusted/i);
  const missingRestartMetadata = checkPm2({
    processes: [{ name: "portfolio-manager", pm2_env: { status: "online", unstable_restarts: 0, exit_code: 0 } }],
  });
  assert.match(missingRestartMetadata[0].title, /metadata.*unavailable/i);
  const resetCounter = checkPm2({
    processes: [{ name: "portfolio-manager", pm2_env: { status: "online", restart_time: 1, unstable_restarts: 0, exit_code: 0 } }],
    prevRestarts: 9,
    prevUnstableRestarts: 0,
  });
  assert.equal(resetCounter[0].severity, "P1");
  assert.match(resetCounter[0].title, /baseline.*reset/i);
  const healthy = checkPm2({ processes: [{ name: "portfolio-manager", pm2_env: { status: "online", restart_time: 2 } }], prevRestarts: 2 });
  assert.equal(healthy.length, 0);
});

test("health: any false dep is a single P1 naming the deps", () => {
  const out = checkHealthDeps({ health: { deps: { redis: true, anthropicKey: false, telegram: false } } });
  assert.equal(out.length, 1);
  assert.equal(out[0].severity, "P1");
  assert.match(out[0].title, /anthropicKey, telegram/);
  assert.equal(checkHealthDeps({ health: { deps: { redis: true } } }).length, 0);
});

test("research-data health: disabled and fresh completed status are quiet", () => {
  const nowMs = Date.parse("2026-07-13T22:00:00Z");
  assert.deepEqual(checkResearchDataHealth({ researchData: { state: "disabled" }, enabled: false, nowMs }), []);
  assert.deepEqual(checkResearchDataHealth({
    nowMs, enabled: true,
    researchData: {
      state: "completed", completedAt: "2026-07-13T20:00:00Z",
      cataloged: 100, classified: 80, metricRows: 80,
    },
  }), []);
  const unconfigured = checkResearchDataHealth({ researchData: { state: "not_configured", reason: "baseline_unavailable" }, enabled: false, nowMs });
  assert.equal(unconfigured[0].severity, "P2");
  assert.match(unconfigured[0].title, /not configured/);
});

test("research-data health flags missing status once its prerequisites are enabled", () => {
  const out = checkResearchDataHealth({ researchData: null, enabled: true, nowMs: Date.parse("2026-07-13T22:00:00Z") });
  assert.equal(out.length, 1);
  assert.equal(out[0].severity, "P2");
  assert.match(out[0].title, /status is missing/);
});

test("research-data health flags stale, failed, and implausible aggregate counts", () => {
  const nowMs = Date.parse("2026-07-13T22:00:00Z");
  const stale = checkResearchDataHealth({
    nowMs, enabled: true,
    researchData: { state: "completed", completedAt: "2026-07-11T00:00:00Z", cataloged: 100, classified: 80, metricRows: 80 },
  });
  assert.match(stale[0].title, /stale/);
  const failed = checkResearchDataHealth({ researchData: { state: "failed", failureStage: "peer-distributions" }, enabled: true, nowMs });
  assert.equal(failed[0].severity, "P2");
  const implausible = checkResearchDataHealth({
    nowMs, enabled: true,
    researchData: { state: "completed", completedAt: "2026-07-13T21:00:00Z", cataloged: 10, classified: 12, metricRows: 12 },
  });
  assert.equal(implausible[0].severity, "P2");
  assert.match(implausible[0].title, /implausible/);
});

test("cron freshness: missing, missed, and failed runs are flagged", () => {
  const lastRuns = {
    "premarket-check": { dateET: "2026-07-06", ok: true, ts: "2026-07-06T12:30:00Z" },
    "holdings-sync": { dateET: "2026-07-03", ok: true, ts: "2026-07-03T20:30:00Z" }, // missed today
    "research-scan": { dateET: "2026-07-06", ok: false, error: "boom", ts: "2026-07-06T21:15:00Z" },
    "weekly-review": { dateET: "2026-07-03", ok: true, ts: "2026-07-03T22:30:00Z" },
    "intraday-monitor": { dateET: "2026-07-06", ok: true, ts: "2026-07-06T19:50:00Z" },
    "exit-monitor": { dateET: "2026-07-06", ok: true, ts: "2026-07-06T20:45:00Z" },
    "performance-review": { dateET: "2026-07-06", ok: true, ts: "2026-07-06T21:45:00Z" },
    // verify-ledgers absent entirely
  };
  const out = checkJobFreshness({ lastRuns, nowET: ET, isTradingDay: true });
  const titles = out.map((a) => a.title).join(" | ");
  assert.match(titles, /holdings-sync did not run today/);
  assert.match(titles, /research-scan failed/);
  assert.match(titles, /verify-ledgers has never recorded/);
  assert.ok(!/premarket-check/.test(titles));
  const researchFailure = out.find((row) => /research-scan failed/.test(row.title));
  const ledgerFailure = out.find((row) => /verify-ledgers has never/.test(row.title));
  assert.equal(researchFailure.severity, "P2");
  assert.equal(ledgerFailure.severity, "P1");
});

test("cron freshness: weekend runs are quiet", () => {
  const out = checkJobFreshness({ lastRuns: {}, nowET: { ...ET, weekday: "Sat" }, isTradingDay: false });
  assert.equal(out.length, 0);
});

test("cron freshness does not expect Mon-Thu research jobs on Friday", () => {
  const friday = { ...ET, date: "2026-07-10", weekday: "Fri", iso: "2026-07-10T22:15:00Z" };
  const lastRuns = Object.fromEntries(
    Object.keys({
      "premarket-check": 1,
      "holdings-sync": 1,
      "intraday-monitor": 1,
      "performance-review": 1,
      "verify-ledgers": 1,
    }).map((job) => [job, { dateET: friday.date, ok: true, ts: friday.iso }])
  );
  lastRuns["weekly-review"] = { dateET: "2026-07-03", ok: true, ts: "2026-07-03T22:30:00Z" };
  const titles = checkJobFreshness({ lastRuns, nowET: friday, isTradingDay: true }).map((a) => a.title).join(" | ");
  assert.doesNotMatch(titles, /exit-monitor|research-scan/);
});

test("research-data receipt exposes a completed but not-configured workflow as a P2 finding", () => {
  const nowET = { ...ET, hour: 20, minute: 10, weekday: "Mon" };
  const out = checkJobFreshness({
    nowET,
    isTradingDay: true,
    lastRuns: {
      "research-data-refresh": {
        dateET: nowET.date,
        ok: true,
        outcome: "not_configured",
        outcomeReason: "baseline_provenance_invalid",
      },
    },
  });
  const finding = out.find((row) => row.check === "cron" && /research-data-refresh/.test(row.title));
  assert.equal(finding?.severity, "P2");
  assert.match(finding?.title ?? "", /not_configured/);
});

test("a classified partial research scan is P2 even though its process receipt is ok false", () => {
  const nowET = { ...ET, hour: 18, minute: 15, weekday: "Mon" };
  const out = checkJobFreshness({
    nowET,
    isTradingDay: true,
    lastRuns: {
      "research-scan": {
        dateET: nowET.date,
        ok: false,
        outcome: "degraded",
        outcomeReason: "partial_review_failures",
        error: "Job failed; see logs.",
      },
    },
  });
  const finding = out.find((row) => row.check === "cron" && /research-scan/.test(row.title));
  assert.equal(finding?.severity, "P2");
  assert.match(finding?.title ?? "", /outcome degraded/);
  assert.doesNotMatch(finding?.detail ?? "", /Job failed/);
});

test("prior trading-day observation continuity is a visible P2 without recoupling the next TRUST day to host availability", () => {
  assert.deepEqual(checkPhase0ObservationContinuity({
    observedDates: ["2026-09-17", "2026-09-16"], expectedPriorDate: "2026-09-17",
  }), []);
  const missing = checkPhase0ObservationContinuity({
    observedDates: ["2026-09-17", "2026-09-16"], expectedPriorDate: "2026-09-18",
  });
  assert.equal(missing.length, 1);
  assert.equal(missing[0].severity, "P2");
  assert.match(missing[0].title, /2026-09-18/);
  const unreadable = checkPhase0ObservationContinuity({ expectedPriorDate: "2026-09-18" });
  assert.equal(unreadable[0].severity, "P2");
});

test("exit-monitor all-degraded coverage is a P1 even when its receipt completed", () => {
  const nowET = { ...ET, hour: 18, minute: 15, weekday: "Mon" };
  const allDegraded = {
    "exit-monitor": {
      dateET: nowET.date,
      ok: true,
      evidence: {
        holdingMonitoring: {
          schemaVersion: "holding-monitor-coverage-v1",
          expected: 2,
          monitored: 0,
          degraded: 2,
          failed: 0,
          accounted: 2,
          silentSkipped: 0,
          overflow: 0,
          reasonTotal: 2,
          reasonAccountingComplete: true,
          complete: true,
          reasons: { mandate_holding_evidence_incomplete: 2 },
        },
      },
    },
  };
  const out = checkExitMonitorCoverage({ lastRuns: allDegraded, nowET, isTradingDay: true });
  assert.equal(out.length, 1);
  assert.equal(out[0].severity, "P1");
  assert.match(out[0].title, /degraded every held position/);
});

test("exit-monitor partial degradation is P2 and Friday is not an exit-monitor day", () => {
  const coverage = {
    schemaVersion: "holding-monitor-coverage-v1",
    expected: 2,
    monitored: 1,
    degraded: 1,
    failed: 0,
    accounted: 2,
    silentSkipped: 0,
    overflow: 0,
    reasonTotal: 1,
    reasonAccountingComplete: true,
    complete: true,
    reasons: { mandate_holding_evidence_incomplete: 1 },
  };
  const run = { "exit-monitor": { dateET: ET.date, evidence: { holdingMonitoring: coverage } } };
  assert.equal(checkExitMonitorCoverage({ lastRuns: run, nowET: ET, isTradingDay: true })[0].severity, "P2");
  assert.deepEqual(checkExitMonitorCoverage({
    lastRuns: run,
    nowET: { ...ET, weekday: "Fri" },
    isTradingDay: true,
  }), []);
});

test("dashboard: signed-out 200 on an auth route is P0", () => {
  const out = checkDashboard({
    probes: [
      { path: "/", status: 307, location: "/sign-in", ms: 120 },
      { path: "/sign-in", status: 200, ms: 100 },
      { path: "/api/portfolio", status: 200, ms: 90 }, // leak!
      { path: "/api/proposals", status: 401, ms: 80 },
    ],
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].severity, "P0");
  assert.match(out[0].title, /SECURITY/);
});

test("dashboard: healthy posture produces zero anomalies", () => {
  const out = checkDashboard({
    probes: [
      { path: "/", status: 307, location: "https://x/sign-in?y", ms: 120 },
      { path: "/sign-in", status: 200, ms: 100 },
      { path: "/api/portfolio", status: 401, ms: 90 },
      { path: "/api/proposals", status: 401, ms: 80 },
    ],
  });
  assert.equal(out.length, 0);
});

test("approvals: stuck Executing is P1, approved-unexecuted needs market hours", () => {
  const old = new Date(NOW - 45 * 60000).toISOString();
  const proposals = [
    { id: "a", ticker: "NVDA", side: "BUY", status: "ApprovedForBrokerReview", executionState: "Executing", createdAt: old, updatedAt: old },
    { id: "b", ticker: "AMD", side: "BUY", status: "ApprovedForBrokerReview", createdAt: old, decidedAt: old },
  ];
  const open = checkApprovalsFlow({ proposals, nowMs: NOW, marketOpen: true });
  assert.ok(open.some((a) => a.severity === "P1" && /stuck in Executing/.test(a.title)));
  assert.ok(open.some((a) => a.severity === "P1" && /unexecuted/.test(a.title)));
  const closed = checkApprovalsFlow({ proposals: [proposals[1]], nowMs: NOW, marketOpen: false });
  assert.equal(closed.length, 0);
});

test("companion: offline with approved work during market hours is P1", () => {
  const out = checkCompanionHeartbeat({ lastSeenMs: NOW - 20 * 60000, nowMs: NOW, approvedWaiting: true, marketOpen: true });
  assert.equal(out[0].severity, "P1");
  const idle = checkCompanionHeartbeat({ lastSeenMs: NOW - 20 * 60000, nowMs: NOW, approvedWaiting: false, marketOpen: false });
  assert.equal(idle.length, 0);
});

test("redis queue: schema drift and unknown breaker tier are P1", () => {
  const out = checkRedisQueue({
    listIds: ["x", "y"],
    records: { x: { id: "x", ticker: "NVDA", side: "BUY", status: "Pending", createdAt: "2026-07-06", amountDollars: 25 } }, // y orphaned
    breakerState: { tier: "MYSTERY" },
    hwm: { value: "not-a-number" },
  });
  assert.ok(out.some((a) => /no record/.test(a.title) && a.severity === "P2"));
  assert.ok(out.some((a) => /unknown tier/.test(a.title) && a.severity === "P1"));
  assert.ok(out.some((a) => /high-water mark/.test(a.title) && a.severity === "P1"));
});

test("lifecycle: unsigned approval and missing ledger row are P1", () => {
  const out = checkProposalLifecycle({
    proposals: [
      { id: "p1", ticker: "NVDA", side: "BUY", status: "ApprovedForBrokerReview", decisionHmac: null },
      { id: "p2", ticker: "AMD", side: "BUY", status: "ApprovedForBrokerReview", decisionHmac: "sig", fulfilledAt: "2026-07-06", fulfilledOrderId: "ord-9" },
    ],
    ledgerOrderIds: ["ord-1"],
  });
  assert.ok(out.some((a) => /no decision signature/.test(a.title)));
  assert.ok(out.some((a) => /missing from Trade Ledger/.test(a.title)));
});

test("sheets: header drift is P1 with column pinpointed", () => {
  const out = checkSheetsSchema({
    tabHeaders: { Performance: ["Date", "Portfolio Value", "WRONG", "Units Outstanding", "NAV per Unit"] },
    expected: { Performance: { row: 1, headers: ["Date", "Portfolio Value", "S&P 500 (SPY)", "Units Outstanding", "NAV per Unit"] } },
  });
  assert.equal(out[0].severity, "P1");
  assert.match(out[0].title, /column 3/);
});

test("sheets freshness: stale NAV row flagged, current is quiet", () => {
  assert.equal(checkSheetsFreshness({ performanceLastDate: "2026-07-02", lastTradingDay: "2026-07-06" })[0].severity, "P2");
  assert.equal(checkSheetsFreshness({ performanceLastDate: "2026-07-06", lastTradingDay: "2026-07-06" }).length, 0);
});

test("logs: new cluster is P2, 3x growth is P1, stable clusters quiet", () => {
  const out = checkLogClusters({
    clusters: [
      { fingerprint: "aaa", exemplar: "boom", count: 15 },
      { fingerprint: "bbb", exemplar: "fresh", count: 2 },
      { fingerprint: "ccc", exemplar: "steady", count: 4 },
    ],
    prevClusters: [{ fingerprint: "aaa", count: 4 }, { fingerprint: "ccc", count: 4 }],
  });
  assert.ok(out.some((a) => a.severity === "P1" && /growing/.test(a.title)));
  assert.ok(out.some((a) => a.severity === "P2" && /New error cluster/.test(a.title)));
  assert.equal(out.length, 2);
});

test("docs: missing referenced paths are P3", () => {
  const out = checkDocPaths({ missingRefs: [{ path: "lib/gone.js", doc: "docs/RUNBOOK.md" }] });
  assert.equal(out[0].severity, "P3");
});

test("tracked open P0/P1 findings remain active sentinel anomalies with the same fingerprint", () => {
  const out = checkTrackedFindings({ open: [
    { id: "F-2026-095", severity: "P1", status: "open", title: "Rotate exposed credentials", file: "finding.md", fingerprint: "5e76eca847f8" },
    { id: "F-2026-096", severity: "P2", status: "open", title: "Lower priority", file: "other.md", fingerprint: "abcdef123456" },
  ] });
  assert.deepEqual(out, [{
    check: "tracked-finding",
    severity: "P1",
    title: "Tracked finding F-2026-095: Rotate exposed credentials",
    detail: "status=open; details=ops/findings/finding.md",
    fingerprint: "5e76eca847f8",
  }]);
});

// ── findings ledger ──────────────────────────────────────────────────────────

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "sysloop-findings-"));
}
const anomalyFixture = { check: "health", severity: "P1", title: "Backend deps down", detail: "anthropicKey false", fingerprint: "deadbeef1234" };

test("findings: new anomaly creates an open finding file", () => {
  const dir = tmpDir();
  const { created } = upsertFindings(dir, [anomalyFixture], new Date("2026-07-06T22:15:00Z"));
  assert.equal(created.length, 1);
  assert.equal(created[0].id, "F-2026-001");
  const all = loadFindings(dir);
  assert.equal(all.length, 1);
  assert.equal(all[0].meta.status, "open");
  assert.match(all[0].body, /anthropicKey false/);
});

test("findings: recurrence increments occurrences, no duplicate file", () => {
  const dir = tmpDir();
  upsertFindings(dir, [anomalyFixture], new Date("2026-07-06T22:15:00Z"));
  const { created, updated } = upsertFindings(dir, [anomalyFixture], new Date("2026-07-07T22:15:00Z"));
  assert.equal(created.length, 0);
  assert.equal(updated.length, 1);
  assert.equal(loadFindings(dir)[0].meta.occurrences, 2);
});

test("findings: a fixed finding that reappears regresses and escalates", () => {
  const dir = tmpDir();
  upsertFindings(dir, [{ ...anomalyFixture, severity: "P2" }], new Date("2026-07-06T22:15:00Z"));
  const f = loadFindings(dir)[0];
  fs.writeFileSync(path.join(dir, f.file), fs.readFileSync(path.join(dir, f.file), "utf8").replace("status: open", "status: fixed"));
  const { regressed } = upsertFindings(dir, [{ ...anomalyFixture, severity: "P2" }], new Date("2026-07-08T22:15:00Z"));
  assert.equal(regressed.length, 1);
  const after = loadFindings(dir)[0];
  assert.equal(after.meta.status, "regressed");
  assert.equal(after.meta.severity, "P1"); // bumped one level
});

test("findings: duplicate fingerprints within one run collapse to one occurrence", () => {
  const dir = tmpDir();
  upsertFindings(dir, [anomalyFixture, { ...anomalyFixture, detail: "second copy" }], new Date());
  assert.equal(loadFindings(dir)[0].meta.occurrences, 1);
});

test("renderFixlist: open items get checkboxes, fixed items land in regression watch", () => {
  const dir = tmpDir();
  upsertFindings(dir, [
    { ...anomalyFixture, fingerprint: "aaa111", severity: "P1", title: "broken thing" },
    { ...anomalyFixture, fingerprint: "bbb222", severity: "P3", title: "fixed thing" },
  ], new Date("2026-07-06T22:15:00Z"));
  const f = loadFindings(dir).find((x) => x.meta.title === "fixed thing");
  fs.writeFileSync(path.join(dir, f.file), fs.readFileSync(path.join(dir, f.file), "utf8").replace("status: open", "status: fixed"));
  const md = renderFixlist({ findingsDir: dir });
  assert.match(md, /## Needs attention\n\n- \[ \] \*\*P1\*\* `F-2026-001`/);
  assert.match(md, /## Recently fixed[\s\S]*fixed thing/);
  assert.match(md, /1 need attention/);
  assert.ok(md.indexOf("broken thing") < md.indexOf("Recently fixed"));
});

test("renderFixlist: regressed items are flagged and empty ledger renders clean", () => {
  const dir = tmpDir();
  const md = renderFixlist({ findingsDir: dir });
  assert.match(md, /\(none — clean\)/);
  upsertFindings(dir, [anomalyFixture], new Date("2026-07-06T22:15:00Z"));
  const f = loadFindings(dir)[0];
  fs.writeFileSync(path.join(dir, f.file), fs.readFileSync(path.join(dir, f.file), "utf8").replace("status: open", "status: fixed"));
  upsertFindings(dir, [anomalyFixture], new Date("2026-07-08T22:15:00Z"));
  assert.match(renderFixlist({ findingsDir: dir }), /\*\*REGRESSED\*\*/);
});

test("openFindingsSummary sorts by severity and excludes fixed", () => {
  const dir = tmpDir();
  upsertFindings(dir, [
    { ...anomalyFixture, fingerprint: "aaa111", severity: "P3", title: "minor" },
    { ...anomalyFixture, fingerprint: "bbb222", severity: "P1", title: "major" },
  ], new Date());
  const summary = openFindingsSummary(dir);
  assert.equal(summary[0].severity, "P1");
  assert.equal(summary.length, 2);
});
