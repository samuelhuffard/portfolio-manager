// Stable, non-sensitive job receipt facts. Jobs may report an outcome, but
// observers decide what it means for TRUST/SKILL readiness.

export const JOB_RECEIPT_SCHEMA_VERSION = "job-receipt-v1";
export const JOB_OUTCOMES = Object.freeze([
  "ok",
  "degraded",
  "not_configured",
  "failed",
  "skipped_not_due",
]);

const JOB_OUTCOME_SET = new Set(JOB_OUTCOMES);
const REASON_CODE_RE = /^[a-z][a-z0-9_]{0,79}$/;

function stableReason(value) {
  if (value == null) return null;
  const reason = String(value).trim();
  return REASON_CODE_RE.test(reason) ? reason : "invalid_outcome_reason";
}

/**
 * Normalize job-reported facts for the legacy `pm:job:*:last-run` receipt.
 * `ok` retains its process-completion meaning; it is intentionally not an
 * assertion that the workflow was configured or all work was successful.
 */
export function jobReceiptOutcome({ result = null, ok = true, holiday = null } = {}) {
  if (holiday) return { outcome: "skipped_not_due", outcomeReason: "market_holiday" };
  const outcome = result?.outcome;
  // A job may throw after completing useful work. In that case an attached,
  // frozen outcome distinguishes a partial workflow degradation from an
  // unclassified exception, while `ok: false` still records that the process
  // did not complete cleanly.
  if (outcome == null) return ok
    ? { outcome: "ok", outcomeReason: null }
    : { outcome: "failed", outcomeReason: "job_exception" };
  if (!JOB_OUTCOME_SET.has(outcome)) return { outcome: "failed", outcomeReason: "invalid_outcome_contract" };
  if (!ok && outcome === "ok") return { outcome: "failed", outcomeReason: "invalid_outcome_contract" };
  return { outcome, outcomeReason: stableReason(result?.outcomeReason) };
}

/**
 * Assemble the persisted scheduler receipt without I/O. This pins the exact
 * public record observers consume: a process can finish while its workflow
 * truthfully reports a degraded or not-configured outcome.
 */
export function buildJobRunRecord({
  result = null,
  ok = true,
  holiday = null,
  error = null,
  evidence = null,
  invocation = null,
  timestamp,
  dateET,
  durationMs,
} = {}) {
  const outcome = jobReceiptOutcome({ result, ok, holiday });
  return {
    schemaVersion: JOB_RECEIPT_SCHEMA_VERSION,
    ts: timestamp,
    dateET,
    ok,
    ...outcome,
    durationMs,
    error,
    ...(holiday ? { skippedHoliday: holiday } : {}),
    ...(evidence ? { evidence } : {}),
    ...(invocation ? invocation : {}),
  };
}
