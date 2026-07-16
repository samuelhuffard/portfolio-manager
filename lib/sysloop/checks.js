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
export function checkPm2({ processes, prevRestarts, prevUnstableRestarts, deployMarkerTrust, processName = "portfolio-manager" } = {}) {
  if (!Array.isArray(processes)) return [unavailable("pm2", "pm2 jlist unreadable", "P1")];
  const proc = processes.find((p) => p?.name === processName);
  if (!proc) return [anomaly("pm2", "P1", `PM2 process ${processName} not found`, "process missing from pm2 jlist")];
  const out = [];
  const status = proc.pm2_env?.status;
  if (status !== "online") {
    out.push(anomaly("pm2", "P1", `PM2 process ${processName} is ${status}`, `status=${status}`));
  }
  const restarts = proc.pm2_env?.restart_time;
  if (!Number.isFinite(restarts)) {
    out.push(anomaly(
      "pm2",
      "P1",
      `PM2 restart metadata for ${processName} is unavailable`,
      "restart_time is missing or non-numeric; restart health cannot be evaluated",
      "restart-metadata-missing",
    ));
  } else if (restarts > 0 && !Number.isFinite(prevRestarts)) {
    out.push(anomaly(
      "pm2",
      "P1",
      `PM2 restart baseline for ${processName} is unavailable`,
      `current restart count=${restarts}; a delta and cause cannot be established until the next snapshot`,
      "restart-baseline-missing",
    ));
  } else if (Number.isFinite(prevRestarts) && restarts < prevRestarts) {
    out.push(anomaly(
      "pm2",
      "P1",
      `PM2 restart baseline for ${processName} was reset`,
      `restart counter decreased from ${prevRestarts} to ${restarts}; restart deltas are untrustworthy until a new baseline is established`,
      "restart-baseline-reset",
    ));
  } else if (Number.isFinite(prevRestarts) && restarts - prevRestarts >= 1) {
    const unstable = proc.pm2_env?.unstable_restarts;
    const exitCode = proc.pm2_env?.exit_code;
    const unstableDelta = Number.isFinite(unstable) && Number.isFinite(prevUnstableRestarts)
      ? unstable - prevUnstableRestarts
      : null;
    if (unstableDelta > 0 || (Number.isFinite(exitCode) && exitCode !== 0)) {
      out.push(anomaly(
        "pm2",
        "P1",
        `PM2 process ${processName} is flapping`,
        `${restarts - prevRestarts} restarts; unstable delta=${unstableDelta ?? "unknown"}; last exit=${exitCode ?? "unknown"}`,
      ));
    } else if (deployMarkerTrust?.trusted !== true) {
      out.push(anomaly(
        "pm2",
        "P1",
        `PM2 restart cause for ${processName} is untrusted`,
        `${restarts - prevRestarts} restart(s) occurred without a trusted deploy marker; marker=${deployMarkerTrust?.reason ?? "missing"}; unstable delta=${unstableDelta ?? "unknown"}; last exit=${exitCode ?? "unknown"}`,
      ));
    }
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

// ── 2b. Advisory research-data workflow freshness ───────────────────────────
const RESEARCH_DATA_MAX_AGE_MS = 36 * 60 * 60 * 1000;
const RESEARCH_DATA_RUNNING_MAX_MS = 3 * 60 * 60 * 1000;

export function checkResearchDataHealth({ researchData, enabled = false, nowMs = Date.now() } = {}) {
  // The workflow is opt-in until the enriched peer-metric store exists. A missing
  // status is only quiet while it is intentionally disabled; once enabled it is
  // evidence that the scheduler/status path is not reporting.
  if (researchData?.state === "not_configured") {
    return [anomaly("research-data", "P2", "Research-data workflow is not configured", `reason=${researchData.reason ?? "unknown"}`, `not-configured:${researchData.reason ?? "unknown"}`)];
  }
  if (!enabled) return [];
  if (!researchData) return [anomaly("research-data", "P2", "Research-data refresh status is missing", "workflow is enabled but has not published status", "status:missing")];
  if (researchData.state === "disabled") return [anomaly("research-data", "P2", "Research-data workflow is disabled despite enabled prerequisites", "status and configured prerequisites disagree", "state:disabled")];
  if (researchData.state === "failed") {
    return [anomaly("research-data", "P2", "Research-data refresh failed", `failureStage=${researchData.failureStage ?? "unknown"}`, `failed:${researchData.failureStage ?? "unknown"}`)];
  }
  const startedMs = Date.parse(researchData.startedAt ?? "");
  const completedMs = Date.parse(researchData.completedAt ?? "");
  if (researchData.state === "running") {
    if (!Number.isFinite(startedMs)) return [anomaly("research-data", "P2", "Research-data refresh has no start timestamp", "running status is not auditable", "running:no-start")];
    if (nowMs - startedMs > RESEARCH_DATA_RUNNING_MAX_MS) return [anomaly("research-data", "P2", "Research-data refresh is stuck", `running for ${Math.round((nowMs - startedMs) / 60000)}m`, "running:stale")];
    return [];
  }
  if (researchData.state !== "completed") return [anomaly("research-data", "P2", "Research-data refresh state is unknown", `state=${researchData.state ?? "missing"}`, "state:unknown")];
  if (!Number.isFinite(completedMs)) return [anomaly("research-data", "P2", "Research-data refresh has no completion timestamp", "completed status is not auditable", "completed:no-time")];
  if (nowMs - completedMs > RESEARCH_DATA_MAX_AGE_MS) return [anomaly("research-data", "P2", "Research-data refresh is stale", `last completed ${researchData.completedAt}`, "completed:stale")];

  const cataloged = Number(researchData.cataloged);
  const classified = Number(researchData.classified);
  const metricRows = Number(researchData.metricRows);
  const counts = [cataloged, classified, metricRows];
  if (counts.some((count) => !Number.isFinite(count) || count < 0) || cataloged === 0 || classified > cataloged || metricRows > cataloged) {
    return [anomaly("research-data", "P2", "Research-data refresh reported implausible counts", `cataloged=${researchData.cataloged}, classified=${researchData.classified}, metricRows=${researchData.metricRows}`, "counts:implausible")];
  }
  return [];
}

// ── 3. Scheduler freshness / missed-cron detection ───────────────────────────
// Latest ET hour by which each daily job must have completed on a trading day.
// The sentinel itself runs at 18:15 ET, so nothing later than 18:10 is checkable
// same-day (weekly-review Fri 18:30 is checked as "ran within the last 8 days").
export const JOB_EXPECTATIONS = {
  "premarket-check": { byHourET: 9, severity: "P2" },
  "holdings-sync": { byHourET: 17.5, severity: "P1" },
  "order-reconciliation": { byHourET: 17, severity: "P1" },
  "intraday-monitor": { byHourET: 16.5, severity: "P1" },
  "exit-monitor": { byHourET: 17.25, weekdays: ["Mon", "Tue", "Wed", "Thu"], severity: "P1" },
  "research-scan": { byHourET: 18, weekdays: ["Mon", "Tue", "Wed", "Thu"], severity: "P2" },
  "performance-review": { byHourET: 18.2, severity: "P2" },
  "verify-ledgers": { byHourET: 18.25, severity: "P1" },
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
    if (exp.weekdays && !exp.weekdays.includes(nowET.weekday)) continue;
    if (nowHour < exp.byHourET) continue; // not due yet this run
    const run = lastRuns[job];
    if (!run) {
      out.push(anomaly("cron", exp.severity, `Job ${job} has never recorded a run`, "pm:job:*:last-run key missing — missed cron or instrumentation not deployed", `${job}:never`));
      continue;
    }
    if (run.dateET !== today) {
      out.push(anomaly("cron", exp.severity, `Job ${job} did not run today`, `last ran ${run.dateET ?? run.ts} (expected by ${exp.byHourET}:00 ET)`, `${job}:missed`));
    } else if (run.ok === false) {
      out.push(anomaly("cron", exp.severity, `Job ${job} failed its last run`, run.error ?? "no error captured", `${job}:failed`));
    }
  }

  const weekly = lastRuns[WEEKLY_JOB];
  const weeklyAgeDays = weekly?.ts ? (Date.parse(nowET.iso) - Date.parse(weekly.ts)) / 86400000 : Infinity;
  if (!weekly) {
    out.push(anomaly("cron", "P2", `Job ${WEEKLY_JOB} has never recorded a run`, "key missing", `${WEEKLY_JOB}:never`));
  } else if (weeklyAgeDays > WEEKLY_MAX_AGE_DAYS) {
    out.push(anomaly("cron", "P2", `Job ${WEEKLY_JOB} is stale`, `last ran ${weekly.ts} (${weeklyAgeDays.toFixed(1)}d ago)`, `${WEEKLY_JOB}:stale`));
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

// ── 6b. Phase 0 exit throughput (observation-window progress) ────────────────
// The Phase 0 exit gate requires the pipeline to PROVE it can act: across the
// ~10-trading-day window, >=3 genuine actionable proposals reached the approval
// queue and >=1 earned an evaluator APPROVE. A system that emits zero proposals
// for weeks is not "stable" — it has a different bug. This fires only once the
// window is maturing (default >=8 trading days elapsed), so a legitimately quiet
// early week is not flagged as a problem (avoids the sysloop-noise trap).
export function checkPhase0Throughput({
  actionableProposals,
  evaluatorApprovals,
  tradingDaysElapsed,
  minProposals = 3,
  minApprovals = 1,
  matureAfterDays = 8,
} = {}) {
  if (!Number.isFinite(tradingDaysElapsed) || !Number.isFinite(actionableProposals) || !Number.isFinite(evaluatorApprovals)) {
    return [unavailable("throughput", "window proposal/approval counts unreadable", "P2")];
  }
  if (tradingDaysElapsed < matureAfterDays) return []; // too early to judge — stay quiet
  const shortfalls = [];
  if (actionableProposals < minProposals) shortfalls.push(`${actionableProposals}/${minProposals} actionable proposals`);
  if (evaluatorApprovals < minApprovals) shortfalls.push(`${evaluatorApprovals}/${minApprovals} evaluator APPROVE`);
  if (shortfalls.length === 0) return [];
  return [
    anomaly(
      "throughput",
      "P2",
      "Phase 0 window closing without throughput proof",
      `${tradingDaysElapsed} trading days elapsed but only ${shortfalls.join(" and ")} — the exit gate needs a pipeline that demonstrably acts, not just one that stays quiet. Investigate the evaluator/mandate path before the window resets.`,
      "phase0-throughput"
    ),
  ];
}

// ── 6c. Reconciliation queue (durable ownership-SELL mismatches) ─────────────
// A recorded SELL whose lot ledger could not be reconciled leaves a durable
// signed record (lib/redis.js recordReconciliationNeeded). It stays open until a
// repair clears it — so sysloop must surface it every run (P1: the broker
// position and the lot book disagree, and a proposal is stuck unfulfilled).
export function checkReconciliationQueue({ openReconciliations } = {}) {
  // Fail closed: null/undefined (or any non-array) means the queue could not be
  // read — treat as UNKNOWN, not all-clear.
  if (!Array.isArray(openReconciliations)) {
    return [unavailable("reconciliation", "open reconciliation queue unreadable (failing closed)", "P1")];
  }
  if (openReconciliations.length === 0) return [];
  return openReconciliations.map((r) => {
    // A record that failed verify-on-read is an integrity event — MORE alarming,
    // never dropped or trusted.
    if (r && r.verified === false) {
      return anomaly(
        "reconciliation",
        "P1",
        `Reconciliation record FAILED integrity check: order ${r?.orderId ?? "?"}`,
        `the signed reconciliation record for ${r?.ticker ?? "?"} did not verify — it may be tampered or unsigned. Do not trust its contents; investigate.`,
        `reconciliation-integrity:${r?.orderId ?? "unknown"}`
      );
    }
    return anomaly(
      "reconciliation",
      "P1",
      `Unreconciled SELL needs lot repair: ${r?.ticker ?? "?"} (order ${r?.orderId ?? "?"})`,
      `proposal ${r?.proposalId ?? "?"} left unfulfilled — ${r?.reason ?? "lot ledger not updated"}. Repair lots and clear the record.`,
      `reconciliation:${r?.orderId ?? "unknown"}`
    );
  });
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
const NEW_CLUSTER_MIN = 2;

export function checkLogClusters({ clusters, prevClusters } = {}) {
  if (!Array.isArray(clusters)) return [unavailable("logs", "PM2 logs unreadable", "P2")];
  const prev = new Map((prevClusters ?? []).map((c) => [c.fingerprint, c.count]));
  const out = [];
  for (const c of clusters) {
    const before = prev.get(c.fingerprint);
    if (before === undefined) {
      if (c.count >= NEW_CLUSTER_MIN) {
        out.push(anomaly("logs", "P2", "New error cluster in PM2 logs", `${c.count}× "${c.exemplar.slice(0, 160)}"`, `cluster:${c.fingerprint}`));
      }
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

// ── 13. Git-tracked operational findings ───────────────────────────────────
// Manually raised P0/P1 items are first-class safety evidence, not prose that
// the sentinel can ignore. Preserve the finding fingerprint so recurrence
// updates the same ledger row instead of creating a duplicate.
export function checkTrackedFindings({ open } = {}) {
  if (!Array.isArray(open)) return [];
  return open
    .filter((finding) => finding?.severity === "P0" || finding?.severity === "P1")
    .map((finding) => ({
      check: "tracked-finding",
      severity: finding.severity,
      title: `Tracked finding ${finding.id}: ${finding.title}`,
      detail: `status=${finding.status}; details=ops/findings/${finding.file}`,
      fingerprint: finding.fingerprint,
    }));
}

// ── Orchestration ────────────────────────────────────────────────────────────
export function runChecks(inputs) {
  return [
    ...checkPm2(inputs.pm2),
    ...checkHealthDeps(inputs.health),
    ...checkResearchDataHealth({ researchData: inputs.health?.health?.researchData, enabled: inputs.health?.health?.researchDataEnabled, nowMs: inputs.nowMs }),
    ...checkJobFreshness(inputs.jobs),
    ...checkDashboard(inputs.dashboard),
    ...checkApprovalsFlow(inputs.approvals),
    ...checkCompanionHeartbeat(inputs.companion),
    ...checkRedisQueue(inputs.redisQueue),
    ...checkProposalLifecycle(inputs.lifecycle),
    ...checkReconciliationQueue(inputs.reconciliation),
    ...checkSheetsSchema(inputs.sheetsSchema),
    ...checkSheetsFreshness(inputs.sheetsFreshness),
    ...checkLogClusters(inputs.logs),
    ...checkDocPaths(inputs.docs),
    ...checkTrackedFindings(inputs.trackedFindings),
  ].sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity));
}
