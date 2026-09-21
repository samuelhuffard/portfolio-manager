import { test } from "node:test";
import assert from "node:assert/strict";
import { priorDateET, sysloopCatchUpJobs } from "../scripts/sysloop-catchup.js";
import { readFileSync } from "node:fs";

test("sysloop catch-up recovers same-day triage only after its scheduled time", () => {
  assert.deepEqual(sysloopCatchUpJobs({ date: "2026-09-21", weekday: "Mon", hour: 18, minute: 34 }), [
    { script: "sysloop-weekly.mjs", key: "weekly:2026-09-20", args: ["--as-of=2026-09-20"] },
  ]);
  assert.deepEqual(sysloopCatchUpJobs({ date: "2026-09-21", weekday: "Mon", hour: 18, minute: 35 }), [
    { script: "sysloop-triage.mjs", key: "triage:2026-09-21", args: [] },
    { script: "sysloop-weekly.mjs", key: "weekly:2026-09-20", args: ["--as-of=2026-09-20"] },
  ]);
});

test("sysloop catch-up retries a missed Sunday weekly run using Sunday's reporting period", () => {
  assert.deepEqual(sysloopCatchUpJobs({ date: "2026-09-20", weekday: "Sun", hour: 9, minute: 59 }), []);
  assert.deepEqual(sysloopCatchUpJobs({ date: "2026-09-20", weekday: "Sun", hour: 14, minute: 0 }), [
    { script: "sysloop-weekly.mjs", key: "weekly:2026-09-20", args: ["--as-of=2026-09-20"] },
  ]);
  assert.equal(priorDateET("2026-09-21"), "2026-09-20");
});

test("sysloop catch-up does not launch tiers on unsupported weekdays", () => {
  assert.deepEqual(sysloopCatchUpJobs({ date: "2026-09-19", weekday: "Sat", hour: 18, minute: 35 }), []);
  assert.deepEqual(sysloopCatchUpJobs({ date: "bad", weekday: "Mon", hour: 20, minute: 0 }), []);
});

test("Mac launch guard releases a finished or failed child so the durable lease can retry", () => {
  const source = readFileSync(new URL("../scripts/sysloop-mac.mjs", import.meta.url), "utf8");
  assert.match(source, /child\.on\("close",[\s\S]*?launched\.delete\(key\)/);
  assert.match(source, /child\.on\("error",[\s\S]*?launched\.delete\(key\)/);
});
