import { etDateString } from "./market-calendar.js";

export const JOB_HISTORY_TTL_SECONDS = 14 * 24 * 60 * 60;
export const JOB_HISTORY_MAX = 100;

export const JOB_INVOCATION_SLOTS = Object.freeze({
  "holdings-sync": Object.freeze(["09:30", "11:00", "13:00", "15:00", "16:30"]),
  "order-reconciliation": Object.freeze(["16:40"]),
  "system-sentinel": Object.freeze(["18:15", "20:10"]),
  "intraday-monitor": Object.freeze([
    "09:35", "10:00", "10:30", "11:00", "11:30", "12:00", "12:30",
    "13:00", "13:30", "14:00", "14:30", "15:00", "15:30", "15:50",
  ]),
});

export function jobInvocationId(dateET, slotET) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateET)) || !/^\d{2}:\d{2}$/.test(String(slotET))) {
    throw new TypeError("Job invocation requires YYYY-MM-DD dateET and HH:mm slotET.");
  }
  return `${dateET}/${slotET}`;
}

export function expectedJobInvocationIds(job, dateET) {
  const slots = JOB_INVOCATION_SLOTS[job];
  if (!slots) throw new TypeError(`Unknown scheduled invocation job: ${job}`);
  return slots.map((slot) => jobInvocationId(dateET, slot));
}

export function jobInvocationHistoryKey(job, dateET) {
  if (!JOB_INVOCATION_SLOTS[job]) throw new TypeError(`Unknown scheduled invocation job: ${job}`);
  return `pm:job:${job}:history:${dateET}`;
}

export async function appendJobInvocationHistory(job, record, {
  redis,
  now = new Date(),
} = {}) {
  if (!redis) throw new Error("Redis is required for job invocation history.");
  const dateET = record?.dateET ?? etDateString(now);
  const slots = JOB_INVOCATION_SLOTS[job];
  if (!slots?.includes(record?.slotET)) throw new Error(`Unexpected ${job} invocation slot: ${record?.slotET ?? "missing"}`);
  const invocationId = jobInvocationId(dateET, record.slotET);
  const payload = { ...record, job, dateET, invocationId };
  const key = jobInvocationHistoryKey(job, dateET);
  await redis.rpush(key, JSON.stringify(payload));
  await redis.ltrim(key, -JOB_HISTORY_MAX, -1);
  await redis.expire(key, JOB_HISTORY_TTL_SECONDS);
  return payload;
}

export function validateInvocationHistory(job, dateET, records) {
  const expected = expectedJobInvocationIds(job, dateET);
  const rows = Array.isArray(records) ? records : [];
  const issues = [];
  for (const invocationId of expected) {
    const matches = rows.filter((row) => row?.invocationId === invocationId && row?.dateET === dateET);
    if (matches.length === 0) {
      issues.push({ invocationId, reason: "missing" });
      continue;
    }
    // Histories are append-only, so retries remain auditable. The final retained
    // attempt is the invocation's operational outcome: a recovered retry is not
    // a hidden failure, while a later failure after an earlier success still is.
    if (matches.at(-1)?.ok !== true) issues.push({ invocationId, reason: "failed_or_malformed" });
  }
  return { expected, records: rows, issues, ok: issues.length === 0 };
}
