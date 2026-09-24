import test from "node:test";
import assert from "node:assert/strict";
import { buildJobRunRecord, JOB_OUTCOMES, JOB_RECEIPT_SCHEMA_VERSION, jobReceiptOutcome } from "../lib/job-receipt.js";

test("job receipt preserves legacy process completion while exposing not-configured workflow state", () => {
  assert.equal(JOB_RECEIPT_SCHEMA_VERSION, "job-receipt-v1");
  assert.deepEqual(jobReceiptOutcome({
    ok: true,
    result: { outcome: "not_configured", outcomeReason: "baseline_provenance_invalid" },
  }), { outcome: "not_configured", outcomeReason: "baseline_provenance_invalid" });
});

test("job receipt uses frozen outcomes and redacts unstable reasons", () => {
  assert.deepEqual(jobReceiptOutcome({ ok: true, result: { outcome: "degraded", outcomeReason: "partial_review_failures" } }), {
    outcome: "degraded", outcomeReason: "partial_review_failures",
  });
  assert.deepEqual(jobReceiptOutcome({ ok: true, result: { outcome: "degraded", outcomeReason: "provider said: private details" } }), {
    outcome: "degraded", outcomeReason: "invalid_outcome_reason",
  });
  assert.deepEqual(jobReceiptOutcome({ ok: true, result: { outcome: "unexpected" } }), {
    outcome: "failed", outcomeReason: "invalid_outcome_contract",
  });
  assert.deepEqual([...JOB_OUTCOMES], ["ok", "degraded", "not_configured", "failed", "skipped_not_due"]);
});

test("job receipt gives exceptions and market holidays stable, non-sensitive facts", () => {
  assert.deepEqual(jobReceiptOutcome({ ok: false }), { outcome: "failed", outcomeReason: "job_exception" });
  assert.deepEqual(jobReceiptOutcome({ ok: true, holiday: "Independence Day" }), {
    outcome: "skipped_not_due", outcomeReason: "market_holiday",
  });
  assert.deepEqual(jobReceiptOutcome({ ok: true }), { outcome: "ok", outcomeReason: null });
});

test("scheduler-facing record preserves process completion and a degraded workflow outcome", () => {
  const record = buildJobRunRecord({
    result: { outcome: "degraded", outcomeReason: "partial_review_failures" },
    ok: true,
    error: null,
    evidence: { holdingMonitoring: { expected: 2, monitored: 1, degraded: 1 } },
    invocation: { slotET: "18:15", invocationId: "2026-09-21:18:15" },
    timestamp: "2026-09-21T22:15:00.000Z",
    dateET: "2026-09-21",
    durationMs: 42,
  });
  assert.deepEqual(record, {
    schemaVersion: JOB_RECEIPT_SCHEMA_VERSION,
    ts: "2026-09-21T22:15:00.000Z",
    dateET: "2026-09-21",
    ok: true,
    outcome: "degraded",
    outcomeReason: "partial_review_failures",
    durationMs: 42,
    error: null,
    evidence: { holdingMonitoring: { expected: 2, monitored: 1, degraded: 1 } },
    slotET: "18:15",
    invocationId: "2026-09-21:18:15",
  });
});

test("scheduler-facing exception receipt cannot expose the raw exception", () => {
  const record = buildJobRunRecord({
    ok: false,
    error: "Job failed; see logs.",
    timestamp: "2026-09-21T22:15:00.000Z",
    dateET: "2026-09-21",
    durationMs: 1,
  });
  assert.equal(record.outcome, "failed");
  assert.equal(record.outcomeReason, "job_exception");
  assert.equal(record.error, "Job failed; see logs.");
});

test("a thrown but classified partial scan retains degraded outcome alongside ok false", () => {
  const record = buildJobRunRecord({
    ok: false,
    result: Object.assign(new Error("internal provider detail"), {
      outcome: "degraded",
      outcomeReason: "partial_review_failures",
    }),
    error: "Job failed; see logs.",
    timestamp: "2026-09-21T22:15:00.000Z",
    dateET: "2026-09-21",
    durationMs: 1,
  });
  assert.deepEqual(
    { ok: record.ok, outcome: record.outcome, outcomeReason: record.outcomeReason, error: record.error },
    { ok: false, outcome: "degraded", outcomeReason: "partial_review_failures", error: "Job failed; see logs." },
  );
});
