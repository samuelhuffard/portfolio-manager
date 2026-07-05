import "dotenv/config";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import cron from "node-cron";
import { getRedis, listAllProposals } from "../lib/redis.js";
import { telegramSafe } from "./sysloop-shared.mjs";

// Mac-side sysloop runner — PM2 process `portfolio-sysloop` (runs from this
// working tree, same deploy model as portfolio-executor).
//
//  - every 30 min: cross-watch. The two things only the Mac can see:
//      (a) the Jetson going fully silent (its own sentinel can't report that)
//      (b) approved proposals waiting while the executor is offline DURING
//          market hours (the Jetson sentinel only looks at 18:15, after close)
//  - 18:35 ET Mon–Fri: Tier 1 triage (deterministic ledger merge + claude -p)
//  - Sun 10:00 ET: Tier 2 weekly Researcher + Skeptic
//
// Child scripts run as separate processes so a crash there never kills this
// scheduler; each has its own Redis rate cap, so a double-fire is harmless.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TZ = { timezone: "America/New_York" };

function runScript(name) {
  const child = spawn(process.execPath, [path.join(HERE, name)], { stdio: "inherit" });
  child.on("close", (code) => {
    if (code !== 0) console.error(`[SysloopMac] ${name} exited ${code}`);
  });
}

function etNow() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false, weekday: "short",
  }).formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t)?.value;
  return { date: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")) % 24, minute: Number(get("minute")), weekday: get("weekday") };
}

async function alertOnce(redis, key, message) {
  // NX key = one alert per condition per day, not one every 30 minutes.
  const res = await redis.set(`pm:sysloop:${key}`, "1", { nx: true, ex: 24 * 3600 }).catch(() => null);
  if (res === null) return;
  console.error(`[SysloopMac] ALERT: ${message}`);
  await telegramSafe(`Sysloop cross-watch: ${message}`);
}

async function crossWatch() {
  const redis = getRedis();
  if (!redis) {
    console.error("[SysloopMac] Redis not configured — cross-watch blind");
    return;
  }
  const et = etNow();
  const weekday = !["Sat", "Sun"].includes(et.weekday);

  // (a) Jetson sentinel liveness — after 19:00 ET on a weekday, today's run must exist.
  if (weekday && et.hour >= 19) {
    const raw = await redis.get("pm:sysloop:last-run").catch(() => null);
    const lastRun = raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : null;
    if (!lastRun || lastRun.date !== et.date) {
      await alertOnce(redis, `crosswatch:jetson:${et.date}`,
        `Jetson sentinel has not run today (last: ${lastRun?.date ?? "never"}) — Jetson down, PM2 stopped, or scheduler broken`);
    }
  }

  // (b) approved-but-unexecuted during market hours while executor is stale.
  const mins = et.hour * 60 + et.minute;
  const marketOpen = weekday && mins >= 9 * 60 + 30 && mins < 16 * 60;
  if (marketOpen) {
    const proposals = await listAllProposals().catch(() => []);
    const waiting = proposals.filter((p) => p?.status === "ApprovedForBrokerReview" && !p.fulfilledAt && p.decidedAt && Date.now() - Date.parse(p.decidedAt) > 30 * 60 * 1000);
    if (waiting.length > 0) {
      const lastSeenRaw = await redis.get("pm:companion:last-seen").catch(() => null);
      const n = Number(lastSeenRaw);
      const lastSeenMs = Number.isFinite(n) && n > 0 ? (n < 1e12 ? n * 1000 : n) : Date.parse(lastSeenRaw ?? "");
      const executorStale = !Number.isFinite(lastSeenMs) || Date.now() - lastSeenMs > 10 * 60 * 1000;
      if (executorStale) {
        await alertOnce(redis, `crosswatch:executor:${et.date}`,
          `${waiting.length} approved proposal(s) unexecuted >30min during market hours and the executor heartbeat is stale — is this Mac's portfolio-executor running/awake?`);
      }
    }
  }
}

cron.schedule("*/30 * * * *", () => crossWatch().catch((e) => console.error("[SysloopMac] cross-watch error:", e.message)), TZ);
cron.schedule("35 18 * * 1-5", () => runScript("sysloop-triage.mjs"), TZ);
cron.schedule("0 10 * * 0", () => runScript("sysloop-weekly.mjs"), TZ);

console.log("[SysloopMac] started — cross-watch every 30 min | triage 6:35 PM Mon–Fri | weekly Sun 10 AM (ET)");
