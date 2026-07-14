import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getRedis, listAllProposals, getBreakerState, getPortfolioHighWaterMark, listOpenReconciliations } from "../redis.js";
import { getServiceAccountClients, resolveSharedSpreadsheetId, readPerformanceHistory, readTradeLedger, SYSLOOP_EXPECTED_HEADERS } from "../sheets.js";
import { isTradingDate } from "../market-calendar.js";
import { clusterLogLines } from "./fingerprint.js";
import { runChecks, JOB_EXPECTATIONS } from "./checks.js";

const pExecFile = promisify(execFile);

// Gathers every input the Tier-0 checks need, then runs them. All gathering is
// READ-ONLY; failures surface as null inputs so checks.js fails closed instead
// of this file deciding what's ok. The only writes the sentinel makes anywhere
// are pm:sysloop:* keys (see redisGuard below) and files under ops/.

const DASHBOARD_URL = () => (process.env.SYSLOOP_DASHBOARD_URL ?? "https://portfolio-dashboard-ivory-five.vercel.app").trim().replace(/\/$/, "");
const HEALTH_URL = () => `http://localhost:${(process.env.PORTFOLIO_SERVER_PORT ?? "3200").trim()}/health`;
const LOG_DIR = () => (process.env.SYSLOOP_LOG_DIR ?? path.join(os.homedir(), ".pm2", "logs")).trim();
const MAX_LOG_BYTES = 512 * 1024;

const STATE_KEY = "pm:sysloop:state";
const SNAPSHOT_KEY = (date) => `pm:sysloop:snapshot:${date}`;
export const LAST_RUN_KEY = "pm:sysloop:last-run";
const SNAPSHOT_TTL = 7 * 24 * 3600;

// The sentinel's entire Redis write surface. Any key outside pm:sysloop:* is a
// bug in the caller, not a judgment call — throw.
export async function redisGuardSet(redis, key, value, opts) {
  if (!key.startsWith("pm:sysloop:")) throw new Error(`sysloop attempted write outside its namespace: ${key}`);
  return redis.set(key, typeof value === "string" ? value : JSON.stringify(value), opts);
}

function etParts(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false, weekday: "short",
  }).formatToParts(now);
  const get = (t) => parts.find((p) => p.type === t)?.value;
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    hour: Number(get("hour")) % 24,
    minute: Number(get("minute")),
    weekday: get("weekday"),
    iso: now.toISOString(),
  };
}

// Weekday AND not a full-day NYSE holiday (lib/market-calendar.js).
export function isTradingDay(et) {
  return !["Sat", "Sun"].includes(et.weekday) && isTradingDate(et.date);
}

export function isMarketOpen(et) {
  if (!isTradingDay(et)) return false;
  const mins = et.hour * 60 + et.minute;
  return mins >= 9 * 60 + 30 && mins < 16 * 60;
}

export function lastTradingDayISO(now = new Date()) {
  for (let back = 0; back < 10; back++) {
    const d = new Date(now.getTime() - back * 86400000);
    const et = etParts(d);
    // Today only counts once the first holdings sync (9:30) is plausibly done.
    if (isTradingDay(et) && (back > 0 || et.hour >= 10)) return et.date;
  }
  return etParts(now).date;
}

// ── Gatherers (each returns its input slice, or null on failure) ────────────

async function gatherPm2() {
  try {
    const { stdout } = await pExecFile("pm2", ["jlist"], { timeout: 15000, maxBuffer: 8 * 1024 * 1024 });
    const list = JSON.parse(stdout);
    return list.map((p) => ({ name: p.name, pm2_env: { status: p.pm2_env?.status, restart_time: p.pm2_env?.restart_time } }));
  } catch (e) {
    console.error("[Sysloop] pm2 jlist failed:", e.message);
    return null;
  }
}

async function fetchWithTimeout(url, ms, opts = {}) {
  const started = Date.now();
  try {
    const res = await fetch(url, { ...opts, redirect: "manual", signal: AbortSignal.timeout(ms) });
    return { status: res.status, location: res.headers.get("location"), ms: Date.now() - started, body: res };
  } catch (e) {
    return { error: e.message, ms: Date.now() - started };
  }
}

