import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { normalizeLine, fingerprintLine, clusterLogLines } from "../lib/sysloop/fingerprint.js";
import {
  checkPm2, checkHealthDeps, checkJobFreshness, checkDashboard, checkApprovalsFlow,
  checkCompanionHeartbeat, checkRedisQueue, checkProposalLifecycle, checkSheetsSchema,
  checkSheetsFreshness, checkLogClusters, checkDocPaths, runChecks,
} from "../lib/sysloop/checks.js";
import { upsertFindings, loadFindings, openFindingsSummary } from "../lib/sysloop/findings.js";

const NOW = Date.parse("2026-07-06T22:15:00Z"); // 18:15 ET on a Monday
const ET = { date: "2026-07-06", hour: 18, minute: 15, weekday: "Mon", iso: "2026-07-06T22:15:00Z" };

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

test("clusterLogLines groups and counts", () => {
  const clusters = clusterLogLines([
    "[Research] error: 401 at 10:00:01", "[Research] error: 401 at 11:30:02", "[Holdings] ENOENT",
  ]);
  assert.equal(clusters.length, 2);
  assert.equal(clusters[0].count, 2);
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

test("pm2: offline process is P1, flapping is P2", () => {
  const offline = checkPm2({ processes: [{ name: "portfolio-manager", pm2_env: { status: "errored", restart_time: 4 } }] });
  assert.equal(offline[0].severity, "P1");
  const flapping = checkPm2({ processes: [{ name: "portfolio-manager", pm2_env: { status: "online", restart_time: 9 } }], prevRestarts: 2 });
  assert.equal(flapping[0].severity, "P2");
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
});

test("cron freshness: weekend runs are quiet", () => {
  const out = checkJobFreshness({ lastRuns: {}, nowET: { ...ET, weekday: "Sat" }, isTradingDay: false });
  assert.equal(out.length, 0);
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
