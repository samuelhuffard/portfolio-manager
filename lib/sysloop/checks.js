import { fingerprint } from "./fingerprint.js";

// Tier-0 checks for the system autoresearch loop (docs/SYSTEM-LOOP-PLAN.md §5).
// Every check is a PURE function over injected inputs so it can be unit-tested
// with fixtures — gathering the inputs lives in snapshot.js, never here.
//
// A check returns an array of anomalies (empty = healthy):
//   { check, severity: "P0"|"P1"|"P2"|"P3", title, detail, fingerprint }
// Severity meaning: P0 = live security incident, P1 = system broken/money-path
// risk, P2 = degraded/needs attention, P3 = hygiene (docs, latency, test gaps).
//
// FAIL CLOSED: an input that could not be gathered is an anomaly, not a pass.

export const SEVERITIES = ["P0", "P1", "P2", "P3"];

function anomaly(check, severity, title, detail, seed) {
  return {
    check,
    severity,
    title,
    detail: String(detail ?? "").slice(0, 500),
    // Seed defaults to check+title so the "same" problem recurs onto one finding.
    fingerprint: fingerprint(`${check}:${seed ?? title}`),
  };
}

export function unavailable(check, reason, severity = "P2") {
  return anomaly(check, severity, `${check}: input UNKNOWN (fail closed)`, reason, "unavailable");
}

// ── 1. Jetson PM2 health ─────────────────────────────────────────────────────
export function checkPm2({ processes, prevRestarts, processName = "portfolio-manager" } = {}) {
  if (!Array.isArray(processes)) return [unavailable("pm2", "pm2 jlist unreadable", "P1")];
  const proc = processes.find((p) => p?.name === processName);
  if (!proc) return [anomaly("pm2", "P1", `PM2 process ${processName} not found`, "process missing from pm2 jlist")];
  const out = [];
  const status = proc.pm2_env?.status;
  if (status !== "online") {
    out.push(anomaly("pm2", "P1", `PM2 process ${processName} is ${status}`, `status=${status}`));
  }
  const restarts = proc.pm2_env?.restart_time ?? 0;
  if (Number.isFinite(prevRestarts) && restarts - prevRestarts >= 3) {
    out.push(anomaly("pm2", "P2", `PM2 process ${processName} is flapping`, `${restarts - prevRestarts} restarts since last snapshot`));
  }
  return out.concat([]);
}

// ── 2. Backend /health dependency booleans ───────────────────────────────────
export function checkHealthDeps({ health } = {}) {
  if (!health || typeof health !== "object") return [unavailable("health", "GET /health failed or returned non-JSON", "P1")];
  const deps = health.deps ?? {};
  const down = Object.entries(deps).filter(([, ok]) => ok !== true).map(([k]) => k);
  if (down.length === 0) return [];
  // This exact class (placeholder ANTHROPIC_API_KEY) once ran silent for 3 days.
  return [anomaly("health", "P1", `Backend /health reports deps down: ${down.join(", ")}`, JSON.stringify(deps), `deps:${down.sort().join(",")}`)];
}

// ── 3. Scheduler freshness / missed-cron detection ───────────────────────────
// Latest ET hour by which each daily job must have completed on a trading day.
// The sentinel itself runs at 18:15 ET, so nothing later than 18:10 is checkable
// same-day (weekly-review Fri 18:30 is checked as "ran within the last 8 days").
export const JOB_EXPECTATIONS = {
  "premarket-check": { byHourET: 9 },
  "holdings-sync": { byHourET: 17.5 },
  "intraday-monitor": { byHourET: 16.5 },
  "exit-monitor": { byHourET: 17.25 },
  "research-scan": { byHourET: 18 },
  "performance-review": { byHourET: 18.2 },
  "verify-ledgers": { byHourET: 18.25 },
};
const WEEKLY_JOB = "weekly-review";
const WEEKLY_MAX_AGE_DAYS = 8;

