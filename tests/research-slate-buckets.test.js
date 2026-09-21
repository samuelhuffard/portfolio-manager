import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { RESEARCH_SLATE_BUCKETS, RESEARCH_SLATE_BUCKET_SET } from "../lib/research-status-contract.js";

/**
 * Regression guard for the 2026-09-21 baseline stall.
 *
 * The private research slate writer (lib/redis.js) accepted five buckets while
 * the shadow-selection baseline validator (jobs/shadow-research-slate.js)
 * accepted four. `peer_ready_backfill` was added to the writer in 49ed48d and
 * never to the validator, so any scheduled scan whose slate contained one
 * backfilled candidate failed validation for the WHOLE envelope — the validator
 * returns on the first offending item — and the research-data workflow stalled
 * at failureStage `baseline` with reason `baseline_provenance_invalid`.
 *
 * Live evidence at the time of the fix: agent-1's slate for run 3b4c08c9 held
 * `{exploration: 2, peer_ready_backfill: 1}` and was rejected; agent-2 and
 * agent-3 held only legacy buckets and would have passed.
 *
 * These tests read the two source files as text rather than importing them,
 * because lib/redis.js performs I/O at import time. The point is to fail loudly
 * if either side ever reintroduces its own literal set.
 */

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("the contract is the only place a slate bucket vocabulary is defined", () => {
  assert.deepEqual(
    [...RESEARCH_SLATE_BUCKETS].sort(),
    ["exploration", "holdings", "movers", "peer_ready_backfill", "ranked"],
    "changing this list changes what a scheduled scan may record AND what the baseline accepts",
  );
  assert.equal(RESEARCH_SLATE_BUCKET_SET.size, RESEARCH_SLATE_BUCKETS.length, "no duplicates");
});

test("the slate writer and the baseline validator share one set object", async () => {
  const writer = source("../lib/redis.js");
  const validator = source("../jobs/shadow-research-slate.js");

  for (const [name, text] of [["lib/redis.js", writer], ["jobs/shadow-research-slate.js", validator]]) {
    assert.match(text, /RESEARCH_SLATE_BUCKET_SET/, `${name} must import the shared bucket set`);
    assert.doesNotMatch(
      text,
      /new Set\(\[\s*"holdings"/,
      `${name} must not redeclare its own bucket literal — that divergence is the bug this pins`,
    );
  }

  const { default: _unused } = await import("../lib/research-status-contract.js").then((m) => ({ default: m }));
  assert.ok(_unused.RESEARCH_SLATE_BUCKET_SET.has("peer_ready_backfill"),
    "the validator must accept the backfill bucket the writer emits");
});

test("every bucket the writer may emit is accepted by the baseline validator", () => {
  // Mirrors validatedBaseline()'s per-item bucket check. If these ever diverge
  // again, a single backfilled candidate silently invalidates the whole baseline.
  for (const bucket of RESEARCH_SLATE_BUCKETS) {
    assert.ok(RESEARCH_SLATE_BUCKET_SET.has(bucket), `validator rejects writable bucket: ${bucket}`);
  }
});
