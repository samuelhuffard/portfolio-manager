import test from "node:test";
import assert from "node:assert/strict";
import {
  abandonRunLease,
  acquireRunLease,
  completeRunLease,
  isSuccessfulRunMarker,
} from "../scripts/sysloop-shared.mjs";

function fakeRedis() {
  const values = new Map();
  const expirations = new Map();
  return {
    values,
    expirations,
    async get(key) { return values.get(key) ?? null; },
    async set(key, value, options = {}) {
      if (options.nx && values.has(key)) return null;
      values.set(key, value);
      return "OK";
    },
    async incr(key) {
      const next = Number(values.get(key) ?? 0) + 1;
      values.set(key, String(next));
      return next;
    },
    async expire(key, seconds) { expirations.set(key, Number(seconds)); return 1; },
    async del(key) { return values.delete(key) ? 1 : 0; },
    async eval(script, keys, args) {
      const [lockKey, successKey] = keys;
      const [token, successMarker, successTtl] = args;
      if (script.includes("PM_SYSLOOP_INCREMENT_ATTEMPT_WITH_TTL")) {
        const attemptsKey = lockKey;
        const next = Number(values.get(attemptsKey) ?? 0) + 1;
        values.set(attemptsKey, String(next));
        if (next === 1) expirations.set(attemptsKey, Number(token));
        return next;
      }
      const raw = values.get(lockKey);
      let marker = null;
      try { marker = raw ? JSON.parse(raw) : null; } catch { /* malformed lock is not owned */ }
      if (marker?.token !== token) return 0;
      if (script.includes("PM_SYSLOOP_COMPLETE_IF_OWNER")) {
        values.set(successKey, successMarker);
        values.delete(lockKey);
        return 1;
      }
      if (script.includes("PM_SYSLOOP_RELEASE_IF_OWNER")) {
        values.delete(lockKey);
        return 1;
      }
      throw new Error(`Unexpected eval: ${script.slice(0, 48)} / ${successTtl ?? ""}`);
    },
  };
}

const options = (redis, overrides = {}) => ({
  key: "pm:sysloop:weekly:2026-W38",
  successTtlSeconds: 60,
  lockTtlSeconds: 30,
  maxAttempts: 2,
  redis,
  ...overrides,
});

test("a successful sysloop lease writes a durable marker and prevents duplicate work", async () => {
  const redis = fakeRedis();
  const first = await acquireRunLease(options(redis));
  assert.ok(first.lease);
  assert.equal(first.attempts, 1);
  assert.equal(await completeRunLease(first.lease), true);
  assert.equal(redis.values.has("pm:sysloop:weekly:2026-W38:inflight"), false);
  assert.equal(isSuccessfulRunMarker(await redis.get("pm:sysloop:weekly:2026-W38")), true);
  const duplicate = await acquireRunLease(options(redis));
  assert.deepEqual({ lease: duplicate.lease, reason: duplicate.reason }, { lease: null, reason: "already_succeeded" });
});

test("a failed sysloop lease releases its in-flight lock so catch-up can retry", async () => {
  const redis = fakeRedis();
  const first = await acquireRunLease(options(redis));
  await abandonRunLease(first.lease);
  assert.equal(redis.values.has("pm:sysloop:weekly:2026-W38:inflight"), false);
  assert.equal(isSuccessfulRunMarker(await redis.get("pm:sysloop:weekly:2026-W38")), false);
  const retry = await acquireRunLease(options(redis));
  assert.ok(retry.lease);
  assert.equal(retry.attempts, 2);
});

test("attempt cap bounds repeated failures without treating one as success", async () => {
  const redis = fakeRedis();
  const first = await acquireRunLease(options(redis, { maxAttempts: 1 }));
  await abandonRunLease(first.lease);
  const capped = await acquireRunLease(options(redis, { maxAttempts: 1 }));
  assert.equal(capped.lease, null);
  assert.equal(capped.reason, "attempt_cap");
  assert.equal(isSuccessfulRunMarker(await redis.get("pm:sysloop:weekly:2026-W38")), false);
  assert.equal(redis.values.has("pm:sysloop:weekly:2026-W38:inflight"), false);
});

test("attempt increment establishes its expiry atomically", async () => {
  const redis = fakeRedis();
  const first = await acquireRunLease(options(redis, { successTtlSeconds: 123 }));
  assert.ok(first.lease);
  assert.equal(redis.expirations.get("pm:sysloop:weekly:2026-W38:attempts"), 123);
  await abandonRunLease(first.lease);
  const second = await acquireRunLease(options(redis, { successTtlSeconds: 456 }));
  assert.ok(second.lease);
  assert.equal(redis.expirations.get("pm:sysloop:weekly:2026-W38:attempts"), 123,
    "a retry retains the original period expiry instead of extending its cap");
});

test("minimal weekly report reaches the success-finally path", async () => {
  const source = await import("node:fs/promises").then((fs) => fs.readFile(new URL("../scripts/sysloop-weekly.mjs", import.meta.url), "utf8"));
  assert.match(
    source,
    /if \(days\.length === 0 && open\.length === 0\) \{[\s\S]*?writeReport\([\s\S]*?succeeded = true;[\s\S]*?return;/,
  );
});

test("an expired former owner cannot release or complete a replacement lease", async () => {
  const redis = fakeRedis();
  const first = await acquireRunLease(options(redis));
  // Simulate expiry followed by a second runner acquiring the same lock.
  redis.values.delete("pm:sysloop:weekly:2026-W38:inflight");
  const second = await acquireRunLease(options(redis));
  assert.ok(second.lease);

  assert.equal(await abandonRunLease(first.lease), undefined);
  assert.equal(redis.values.has("pm:sysloop:weekly:2026-W38:inflight"), true);
  assert.equal(await completeRunLease(first.lease), false);
  assert.equal(await completeRunLease(second.lease), true);
  assert.equal(isSuccessfulRunMarker(await redis.get("pm:sysloop:weekly:2026-W38")), true);
});