export function checkJobFreshness({ lastRuns, nowET, isTradingDay } = {}) {
  if (!lastRuns || typeof lastRuns !== "object") return [unavailable("cron", "job last-run keys unreadable", "P1")];
  if (!isTradingDay) return [];
  const out = [];
  const nowHour = nowET.hour + nowET.minute / 60;
  const today = nowET.date; // "YYYY-MM-DD" in ET

  for (const [job, exp] of Object.entries(JOB_EXPECTATIONS)) {
    if (nowHour < exp.byHourET) continue; // not due yet this run
    const run = lastRuns[job];
    if (!run) {
      out.push(anomaly("cron", "P1", `Job ${job} has never recorded a run`, "pm:job:*:last-run key missing — missed cron or instrumentation not deployed", `${job}:never`));
      continue;
    }
    if (run.dateET !== today) {
      out.push(anomaly("cron", "P1", `Job ${job} did not run today`, `last ran ${run.dateET ?? run.ts} (expected by ${exp.byHourET}:00 ET)`, `${job}:missed`));
    } else if (run.ok === false) {
      out.push(anomaly("cron", "P1", `Job ${job} failed its last run`, run.error ?? "no error captured", `${job}:failed`));
    }
  }

  const weekly = lastRuns[WEEKLY_JOB];
  const weeklyAgeDays = weekly?.ts ? (Date.parse(nowET.iso) - Date.parse(weekly.ts)) / 86400000 : Infinity;
  if (!weekly) {
    out.push(anomaly("cron", "P2", `Job ${WEEKLY_JOB} has never recorded a run`, "key missing", `${WEEKLY_JOB}:never`));
  } else if (weeklyAgeDays > WEEKLY_MAX_AGE_DAYS) {
    out.push(anomaly("cron", "P1", `Job ${WEEKLY_JOB} is stale`, `last ran ${weekly.ts} (${weeklyAgeDays.toFixed(1)}d ago)`, `${WEEKLY_JOB}:stale`));
  } else if (weekly.ok === false) {
    out.push(anomaly("cron", "P2", `Job ${WEEKLY_JOB} failed its last run`, weekly.error ?? "no error captured", `${WEEKLY_JOB}:failed`));
  }
  return out;
}

// ── 4. Vercel dashboard health + signed-out security posture ────────────────
// expected: status the signed-out probe MUST return. For auth-gated API routes a
// 200 means the dashboard is serving portfolio data unauthenticated — that is a
// live security incident (P0), not a health blip.
export const DASHBOARD_PROBES = [
  { path: "/", kind: "redirect", expectLocationIncludes: "/sign-in" },
  { path: "/sign-in", kind: "status", expect: 200 },
  { path: "/api/portfolio", kind: "auth", expect: 401 },
  { path: "/api/proposals", kind: "auth", expect: 401 },
];
const LATENCY_BUDGET_MS = 5000;

export function checkDashboard({ probes } = {}) {
  if (!Array.isArray(probes)) return [unavailable("dashboard", "no probe results", "P1")];
  const out = [];
  for (const spec of DASHBOARD_PROBES) {
    const probe = probes.find((p) => p.path === spec.path);
    if (!probe || probe.error) {
      out.push(anomaly("dashboard", "P1", `Dashboard ${spec.path} unreachable`, probe?.error ?? "no result", `${spec.path}:unreachable`));
      continue;
    }
    if (spec.kind === "auth" && probe.status === 200) {
      out.push(anomaly("dashboard", "P0", `SECURITY: signed-out ${spec.path} returned 200`, "auth-gated API served data without a session — treat as live incident", `${spec.path}:open`));
      continue;
    }
    const ok =
      spec.kind === "redirect"
        ? probe.status >= 300 && probe.status < 400 && String(probe.location ?? "").includes(spec.expectLocationIncludes)
        : probe.status === spec.expect;
    if (!ok) {
      out.push(anomaly("dashboard", "P1", `Dashboard ${spec.path} returned ${probe.status}`, `expected ${spec.kind === "redirect" ? "3xx → /sign-in" : spec.expect}${probe.location ? `, location=${probe.location}` : ""}`, `${spec.path}:status`));
    } else if (probe.ms > LATENCY_BUDGET_MS) {
      out.push(anomaly("dashboard", "P3", `Dashboard ${spec.path} slow`, `${probe.ms}ms (budget ${LATENCY_BUDGET_MS}ms)`, `${spec.path}:slow`));
    }
  }
  return out;
}

