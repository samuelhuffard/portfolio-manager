// Pure schedule recovery policy for the Mac-side sysloop runner. node-cron
// cannot replay a callback after sleep; the runner invokes this again when its
// event loop resumes. Child-level Redis caps remain the durable duplicate guard.

function minutes(et) {
  return Number(et?.hour) * 60 + Number(et?.minute);
}

export function priorDateET(date) {
  const value = new Date(`${date}T16:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date)) || !Number.isFinite(value.getTime())) return null;
  value.setUTCDate(value.getUTCDate() - 1);
  return value.toISOString().slice(0, 10);
}

/**
 * Returns overdue Mac-side jobs that are still useful to run. A missed Sunday
 * weekly report can be recovered on Monday, but preserves Sunday's ISO-week
 * period instead of silently writing into the new week.
 */
export function sysloopCatchUpJobs(et) {
  const minute = minutes(et);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(et?.date)) || !Number.isFinite(minute)) return [];
  const jobs = [];
  if (["Mon", "Tue", "Wed", "Thu", "Fri"].includes(et.weekday) && minute >= 18 * 60 + 35) {
    jobs.push({ script: "sysloop-triage.mjs", key: `triage:${et.date}`, args: [] });
  }
  if (et.weekday === "Sun" && minute >= 10 * 60) {
    jobs.push({ script: "sysloop-weekly.mjs", key: `weekly:${et.date}`, args: [`--as-of=${et.date}`] });
  }
  if (et.weekday === "Mon") {
    const sunday = priorDateET(et.date);
    if (sunday) jobs.push({ script: "sysloop-weekly.mjs", key: `weekly:${sunday}`, args: [`--as-of=${sunday}`] });
  }
  return jobs;
}