async function gatherHealth() {
  const res = await fetchWithTimeout(HEALTH_URL(), 5000);
  if (res.error || res.status !== 200) {
    console.error("[Sysloop] /health probe failed:", res.error ?? `status ${res.status}`);
    return null;
  }
  try { return await res.body.json(); } catch { return null; }
}

async function gatherDashboardProbes() {
  const base = DASHBOARD_URL();
  const paths = ["/", "/sign-in", "/api/portfolio", "/api/proposals"];
  return Promise.all(paths.map(async (p) => {
    const res = await fetchWithTimeout(base + p, 10000);
    return { path: p, status: res.status, location: res.location, ms: res.ms, error: res.error };
  }));
}

async function gatherRedisSlices() {
  const redis = getRedis();
  if (!redis) return { state: null, proposals: null, listIds: null, breaker: null, hwm: null, companionMs: null, jobRuns: null, openReconciliations: null };
  const [state, proposals, listIds, breaker, hwm, companionRaw, jobRunsRaw, openReconciliations] = await Promise.all([
    redis.get(STATE_KEY).catch(() => null),
    listAllProposals().catch(() => null),
    redis.lrange("pm:approval_proposals", 0, 249).catch(() => null),
    getBreakerState().catch(() => null),
    getPortfolioHighWaterMark().catch(() => null),
    redis.get("pm:companion:last-seen").catch(() => null),
    redis.mget(...[...Object.keys(JOB_EXPECTATIONS), "weekly-review", "system-sentinel"].map((j) => `pm:job:${j}:last-run`)).catch(() => null),
    listOpenReconciliations().catch(() => null),
  ]);
  const jobNames = [...Object.keys(JOB_EXPECTATIONS), "weekly-review", "system-sentinel"];
  const jobRuns = {};
  if (Array.isArray(jobRunsRaw)) {
    jobNames.forEach((name, i) => {
      const raw = jobRunsRaw[i];
      if (raw) jobRuns[name] = typeof raw === "string" ? JSON.parse(raw) : raw;
    });
  }
  const parsedState = state ? (typeof state === "string" ? JSON.parse(state) : state) : {};
  let companionMs = null;
  if (companionRaw != null) {
    const n = Number(companionRaw);
    companionMs = Number.isFinite(n) && n > 0 ? (n < 1e12 ? n * 1000 : n) : Date.parse(companionRaw);
  }
  return { state: parsedState, proposals, listIds, breaker, hwm, companionMs, jobRuns: Array.isArray(jobRunsRaw) ? jobRuns : null, openReconciliations };
}

async function gatherSheets() {
  try {
    const { sheets, drive } = getServiceAccountClients();
    const spreadsheetId = await resolveSharedSpreadsheetId(sheets, drive);
    const tabs = Object.entries(SYSLOOP_EXPECTED_HEADERS);
    const ranges = tabs.map(([tab, spec]) => `'${tab}'!A${spec.row}:Z${spec.row}`);
    const [headerRes, perf, ledger] = await Promise.all([
      sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges }),
      readPerformanceHistory(sheets, spreadsheetId).catch(() => undefined),
      readTradeLedger(sheets, spreadsheetId).catch(() => null),
    ]);
    const tabHeaders = {};
    tabs.forEach(([tab], i) => {
      tabHeaders[tab] = headerRes.data.valueRanges?.[i]?.values?.[0] ?? null;
    });
    return {
      tabHeaders,
      performanceLastDate: perf === undefined ? undefined : (perf.at(-1)?.date ?? null),
      ledgerOrderIds: ledger ? ledger.map((t) => t.orderId).filter(Boolean) : null,
    };
  } catch (e) {
    console.error("[Sysloop] Sheets gather failed:", e.message);
    return { tabHeaders: null, performanceLastDate: undefined, ledgerOrderIds: null };
  }
}