// ── 6. Approvals flow (proposal lifecycle timing/UX) ─────────────────────────
const PENDING_WARN_MS = 24 * 3600 * 1000; // they hard-expire at 48h — warn at 24h
const EXECUTING_STUCK_MS = 15 * 60 * 1000;
const APPROVED_UNEXECUTED_MS = 30 * 60 * 1000; // ships RISK_REGISTER mitigation

export function checkApprovalsFlow({ proposals, nowMs, marketOpen } = {}) {
  if (!Array.isArray(proposals)) return [unavailable("approvals", "proposal list unreadable", "P1")];
  const out = [];
  let expiredUnseen = 0;
  for (const p of proposals) {
    if (!p) continue;
    const age = nowMs - Date.parse(p.createdAt ?? 0);
    if (p.status === "Pending" && age > PENDING_WARN_MS) {
      out.push(anomaly("approvals", "P2", `Proposal ${p.ticker} ${p.side} pending >24h`, `id=${p.id} expires unseen at 48h`, `pending-stale:${p.id}`));
    }
    if (p.executionState === "Executing" && nowMs - Date.parse(p.updatedAt ?? p.createdAt ?? 0) > EXECUTING_STUCK_MS) {
      out.push(anomaly("approvals", "P1", `Proposal ${p.ticker} ${p.side} stuck in Executing`, `id=${p.id} — order may have been placed without ledger recording; check companion logs`, `executing-stuck:${p.id}`));
    }
    if (
      p.status === "ApprovedForBrokerReview" && !p.fulfilledAt && p.executionState !== "Executing" &&
      marketOpen && p.decidedAt && nowMs - Date.parse(p.decidedAt) > APPROVED_UNEXECUTED_MS
    ) {
      out.push(anomaly("approvals", "P1", `Approved proposal ${p.ticker} ${p.side} unexecuted >30min in market hours`, `id=${p.id} — executor asleep/offline?`, "approved-unexecuted"));
    }
    if (p.status === "Expired" && !p.decidedAt) expiredUnseen += 1;
  }
  if (expiredUnseen >= 3) {
    out.push(anomaly("approvals", "P2", `${expiredUnseen} proposals expired without a decision`, "Sam may not be seeing the approval queue — UX problem, not a code bug", "expired-unseen"));
  }
  return out;
}

// ── 7. Companion heartbeat / executor readiness ──────────────────────────────
const HEARTBEAT_ACTIVE_STALE_MS = 10 * 60 * 1000;
const HEARTBEAT_IDLE_STALE_MS = 24 * 3600 * 1000;

export function checkCompanionHeartbeat({ lastSeenMs, nowMs, approvedWaiting, marketOpen } = {}) {
  if (!Number.isFinite(lastSeenMs)) {
    return [anomaly("companion", "P2", "Companion heartbeat never seen", "pm:companion:last-seen missing", "never")];
  }
  const stale = nowMs - lastSeenMs;
  if (approvedWaiting && marketOpen && stale > HEARTBEAT_ACTIVE_STALE_MS) {
    return [anomaly("companion", "P1", "Executor offline while approved proposals wait", `heartbeat ${Math.round(stale / 60000)}min stale during market hours`, "offline-with-work")];
  }
  if (stale > HEARTBEAT_IDLE_STALE_MS) {
    return [anomaly("companion", "P2", "Companion heartbeat stale >24h", `last seen ${new Date(lastSeenMs).toISOString()}`, "offline-idle")];
  }
  return [];
}

// ── 8. Redis queue sanity ────────────────────────────────────────────────────
const PROPOSAL_STATUSES = new Set(["Pending", "ApprovedForBrokerReview", "Rejected", "Expired"]);
const BREAKER_TIERS = new Set(["NONE", "HALVE_BUYS", "NO_NEW_BUYS", "EXITS_ONLY", "HALT"]);

