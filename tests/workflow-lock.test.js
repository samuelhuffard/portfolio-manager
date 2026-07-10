import test from "node:test";
import assert from "node:assert/strict";

import { WorkflowAlreadyRunningError, acquireWorkflowLock, withWorkflowLock } from "../lib/workflow-lock.js";

function fakeRedis() {
  const values = new Map();
  return {
    values,
    async set(key, value, options) {
      if (options?.nx && values.has(key)) return null;
      values.set(key, value);
      return "OK";
    },
    async eval(_script, keys, args) {
      const [key] = keys;
      const [token] = args;
      if (values.get(key) !== token) return 0;
      values.delete(key);
      return 1;
    },
  };
}

test("workflow lock excludes overlapping owners and releases for the next run", async () => {
  const redis = fakeRedis();
  const release = await acquireWorkflowLock("holdings-sync", { redis });
  await assert.rejects(
    acquireWorkflowLock("holdings-sync", { redis }),
    (error) => error instanceof WorkflowAlreadyRunningError && error.code === "WORKFLOW_LOCKED"
  );
  assert.equal(await release(), true);
  const nextRelease = await acquireWorkflowLock("holdings-sync", { redis });
  assert.equal(await nextRelease(), true);
});

test("expired owner cannot release a replacement owner's lock", async () => {
  const redis = fakeRedis();
  const release = await acquireWorkflowLock("research", { redis });
  redis.values.set("pm:workflow-lock:research", "replacement-token");
  assert.equal(await release(), false);
  assert.equal(redis.values.get("pm:workflow-lock:research"), "replacement-token");
});

test("withWorkflowLock releases after failure", async () => {
  const redis = fakeRedis();
  await assert.rejects(
    withWorkflowLock("research", async () => { throw new Error("boom"); }, { redis }),
    /boom/
  );
  assert.equal(redis.values.has("pm:workflow-lock:research"), false);
});
