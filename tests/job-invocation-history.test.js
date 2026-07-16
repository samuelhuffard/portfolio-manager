import test from "node:test";
import assert from "node:assert/strict";
import {
  JOB_INVOCATION_SLOTS, appendJobInvocationHistory, expectedJobInvocationIds, validateInvocationHistory,
} from "../lib/job-invocation-history.js";

test("scheduled invocation rosters exactly match scheduler cadence", () => {
  assert.deepEqual(JOB_INVOCATION_SLOTS["holdings-sync"], ["09:30", "11:00", "13:00", "15:00", "16:30"]);
  assert.equal(JOB_INVOCATION_SLOTS["intraday-monitor"].length, 14);
  assert.deepEqual(expectedJobInvocationIds("order-reconciliation", "2026-07-14"), ["2026-07-14/16:40"]);
});

test("history keeps every attempt and accepts a recovered retry for the same invocation", async () => {
  const lists = new Map();
  const redis = {
    async rpush(key, value) { lists.set(key, [...(lists.get(key) ?? []), value]); },
    async ltrim(key, start) { lists.set(key, (lists.get(key) ?? []).slice(start)); },
    async expire() {},
  };
  for (const slotET of JOB_INVOCATION_SLOTS["holdings-sync"].filter((slot) => slot !== "11:00")) {
    await appendJobInvocationHistory("holdings-sync", { dateET: "2026-07-14", slotET, ok: true }, { redis });
  }
  await appendJobInvocationHistory("holdings-sync", { dateET: "2026-07-14", slotET: "11:00", ok: false }, { redis });
  await appendJobInvocationHistory("holdings-sync", { dateET: "2026-07-14", slotET: "11:00", ok: true }, { redis });
  const records = lists.get("pm:job:holdings-sync:history:2026-07-14").map(JSON.parse);
  const result = validateInvocationHistory("holdings-sync", "2026-07-14", records);
  assert.equal(result.ok, true);
  assert.deepEqual(result.issues, []);
});

test("a final failed retry remains blocking", () => {
  const result = validateInvocationHistory("holdings-sync", "2026-07-14", JOB_INVOCATION_SLOTS["holdings-sync"].flatMap((slotET) => {
    const record = { dateET: "2026-07-14", slotET, invocationId: `2026-07-14/${slotET}`, ok: true };
    return slotET === "11:00" ? [record, { ...record, ok: false }] : [record];
  }));
  assert.equal(result.ok, false);
  assert.deepEqual(result.issues, [{ invocationId: "2026-07-14/11:00", reason: "failed_or_malformed" }]);
});