export function checkRedisQueue({ listIds, records, breakerState, hwm } = {}) {
  if (!Array.isArray(listIds)) return [unavailable("redis", "proposal list unreadable", "P1")];
  const out = [];
  const orphans = listIds.filter((id) => !records?.[id]);
  if (orphans.length > 0) {
    out.push(anomaly("redis", "P2", `${orphans.length} proposal ids in queue with no record`, `first: ${orphans[0]}`, "orphans"));
  }
  const invalid = [];
  for (const [id, p] of Object.entries(records ?? {})) {
    if (!p) continue;
    const bad =
      !p.id || !p.ticker || (p.side !== "BUY" && p.side !== "SELL") ||
      !PROPOSAL_STATUSES.has(p.status) || !p.createdAt || !Number.isFinite(p.amountDollars);
    if (bad) invalid.push(id);
  }
  if (invalid.length > 0) {
    // Proposal schema lives in three repos — drift here is the canary.
    out.push(anomaly("redis", "P1", `${invalid.length} proposals fail canonical schema`, `ids: ${invalid.slice(0, 3).join(", ")} — check lib/proposals.ts vs lib/redis.js vs companion-core.mjs`, "schema-drift"));
  }
  if (breakerState && !BREAKER_TIERS.has(breakerState.tier)) {
    out.push(anomaly("redis", "P1", `Circuit breaker state has unknown tier "${breakerState.tier}"`, JSON.stringify(breakerState).slice(0, 200), "breaker-tier"));
  }
  if (hwm && !Number.isFinite(Number(hwm.value))) {
    out.push(anomaly("redis", "P1", "Portfolio high-water mark is not a number", JSON.stringify(hwm).slice(0, 200), "hwm-nan"));
  }
  return out;
}

// ── 9. Sheets schema drift + data staleness ──────────────────────────────────
export function checkSheetsSchema({ tabHeaders, expected } = {}) {
  if (!tabHeaders || typeof tabHeaders !== "object") return [unavailable("sheets", "header rows unreadable", "P1")];
  const out = [];
  for (const [tab, spec] of Object.entries(expected ?? {})) {
    const actual = tabHeaders[tab];
    if (!Array.isArray(actual)) {
      out.push(anomaly("sheets", "P1", `Sheet tab "${tab}" missing or unreadable`, "expected tab not found", `${tab}:missing`));
      continue;
    }
    const want = spec.headers;
    const mismatch = want.findIndex((h, i) => (actual[i] ?? "") !== h);
    if (actual.length < want.length || mismatch !== -1) {
      const at = mismatch === -1 ? want.length : mismatch;
      out.push(anomaly("sheets", "P1", `Sheet tab "${tab}" header drift at column ${at + 1}`, `expected "${want[at] ?? "(more columns)"}", got "${actual[at] ?? "(missing)"}" — schema is duplicated across repos, fix all copies`, `${tab}:drift`));
    }
  }
  return out;
}

export function checkSheetsFreshness({ performanceLastDate, lastTradingDay } = {}) {
  if (performanceLastDate === undefined) return [unavailable("sheets-freshness", "Performance history unreadable", "P2")];
  if (!performanceLastDate) {
    return [anomaly("sheets-freshness", "P2", "Performance tab has no rows", "holdings sync has never appended a NAV row", "perf:empty")];
  }
  if (String(performanceLastDate).slice(0, 10) < lastTradingDay) {
    return [anomaly("sheets-freshness", "P2", "Performance/NAV data is stale", `last row ${performanceLastDate}, last trading day ${lastTradingDay} — holdings sync not writing`, "perf:stale")];
  }
  return [];
}

