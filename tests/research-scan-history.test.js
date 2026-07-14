import test from "node:test";
import assert from "node:assert/strict";
import { setResearchScanStatus } from "../lib/redis.js";

function redisFixture() {
  const values = new Map();
  const lists = new Map();
  return {
    values,
    lists,
    async set(key, value) { values.set(key, value); return "OK"; },
    async eval(_script, keys, args) {
      const [marker, history] = keys;
      const [fingerprint, payload, maxIndex] = args;
      const existing = values.get(marker);
      if (existing) return existing === fingerprint ? 0 : -1;
      lists.set(history, [payload, ...(lists.get(history) ?? [])].slice(0, Number(maxIndex) + 1));
      values.set(marker, fingerprint);
      return 1;
    },
  };
}

function terminal(overrides = {}) {
  return {
    runId: "run-1",
    source: "scheduled",
    status: "completed",
    startedAt: "2026-07-14T20:00:00.000Z",
    completedAt: "2026-07-14T20:10:00.000Z",
    totals: { attemptedReviews: 3 },
    agents: [],
    ...overrides,
  };
}

test("terminal research history appends once per identical runId outcome", async () => {
  const redis = redisFixture();
  const first = await setResearchScanStatus(terminal(), { redis, now: () => new Date("2026-07-14T20:11:00.000Z") });
  const replay = await setResearchScanStatus(terminal(), { redis, now: () => new Date("2026-07-14T20:12:00.000Z") });
  assert.equal(first.history.appended, true);
  assert.equal(replay.history.deduplicated, true);
  assert.equal(redis.lists.get("pm:research-scan:history").length, 1);
});

test("one runId cannot acquire conflicting terminal outcomes", async () => {
  const redis = redisFixture();
  await setResearchScanStatus(terminal(), { redis });
  await assert.rejects(
    () => setResearchScanStatus(terminal({ status: "failed", error: "late replay" }), { redis }),
    /Conflicting terminal research status/
  );
  assert.equal(redis.lists.get("pm:research-scan:history").length, 1);
});