function readLogSince(file, offset) {
  try {
    if (!fs.existsSync(file)) return { lines: [], offset: 0, exists: false };
    const size = fs.statSync(file).size;
    let start = Number.isFinite(offset) && offset <= size ? offset : 0; // rotation/truncation → start over
    if (size - start > MAX_LOG_BYTES) start = size - MAX_LOG_BYTES;
    if (size === start) return { lines: [], offset: size, exists: true };
    const fd = fs.openSync(file, "r");
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);
    return { lines: buf.toString("utf8").split("\n"), offset: size, exists: true };
  } catch (e) {
    console.error(`[Sysloop] log read failed for ${file}:`, e.message);
    return { lines: null, offset, exists: true };
  }
}

const ERROR_LINE_RE = /error|failed|exception|unhandled|ETIMEDOUT|ECONN|ENOENT|401|403|429|5\d\d/i;
const SELF_OBSERVATION_RE = /^\s*(?:\d+\|\S+\s+\|\s+)?\[(?:Sysloop|Evidence)\]/;

function gatherLogs(prevOffsets = {}) {
  const dir = LOG_DIR();
  const files = ["portfolio-manager-error.log", "portfolio-manager-out.log"];
  const offsets = {};
  let any = false;
  const errorLines = [];
  for (const name of files) {
    const file = path.join(dir, name);
    const { lines, offset, exists } = readLogSince(file, prevOffsets[name]);
    offsets[name] = offset;
    if (!exists) continue;
    any = true;
    if (lines === null) return { clusters: null, offsets };
    const relevant = (name.includes("error") ? lines : lines.filter((l) => ERROR_LINE_RE.test(l)))
      .filter((line) => !SELF_OBSERVATION_RE.test(line));
    errorLines.push(...relevant);
  }
  if (!any) return { clusters: null, offsets }; // no PM2 logs on this host → UNKNOWN, not "clean"
  return { clusters: clusterLogLines(errorLines), offsets };
}

function gatherDocRefs(repoRoot) {
  try {
    // Docs legitimately reference companion files by their path within the
    // dashboard repo, so a ref only counts as missing if it's absent from BOTH
    // repos. On hosts without the dashboard clone (the Jetson) that can't be
    // verified — skip the check there rather than flag false drift; the Mac
    // (which has both clones) is the authoritative host for this P3 check.
    const dashboardRoot = path.join(repoRoot, "..", "portfolio-dashboard");
    if (!fs.existsSync(dashboardRoot)) {
      console.log("[Sysloop] doc-ref check skipped: sibling portfolio-dashboard clone not present on this host");
      return [];
    }
    const docsDir = path.join(repoRoot, "docs");
    const missing = [];
    const seen = new Set();
    for (const doc of fs.readdirSync(docsDir).filter((f) => f.endsWith(".md"))) {
      const text = fs.readFileSync(path.join(docsDir, doc), "utf8");
      for (const m of text.matchAll(/\b((?:lib|jobs|scripts|config|tests)\/[A-Za-z0-9_./-]+\.(?:js|mjs|py|json|md))\b/g)) {
        const rel = m[1];
        if (seen.has(rel)) continue;
        seen.add(rel);
        const existsHere = fs.existsSync(path.join(repoRoot, rel));
        const existsInDashboard = fs.existsSync(path.join(dashboardRoot, rel));
        if (!existsHere && !existsInDashboard) missing.push({ path: rel, doc: `docs/${doc}` });
      }
    }
    return missing;
  } catch (e) {
    console.error("[Sysloop] doc scan failed:", e.message);
    return null;
  }
}

// ── Assemble ────────────────────────────────────────────────────────────────