// ── 10. Proposal lifecycle integrity (Redis queue ↔ Trade Ledger) ────────────
export function checkProposalLifecycle({ proposals, ledgerOrderIds } = {}) {
  if (!Array.isArray(proposals)) return [unavailable("lifecycle", "proposal records unreadable", "P1")];
  const out = [];
  const ledger = new Set(ledgerOrderIds ?? []);
  const ledgerReadable = Array.isArray(ledgerOrderIds);
  for (const p of proposals) {
    if (!p) continue;
    if (p.status === "ApprovedForBrokerReview" && !p.decisionHmac) {
      // Signed approvals are the execution authorization — an unsigned approved
      // proposal means the signing path was bypassed or broke. INVARIANTS.md #1.
      out.push(anomaly("lifecycle", "P1", `Approved proposal ${p.ticker} ${p.side} has no decision signature`, `id=${p.id} — executor must refuse this; find out how it got approved unsigned`, `unsigned:${p.id}`));
    }
    if (p.fulfilledAt) {
      const orderId = p.fulfilledOrderId ?? p.fulfilledTradeId;
      if (!orderId) {
        out.push(anomaly("lifecycle", "P1", `Fulfilled proposal ${p.ticker} ${p.side} has no order id`, `id=${p.id}`, `no-orderid:${p.id}`));
      } else if (ledgerReadable && !ledger.has(orderId)) {
        out.push(anomaly("lifecycle", "P1", `Fulfilled proposal ${p.ticker} ${p.side} missing from Trade Ledger`, `id=${p.id} orderId=${orderId} — money may have moved without books updating`, `no-ledger-row:${p.id}`));
      }
    }
  }
  if (!ledgerReadable) out.push(unavailable("lifecycle", "Trade Ledger unreadable — fulfilled↔ledger cross-check skipped", "P2"));
  return out;
}

// ── 11. Log error clustering ─────────────────────────────────────────────────
const CLUSTER_GROWTH_FACTOR = 3;
const CLUSTER_GROWTH_MIN = 5;

export function checkLogClusters({ clusters, prevClusters } = {}) {
  if (!Array.isArray(clusters)) return [unavailable("logs", "PM2 logs unreadable", "P2")];
  const prev = new Map((prevClusters ?? []).map((c) => [c.fingerprint, c.count]));
  const out = [];
  for (const c of clusters) {
    const before = prev.get(c.fingerprint);
    if (before === undefined) {
      out.push(anomaly("logs", "P2", "New error cluster in PM2 logs", `${c.count}× "${c.exemplar.slice(0, 160)}"`, `cluster:${c.fingerprint}`));
    } else if (c.count >= CLUSTER_GROWTH_MIN && c.count >= before * CLUSTER_GROWTH_FACTOR) {
      out.push(anomaly("logs", "P1", "Error cluster growing fast", `${before}→${c.count}× "${c.exemplar.slice(0, 160)}"`, `cluster-growth:${c.fingerprint}`));
    }
  }
  return out;
}

// ── 12. Stale docs (referenced paths that no longer exist) ───────────────────
export function checkDocPaths({ missingRefs } = {}) {
  if (!Array.isArray(missingRefs)) return [unavailable("docs", "doc scan failed", "P3")];
  return missingRefs.slice(0, 10).map((ref) =>
    anomaly("docs", "P3", `Doc references missing file: ${ref.path}`, `in ${ref.doc} — doc drift`, `docref:${ref.path}`)
  );
}

// ── Orchestration ────────────────────────────────────────────────────────────
export function runChecks(inputs) {
  return [
    ...checkPm2(inputs.pm2),
    ...checkHealthDeps(inputs.health),
    ...checkJobFreshness(inputs.jobs),
    ...checkDashboard(inputs.dashboard),
    ...checkApprovalsFlow(inputs.approvals),
    ...checkCompanionHeartbeat(inputs.companion),
    ...checkRedisQueue(inputs.redisQueue),
    ...checkProposalLifecycle(inputs.lifecycle),
    ...checkSheetsSchema(inputs.sheetsSchema),
    ...checkSheetsFreshness(inputs.sheetsFreshness),
    ...checkLogClusters(inputs.logs),
    ...checkDocPaths(inputs.docs),
  ].sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity));
}
