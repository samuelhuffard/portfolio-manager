import { RESEARCH_OUTCOME_KINDS } from "./research-run-report.js";
import { holdingMonitorCoveragePasses } from "./holding-monitor-coverage.js";
import { MCP_ACCOUNT_POLICY_VERSION, McpReadReceiptSchema } from "../contracts/mcp-read-job.js";

const FAILURE_OUTCOMES = ["budget_exhausted", "review_error", "evaluator_error", "queue_error", "unknown"];
const BLOCKED_OUTCOMES = ["data_gate", "stale_data", "proposal_blocked"];

function finiteCount(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

const CHECK_DOMAINS = new Set(["TRUST", "SKILL", "BOTH"]);

function check(name, domain, status, detail, evidence = null) {
  if (!CHECK_DOMAINS.has(domain)) throw new TypeError(`Invalid Phase 0 check domain: ${domain}`);
  return { name, domain, status, detail, evidence };
}

function statusIsPass(value) {
  return value === true || value?.ok === true || ["pass", "MATCH", "EXACT_MATCH"].includes(value?.status);
}

function statusIsFail(value) {
  return value === false || value?.ok === false || [
    "fail", "DIVERGENCE", "VALUE_MISMATCH",
  ].includes(value?.status);
}

function positionDivergence(parity) {
  return (parity?.divergences ?? []).find((row) => row?.key === "positions") ?? null;
}

function parityChecks(parity) {
  if (!parity || parity.fresh !== true) {
    return [
      check("transactional_parity", "TRUST", "insufficient", "Current-day parity evidence is missing or stale."),
      check("valuation_status", "TRUST", "insufficient", "Current-day valuation evidence is missing or stale."),
    ];
  }

  let transactional;
  if (statusIsPass(parity.transactional)) {
    transactional = check("transactional_parity", "TRUST", "pass", "Transactional fields match across authoritative and shadow stores.", parity.transactional);
  } else if (statusIsFail(parity.transactional)) {
    transactional = check("transactional_parity", "TRUST", "fail", "Transactional fields diverge across authoritative and shadow stores.", parity.transactional);
  } else if (parity.ok === true) {
    transactional = check("transactional_parity", "TRUST", "pass", "The legacy exact parity digest matches, including transactional fields.", { legacyCombinedDigest: true });
  } else if ((parity.divergences ?? []).length > 0 && (parity.divergences ?? []).every((row) => row?.key === "positions_valuation")) {
    transactional = check("transactional_parity", "TRUST", "pass", "Only the separately classified valuation projection diverges; transactional parity matches.", { matched: parity.matched ?? [] });
  } else if (positionDivergence(parity) && (parity.divergences ?? []).every((row) => row?.key === "positions")) {
    transactional = check(
      "transactional_parity",
      "TRUST",
      "insufficient",
      "The legacy position digest mixes transaction fields with market value, so this position-only divergence cannot prove a transaction mismatch.",
      positionDivergence(parity)
    );
  } else {
    transactional = check("transactional_parity", "TRUST", "fail", "One or more non-valuation parity domains diverge.", parity.divergences ?? []);
  }

  let valuation;
  if (statusIsPass(parity.valuation)) {
    valuation = check("valuation_status", "TRUST", "pass", "Valuations match using an explicitly reported valuation comparison.", parity.valuation);
  } else if (statusIsFail(parity.valuation)) {
    valuation = check("valuation_status", "TRUST", "fail", "Valuation comparison diverges.", parity.valuation);
  } else if (parity.valuation?.status === "UNREADABLE") {
    const monitoringBlocked = parity.valuation?.preventedHoldingMonitoring === true || parity.holdingMonitoring?.ok === false;
    valuation = monitoringBlocked
      ? check("valuation_status", "TRUST", "fail", "Valuation is unreadable and holding monitoring is explicitly not intact.", parity.valuation)
      : check("valuation_status", "TRUST", "warning", "Valuation is unreadable, but there is no evidence that transactional parity or holding monitoring failed.", parity.valuation);
  } else if (["NON_COMPARABLE", "PROVENANCE_MISMATCH", "FRESHNESS_MISMATCH"].includes(parity.valuation?.status)) {
    valuation = check(
      "valuation_status",
      "TRUST",
      "warning",
      `Valuation is ${parity.valuation.status}; this is visible but does not imply an accounting divergence.`,
      parity.valuation
    );
  } else if (positionDivergence(parity)) {
    valuation = check("valuation_status", "TRUST", "warning", "The legacy combined position digest diverges, but valuation cannot be classified without common quote provenance.", positionDivergence(parity));
  } else {
    valuation = check(
      "valuation_status",
      "TRUST",
      "insufficient",
      "Legacy parity has no quote source/timestamp or separate valuation result; an equal combined digest does not prove valuation freshness.",
      { legacyCombinedDigest: true }
    );
  }
  return [transactional, valuation];
}

function researchCheck(research) {
  const reports = Array.isArray(research?.reports) ? research.reports : (research?.report ? [research.report] : []);
  if (reports.length === 0) {
    if (research?.requiredRunPresent === true || research?.requiredRunPresent == null) {
      return check("research_accounting", "SKILL", "insufficient", "The latest required research run is missing, stale, or not outcome-classifiable.", {
        fresh: research?.fresh ?? false, reason: "missing_report", runIds: [], validResearchSamples: 0,
      });
    }
    return check("research_accounting", "SKILL", "pass", "No new scheduled research sample is due for this observation.", {
      runIds: [], attemptedReviews: 0, validResearchSamples: 0, proposalsCreated: 0,
      evaluator: { confirmedApprovals: 0, rejects: 0, errors: 0 }, outcomeCounts: Object.fromEntries(RESEARCH_OUTCOME_KINDS.map((kind) => [kind, 0])),
    });
  }

  const totals = Object.fromEntries(RESEARCH_OUTCOME_KINDS.map((kind) => [kind, 0]));
  let attemptedReviews = 0;
  let validResearchSamples = 0;
  let malformed = false;
  let failedRuns = 0;
  for (const report of reports) {
    if (!report?.classificationAvailable || report.status !== "completed") {
      if (report?.status !== "completed") failedRuns += 1;
      else malformed = true;
      continue;
    }
    const attempts = finiteCount(report.totals?.attemptedReviews);
    const counts = report.totals?.outcomeCounts ?? {};
    if (attempts == null || RESEARCH_OUTCOME_KINDS.some((kind) => finiteCount(counts[kind]) == null)) {
      malformed = true;
      continue;
    }
    const classified = RESEARCH_OUTCOME_KINDS.reduce((sum, kind) => sum + counts[kind], 0);
    if (classified !== attempts) {
      malformed = true;
      continue;
    }
    attemptedReviews += attempts;
    for (const kind of RESEARCH_OUTCOME_KINDS) totals[kind] += counts[kind];
    const failures = FAILURE_OUTCOMES.reduce((sum, kind) => sum + counts[kind], 0);
    if (failures === 0) validResearchSamples += attempts;
  }
  const cadenceMissing = research?.requiredRunPresent === false;
  if (malformed) {
    return check("research_accounting", "SKILL", "insufficient", "The latest required research run is missing, stale, or not outcome-classifiable.", {
      fresh: research?.fresh ?? false, reason: "malformed_report", runIds: reports.map((row) => row?.runId).filter(Boolean), validResearchSamples,
    });
  }
  const failures = FAILURE_OUTCOMES.reduce((sum, kind) => sum + totals[kind], 0);
  const blocked = BLOCKED_OUTCOMES.reduce((sum, kind) => sum + totals[kind], 0);
  const evidence = {
    runId: reports.length === 1 ? reports[0]?.runId : null,
    runIds: reports.map((row) => row?.runId).filter(Boolean),
    classificationVersion: reports.every((row) => row?.classificationVersion === reports[0]?.classificationVersion) ? reports[0]?.classificationVersion : "mixed",
    attemptedReviews,
    validResearchSamples,
    classifiedOutcomes: RESEARCH_OUTCOME_KINDS.reduce((sum, kind) => sum + totals[kind], 0),
    successes: attemptedReviews - failures - blocked,
    investmentHolds: totals.investment_hold,
    blocked,
    failures,
    failedRuns,
    outcomeCounts: totals,
    proposalsCreated: totals.proposal_created,
    evaluator: {
      confirmedApprovals: totals.proposal_created,
      rejects: totals.evaluator_reject,
      errors: totals.evaluator_error,
    },
  };
  return failures === 0 && failedRuns === 0 && !cadenceMissing
    ? check("research_accounting", "SKILL", "pass", `All ${attemptedReviews} attempted reviews across ${reports.length} new run(s) have explicit conserved outcomes.`, evidence)
    : check("research_accounting", "SKILL", "fail", `${failures} failed attempt outcome(s), ${failedRuns} failed run(s), cadenceMissing=${cadenceMissing}.`, evidence);
}

function capacityChecks(capacity) {
  const monthly = capacity?.monthly;
  let readiness;
  let monthlyHeadroom;
  if (!monthly) {
    readiness = check("capacity_readiness", "BOTH", "insufficient", "Monthly cost/capacity readiness evidence is unavailable.");
    monthlyHeadroom = check("monthly_capacity", "SKILL", "insufficient", "Monthly capacity headroom is unavailable.");
  } else if (monthly.status === "NOT_CONFIGURED") {
    readiness = check("capacity_readiness", "BOTH", "insufficient", "The monthly Anthropic ceiling is NOT_CONFIGURED; G0 capacity readiness remains unresolved.", monthly);
    monthlyHeadroom = check("monthly_capacity", "SKILL", "insufficient", "Monthly headroom cannot be computed without an approved ceiling.", monthly);
  } else if (monthly.status === "UNREADY") {
    readiness = check("capacity_readiness", "BOTH", "insufficient", "Monthly Anthropic readiness is UNREADY because configuration, pricing, or telemetry is incomplete.", monthly);
    monthlyHeadroom = check("monthly_capacity", "SKILL", "insufficient", "Monthly capacity headroom cannot be trusted while readiness is UNREADY.", monthly);
  } else if (
    !["OK", "WARNING", "EXHAUSTED"].includes(monthly.status)
    || monthly.telemetryStatus !== "COMPLETE"
    || !String(monthly.pricingVersion ?? "").trim()
    || !Number.isFinite(monthly.thresholds?.ceilingUsd)
    || !Number.isFinite(monthly.spentUsd)
    || !Number.isFinite(monthly.reservedUsd)
    || !Number.isFinite(monthly.remainingUsd)
  ) {
    readiness = check("capacity_readiness", "BOTH", "insufficient", "Configured monthly capacity cannot be trusted because pricing, telemetry, or remaining-budget evidence is incomplete.", monthly);
    monthlyHeadroom = check("monthly_capacity", "SKILL", "insufficient", "Monthly capacity headroom cannot be trusted.", monthly);
  } else {
    readiness = check("capacity_readiness", "BOTH", "pass", "Monthly ceiling, pricing, and usage telemetry are configured and readable.", monthly);
    monthlyHeadroom = monthly.status === "EXHAUSTED"
      ? check("monthly_capacity", "SKILL", "fail", "The configured monthly Anthropic budget is exhausted.", monthly)
      : monthly.status === "WARNING"
        ? check("monthly_capacity", "SKILL", "pass", `$${monthly.remainingUsd.toFixed(4)} remains; usage is at or above the configured warning threshold.`, monthly)
        : check("monthly_capacity", "SKILL", "pass", `$${monthly.remainingUsd.toFixed(4)} of monthly capacity remains.`, monthly);
  }

  const providerStatus = capacity?.providerCapacityStatus ?? "UNKNOWN";
  const provider = providerStatus === "AVAILABLE"
    ? check("provider_capacity", "SKILL", "pass", "Provider capacity is explicitly available.", { status: providerStatus })
    : ["EXHAUSTED", "THROTTLED", "UNPRICED_MODEL"].includes(providerStatus)
      ? check("provider_capacity", "SKILL", "fail", `Provider/model capacity is ${providerStatus}.`, { status: providerStatus })
      : check("provider_capacity", "SKILL", "warning", "Provider quota headroom is not independently known; research outcomes remain the operational evidence.", { status: providerStatus });

  const protectedMonitoring = capacity?.preventedProtectedMonitoring === true
    ? check("protected_monitoring_capacity", "TRUST", "fail", "Capacity or pricing failure deprived protected holding/evaluator monitoring.", { providerCapacityStatus: providerStatus })
    : capacity?.preventedProtectedMonitoring === false
      ? check("protected_monitoring_capacity", "TRUST", "pass", "Capacity evidence reports that protected holding/evaluator monitoring remained intact.", { providerCapacityStatus: providerStatus })
      : check("protected_monitoring_capacity", "TRUST", "warning", "Protected-monitoring impact is not independently reported by the provider capacity surface.", { providerCapacityStatus: providerStatus });
  return [readiness, monthlyHeadroom, provider, protectedMonitoring];
}

function isBlocking(check) {
  return check.status === "fail" || check.status === "insufficient";
}

function affects(check, domain) {
  return check.domain === domain || check.domain === "BOTH";
}

function validMcpReceipt(row, dateET) {
  const parsed = McpReadReceiptSchema.safeParse(row);
  if (!parsed.success) return false;
  const receipt = parsed.data;
  const completed = new Date(row?.completedAt ?? row?.ts ?? "");
  const completedDateET = Number.isFinite(completed.getTime())
    ? new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(completed)
    : null;
  return row?.source === "mac-robinhood-mcp"
    && receipt.ok === true
    && receipt.outcome === "ok"
    && receipt.accountVerified === true
    && receipt.accountPolicyVersion === MCP_ACCOUNT_POLICY_VERSION
    && completedDateET === dateET;
}

function scheduledInvocationCheck(schedules, dateET) {
  if (!Array.isArray(schedules) || schedules.length === 0) {
    return check("scheduled_invocations", "TRUST", "insufficient", "Per-invocation job history is unreadable.");
  }
  const issues = [];
  let expectedCount = 0;
  for (const schedule of schedules) {
    const expected = Array.isArray(schedule?.expected) ? schedule.expected : [];
    const records = Array.isArray(schedule?.records) ? schedule.records : [];
    expectedCount += expected.length;
    for (const invocationId of expected) {
      const matches = records.filter((row) => row?.invocationId === invocationId && row?.dateET === dateET);
      if (matches.length === 0) {
        issues.push({ job: schedule?.name, invocationId, reason: "missing" });
        continue;
      }
      if (matches.some((row) => row?.ok !== true)) {
        issues.push({ job: schedule?.name, invocationId, reason: "failed_or_malformed" });
      }
      if (["holdings-sync", "order-reconciliation"].includes(schedule?.name)
        && matches.some((row) => !validMcpReceipt(row, dateET))) {
        issues.push({ job: schedule.name, invocationId, reason: "invalid_account_bound_mcp_receipt" });
      }
      if (schedule?.name === "system-sentinel"
        && matches.some((row) => !Array.isArray(row?.evidence?.blockingAnomalies)
          || row.evidence.blockingAnomalies.length > 0)) {
        issues.push({ job: schedule.name, invocationId, reason: "blocking_or_unreadable_sentinel_result" });
      }
      if (schedule?.name === "intraday-monitor"
        && matches.some((row) => !holdingMonitorCoveragePasses(row?.evidence?.holdingMonitoring))) {
        issues.push({ job: schedule.name, invocationId, reason: "invalid_holding_coverage" });
      }
    }
  }
  return issues.length === 0
    ? check("scheduled_invocations", "TRUST", "pass", `All ${expectedCount} scheduled invocations have current-day non-masking evidence.`, schedules)
    : check("scheduled_invocations", "TRUST", "fail", `${issues.length} scheduled invocation issue(s) prevent a clean day.`, issues);
}

/**
 * Pure Phase 0 verdict builder. Any unknown evidence is non-passing; callers
 * must never turn absence into a clean observation day.
 */
export function buildPhase0Observation(input) {
  const checks = [];
  const dateET = input?.dateET ?? null;
  if (input?.tradingDay !== true) {
    return {
      schemaVersion: "phase0-observation-v2",
      dateET,
      observedAt: input?.observedAt ?? null,
      verdict: "SKIP",
      trustVerdict: "SKIP",
      skillVerdict: "SKIP",
      countsTowardSafetyWindow: false,
      countsTowardResearchCohort: false,
      countsTowardWindow: false,
      reasons: ["Not a US-equity trading day."],
      trustReasons: ["Not a US-equity trading day."],
      skillReasons: ["Not a US-equity trading day."],
      checks: [],
      deployment: input?.deployment ?? null,
    };
  }

  const deployment = input?.deployment;
  const mandateVersions = deployment?.policies?.mandateVersions;
  const selection = deployment?.policies?.researchSelection;
  const deploymentComplete = Boolean(
    String(deployment?.commit ?? "").trim()
    && String(deployment?.branch ?? "").trim()
    && mandateVersions && Object.keys(mandateVersions).length > 0
    && Object.values(mandateVersions).every((value) => String(value ?? "").trim())
    && String(selection?.policyVersion ?? "").trim()
    && String(selection?.mode ?? "").trim()
  );
  checks.push(deploymentComplete
    ? check("deployment_identity", "TRUST", "pass", "Deployed commit, branch, mandate versions, and research-selection policy are identified.", deployment)
    : check("deployment_identity", "TRUST", "insufficient", "Deployed commit/branch or an active policy version is missing.", deployment ?? null));

  const jobs = Array.isArray(input?.criticalJobs) ? input.criticalJobs : [];
  if (jobs.length === 0) {
    checks.push(check("critical_jobs", "TRUST", "insufficient", "Critical job evidence is unreadable."));
  } else {
    const bad = jobs.filter((job) => !job?.run || job.run.dateET !== dateET || job.run.ok !== true || job.run.skippedHoliday);
    checks.push(bad.length === 0
      ? check("critical_jobs", "TRUST", "pass", `All ${jobs.length} due critical jobs recorded successful current-day runs.`, jobs)
      : check("critical_jobs", "TRUST", "fail", `${bad.length} due critical job(s) are missing, stale, skipped, or failed.`, bad));
  }

  checks.push(scheduledInvocationCheck(input?.scheduledInvocations, dateET));

  const monitoring = Array.isArray(input?.holdingMonitoring) ? input.holdingMonitoring : null;
  if (!monitoring || monitoring.length === 0) {
    checks.push(check("holding_monitoring", "TRUST", "insufficient", "Current-day per-holding coverage evidence is unreadable."));
  } else {
    const bad = monitoring.filter((entry) => !holdingMonitorCoveragePasses(entry?.coverage));
    const degraded = monitoring.reduce((sum, entry) => sum + (entry?.coverage?.degraded ?? 0), 0);
    const expected = monitoring.reduce((sum, entry) => sum + (entry?.coverage?.expected ?? 0), 0);
    checks.push(bad.length === 0
      ? check(
          "holding_monitoring",
          "TRUST",
          "pass",
          `${monitoring.length} due monitor(s) conserved ${expected} held-name checks; ${degraded} were explicitly degraded and zero were silently skipped.`,
          monitoring
        )
      : check(
          "holding_monitoring",
          "TRUST",
          "fail",
          `${bad.length} due monitor(s) have failed, malformed, overflow, or silently skipped holding coverage.`,
          bad
        ));
  }

  const queue = input?.proposalQueue;
  const queueReadable = finiteCount(queue?.total) != null && finiteCount(queue?.fulfilled) != null
    && queue?.byStatus && typeof queue.byStatus === "object" && !Array.isArray(queue.byStatus);
  checks.push(queueReadable
    ? check("proposal_counts", "SKILL", "pass", `Proposal queue counts are readable (${queue.total} retained records).`, queue)
    : check("proposal_counts", "SKILL", "insufficient", "Proposal queue counts are unreadable.", queue ?? null));

  const p1 = input?.sentinel?.fresh === true && Array.isArray(input.sentinel.anomalies)
    ? input.sentinel.anomalies.filter((row) => row?.severity === "P0" || row?.severity === "P1")
    : null;
  checks.push(p1 == null
    ? check("open_p0_p1", "TRUST", "insufficient", "Current-day system-sentinel findings are unreadable or stale.")
    : p1.length === 0
      ? check("open_p0_p1", "TRUST", "pass", "No active P0/P1 sentinel findings.", [])
      : check("open_p0_p1", "TRUST", "fail", `${p1.length} active P0/P1 sentinel finding(s).`, p1));

  const openReconciliations = input?.openReconciliations;
  checks.push(!Array.isArray(openReconciliations)
    ? check("reconciliation", "TRUST", "insufficient", "Open reconciliation state is unreadable.")
    : openReconciliations.length === 0
      ? check("reconciliation", "TRUST", "pass", "No open reconciliation records.", [])
      : check("reconciliation", "TRUST", "fail", `${openReconciliations.length} reconciliation record(s) remain open.`, openReconciliations.map((row) => ({ orderId: row?.orderId ?? null, verified: row?.verified ?? false }))));

  checks.push(...parityChecks(input?.parity));
  checks.push(...capacityChecks(input?.capacity));
  const research = researchCheck(input?.research);
  checks.push(research);
  const throughput = research.evidence?.proposalsCreated;
  checks.push(finiteCount(throughput) == null
    ? check("proposal_throughput", "SKILL", "insufficient", "Proposal throughput is unavailable because the research sample is unreadable.")
    : throughput > 0
      ? check("proposal_throughput", "SKILL", "pass", `${throughput} actionable proposal(s) and confirmed evaluator approval(s) were recorded in this run.`, {
          proposalsCreated: throughput,
          confirmedEvaluatorApprovals: research.evidence.evaluator?.confirmedApprovals ?? null,
        })
      : check("proposal_throughput", "SKILL", "fail", "This run produced zero actionable proposals or confirmed evaluator approvals.", {
          proposalsCreated: 0,
          confirmedEvaluatorApprovals: 0,
        }));

  const trustFailing = checks.filter((row) => affects(row, "TRUST") && isBlocking(row));
  const skillFailing = checks.filter((row) => affects(row, "SKILL") && isBlocking(row));
  const validResearchSamples = input?.research?.newSample !== false
    ? (research.evidence?.validResearchSamples ?? (research.status === "pass" ? research.evidence?.attemptedReviews ?? 0 : 0))
    : 0;
  const trustVerdict = trustFailing.length === 0 ? "PASS" : "FAIL";
  const skillVerdict = skillFailing.length === 0 ? "PASS" : "FAIL";
  const verdict = trustVerdict === "PASS" && skillVerdict === "PASS"
    ? "PASS_BOTH"
    : trustVerdict === "PASS"
      ? "TRUST_PASS_SKILL_FAIL"
      : skillVerdict === "PASS"
        ? "TRUST_FAIL_SKILL_PASS"
        : "FAIL_BOTH";
  return {
    schemaVersion: "phase0-observation-v2",
    dateET,
    observedAt: input?.observedAt ?? null,
    verdict,
    trustVerdict,
    skillVerdict,
    countsTowardSafetyWindow: trustVerdict === "PASS",
    countsTowardResearchCohort: validResearchSamples > 0,
    // Compatibility alias. It always means the TRUST safety window, never the
    // research cohort; new readers should use the explicit field above.
    countsTowardWindow: trustVerdict === "PASS",
    trustReasons: trustFailing.map((row) => `${row.name}: ${row.detail}`),
    skillReasons: skillFailing.map((row) => `${row.name}: ${row.detail}`),
    reasons: [...trustFailing, ...skillFailing].map((row) => `${row.domain} ${row.name}: ${row.detail}`),
    skillProgress: {
      validResearchSamples,
      actionableProposals: finiteCount(throughput) ?? 0,
      confirmedEvaluatorApprovals: finiteCount(research.evidence?.evaluator?.confirmedApprovals) ?? 0,
    },
    checks,
    deployment: input?.deployment ?? null,
  };
}

export function formatPhase0Observation(record) {
  if (record.verdict === "SKIP") return `Phase 0 observation ${record.dateET}: SKIP\n${record.reasons.join("\n")}`;
  const trustIcon = record.trustVerdict === "PASS" ? "✅" : "🚨";
  const skillIcon = record.skillVerdict === "PASS" ? "✅" : "⚠️";
  const lines = [
    `Phase 0 observation ${record.dateET}: ${record.verdict}`,
    `${trustIcon} TRUST ${record.trustVerdict} — safety day counts: ${record.countsTowardSafetyWindow ? "YES" : "NO"}`,
    `${skillIcon} SKILL ${record.skillVerdict} — research cohort samples retained: ${record.countsTowardResearchCohort ? "YES" : "NO"}`,
  ];
  const warnings = record.checks.filter((row) => row.status === "warning");
  lines.push(...record.trustReasons.slice(0, 4).map((reason) => `- TRUST: ${reason}`));
  lines.push(...record.skillReasons.slice(0, 4).map((reason) => `- SKILL: ${reason}`));
  lines.push(...warnings.slice(0, 3).map((row) => `- ${row.domain} warning: ${row.name}: ${row.detail}`));
  const research = record.checks.find((row) => row.name === "research_accounting")?.evidence;
  if (research?.attemptedReviews != null) {
    lines.push(`Research: ${research.attemptedReviews} attempted, ${research.investmentHolds} investment HOLD, ${research.blocked} blocked, ${research.failures} failed, ${research.proposalsCreated} proposals.`);
  }
  const commit = record.deployment?.commit;
  if (commit) lines.push(`Deploy: ${record.deployment.branch ?? "unknown-branch"}@${String(commit).slice(0, 12)}`);
  return lines.join("\n");
}