export async function assembleSnapshot({ repoRoot, now = new Date() } = {}) {
  const et = etParts(now);
  const [pm2, health, probes, redisSlices, sheetsData] = await Promise.all([
    gatherPm2(), gatherHealth(), gatherDashboardProbes(), gatherRedisSlices(), gatherSheets(),
  ]);
  const prevState = redisSlices.state ?? {};
  const logs = gatherLogs(prevState.logOffsets);
  const marketOpen = isMarketOpen(et);
  const approvedWaiting = (redisSlices.proposals ?? []).some((p) => p?.status === "ApprovedForBrokerReview" && !p.fulfilledAt);

  const inputs = {
    pm2: { processes: pm2, prevRestarts: prevState.restarts },
    health: { health },
    nowMs: now.getTime(),
    jobs: { lastRuns: redisSlices.jobRuns, nowET: et, isTradingDay: isTradingDay(et) },
    dashboard: { probes },
    approvals: { proposals: redisSlices.proposals, nowMs: now.getTime(), marketOpen },
    companion: { lastSeenMs: redisSlices.companionMs, nowMs: now.getTime(), approvedWaiting, marketOpen },
    redisQueue: {
      listIds: redisSlices.listIds,
      records: redisSlices.proposals ? Object.fromEntries(redisSlices.proposals.map((p) => [p.id, p])) : null,
      breakerState: redisSlices.breaker,
      hwm: redisSlices.hwm,
    },
    lifecycle: { proposals: redisSlices.proposals, ledgerOrderIds: sheetsData.ledgerOrderIds },
    // Pass the read through verbatim (Codex: reads fail closed). null =
    // "queue unreadable" => the check raises an UNKNOWN/unavailable P1 rather than
    // silently reporting all-clear. [] = genuinely empty.
    reconciliation: { openReconciliations: redisSlices.openReconciliations },
    sheetsSchema: { tabHeaders: sheetsData.tabHeaders, expected: SYSLOOP_EXPECTED_HEADERS },
    sheetsFreshness: { performanceLastDate: sheetsData.performanceLastDate, lastTradingDay: lastTradingDayISO(now) },
    logs: { clusters: logs.clusters, prevClusters: prevState.clusters },
    docs: { missingRefs: gatherDocRefs(repoRoot) },
  };

  const anomalies = runChecks(inputs);

  const snapshot = {
    date: et.date,
    ts: now.toISOString(),
    host: os.hostname(),
    anomalies,
    stats: {
      anomalyCount: anomalies.length,
      bySeverity: anomalies.reduce((acc, a) => ((acc[a.severity] = (acc[a.severity] ?? 0) + 1), acc), {}),
      proposalCount: redisSlices.proposals?.length ?? null,
      errorClusterCount: logs.clusters?.length ?? null,
      jobRuns: redisSlices.jobRuns,
      researchData: health?.researchData ?? null,
      shadowSelection: health?.shadowSelection ?? null,
    },
    clusters: (logs.clusters ?? []).slice(0, 20),
  };

  const nextState = {
    restarts: pm2?.find((p) => p.name === (process.env.SYSLOOP_PM2_NAME?.trim() || "portfolio-manager"))?.pm2_env?.restart_time ?? prevState.restarts,
    logOffsets: logs.offsets,
    clusters: (logs.clusters ?? prevState.clusters ?? []).slice(0, 100),
    prevAnomalyFingerprints: anomalies.map((a) => a.fingerprint),
  };

  return { snapshot, nextState, prevAnomalyFingerprints: prevState.prevAnomalyFingerprints ?? [] };
}

export async function persistSnapshot({ snapshot, nextState, repoRoot }) {
  // Local JSON for debugging on the host that ran the sentinel (gitignored).
  const healthDir = path.join(repoRoot, "ops", "health");
  fs.mkdirSync(healthDir, { recursive: true });
  fs.writeFileSync(path.join(healthDir, `${snapshot.date}.json`), JSON.stringify(snapshot, null, 2));
  const files = fs.readdirSync(healthDir).filter((f) => f.endsWith(".json")).sort();
  for (const f of files.slice(0, Math.max(0, files.length - 30))) fs.unlinkSync(path.join(healthDir, f));

  // Redis is the transport to the Mac tier — losing it means triage/weekly run
  // blind, so failure here is loud (mirrors the dropped-output rule).
  const redis = getRedis();
  if (!redis) {
    console.error("[Sysloop] Redis NOT CONFIGURED — snapshot not published; Mac triage/weekly will not see today's run");
    return false;
  }
  await redisGuardSet(redis, SNAPSHOT_KEY(snapshot.date), snapshot, { ex: SNAPSHOT_TTL });
  await redisGuardSet(redis, STATE_KEY, nextState);
  await redisGuardSet(redis, LAST_RUN_KEY, { ts: snapshot.ts, date: snapshot.date, anomalyCount: snapshot.anomalies.length });
  return true;
}
