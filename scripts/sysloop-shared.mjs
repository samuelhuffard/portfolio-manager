import "dotenv/config";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { getRedis } from "../lib/redis.js";

// Shared plumbing for the Mac-side sysloop tiers (triage + weekly).
// LLM calls run through `claude -p` under the Claude Code subscription — never
// the Anthropic API — with a hard-restricted read-only tool surface.

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const OPS = {
  findings: path.join(REPO_ROOT, "ops", "findings"),
  reports: path.join(REPO_ROOT, "ops", "reports"),
  proposedPatches: path.join(REPO_ROOT, "ops", "proposed-patches"),
  proposedTests: path.join(REPO_ROOT, "ops", "proposed-tests"),
};

const pExecFile = promisify(execFile);

export function etToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(now);
}

export function isoWeek(now = new Date()) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** A durable marker represents completed work, never merely an attempt. */
export function isSuccessfulRunMarker(value) {
  if (!value) return false;
  try {
    const marker = typeof value === "string" ? JSON.parse(value) : value;
    return marker?.state === "success" && typeof marker.completedAt === "string";
  } catch {
    // Legacy timestamp-only keys are unproven attempts. Permit a bounded retry
    // rather than treating an old crash as a successful weekly run.
    return false;
  }
}

// Lock ownership must be checked and changed atomically: an expired lock can
// be acquired by a new runner between a client-side GET and DEL/SET. Both
// scripts return 1 only when the exact token still owns the in-flight lock.
const RELEASE_LEASE_IF_OWNER = `-- PM_SYSLOOP_RELEASE_IF_OWNER
local marker = redis.call("GET", KEYS[1])
if not marker then return 0 end
local ok, parsed = pcall(cjson.decode, marker)
if not ok or parsed.token ~= ARGV[1] then return 0 end
return redis.call("DEL", KEYS[1])`;

const COMPLETE_LEASE_IF_OWNER = `-- PM_SYSLOOP_COMPLETE_IF_OWNER
local marker = redis.call("GET", KEYS[1])
if not marker then return 0 end
local ok, parsed = pcall(cjson.decode, marker)
if not ok or parsed.token ~= ARGV[1] then return 0 end
redis.call("SET", KEYS[2], ARGV[2], "EX", ARGV[3])
redis.call("DEL", KEYS[1])
return 1`;

// INCR creates a key without a TTL. Keep the increment and first-expiry write
// in one Redis script so an interrupted client cannot leave a period's attempt
// counter permanent and falsely cap that period forever.
const INCREMENT_ATTEMPT_WITH_TTL = `-- PM_SYSLOOP_INCREMENT_ATTEMPT_WITH_TTL
local attempts = redis.call("INCR", KEYS[1])
if attempts == 1 then redis.call("EXPIRE", KEYS[1], ARGV[1]) end
return attempts`;

async function releaseLeaseLock({ redis, lockKey, token }) {
  return (await redis.eval(RELEASE_LEASE_IF_OWNER, [lockKey], [token])) === 1;
}

/**
 * Acquire a short in-flight lock for one run. A durable success marker is
 * written only by completeRunLease(), so a crash releases/retries rather than
 * consuming the full daily/weekly success window.
 */
export async function acquireRunLease({
  key,
  successTtlSeconds,
  lockTtlSeconds,
  maxAttempts,
  force = false,
  redis = getRedis(),
} = {}) {
  if (!key?.startsWith("pm:sysloop:")) throw new Error(`sysloop run key outside namespace: ${key}`);
  if (!redis) {
    console.error("[Sysloop] Redis not configured — refusing to run LLM tier without a lease");
    return { lease: null, reason: "redis_unavailable" };
  }
  if (!force && isSuccessfulRunMarker(await redis.get(key))) return { lease: null, reason: "already_succeeded", redis };

  const lockKey = `${key}:inflight`;
  const token = randomUUID();
  const acquired = await redis.set(lockKey, JSON.stringify({ token, startedAt: new Date().toISOString() }), {
    nx: true,
    ex: lockTtlSeconds,
  });
  if (acquired === null) return { lease: null, reason: "inflight", redis };

  const attemptsKey = `${key}:attempts`;
  try {
    const priorAttempts = Number(await redis.get(attemptsKey) ?? 0);
    if (!force && Number.isInteger(maxAttempts) && maxAttempts > 0 && priorAttempts >= maxAttempts) {
      await releaseLeaseLock({ redis, lockKey, token });
      return { lease: null, reason: "attempt_cap", attempts: priorAttempts, redis };
    }
    const attempts = Number(await redis.eval(
      INCREMENT_ATTEMPT_WITH_TTL,
      [attemptsKey],
      [String(successTtlSeconds)],
    ));
    return {
      lease: { redis, key, lockKey, token, successTtlSeconds },
      reason: null,
      attempts,
    };
  } catch (error) {
    await releaseLeaseLock({ redis, lockKey, token });
    throw error;
  }
}

export async function completeRunLease(lease) {
  if (!lease) return false;
  const marker = JSON.stringify({ state: "success", completedAt: new Date().toISOString() });
  return (await lease.redis.eval(
    COMPLETE_LEASE_IF_OWNER,
    [lease.lockKey, lease.key],
    [lease.token, marker, String(lease.successTtlSeconds)],
  )) === 1;
}

export async function abandonRunLease(lease) {
  if (lease) await releaseLeaseLock(lease);
}

const CLAUDE_TIMEOUT_MS = { triage: 5 * 60 * 1000, weekly: 15 * 60 * 1000 };

// Sam runs a Claude Pro subscription: Sonnet 5 is the ceiling for `claude -p`
// here (Opus/Fable are Max-tier and overkill for this loop anyway). One knob,
// env-overridable, used by every sysloop LLM call.
export const SYSLOOP_MODEL = (process.env.SYSLOOP_MODEL ?? "sonnet").trim();

/**
 * Runs `claude -p` with the sysloop guardrails baked in (not configurable by
 * callers): read-only tools, no MCP servers, bounded turns, JSON envelope.
 * Returns the parsed JSON object the model was asked to emit, or null if the
 * run failed or the output doesn't parse — absent evidence is not passing
 * evidence, so callers must treat null as "produce nothing".
 */
export async function runClaudeJson({ prompt, role = "triage", model = SYSLOOP_MODEL, maxTurns = 15 }) {
  const args = [
    "-p",
    "--output-format", "json",
    "--strict-mcp-config",           // no MCP servers — Robinhood tools unreachable
    "--allowedTools", "Read,Grep,Glob", // read-only repo access; Bash/Edit/Write denied
    "--max-turns", String(maxTurns),
    "--model", model,
  ];
  const timeout = CLAUDE_TIMEOUT_MS[role] ?? CLAUDE_TIMEOUT_MS.triage;

  const stdout = await new Promise((resolve) => {
    const child = spawn("claude", args, { cwd: REPO_ROOT, stdio: ["pipe", "pipe", "pipe"] });
    let out = "", err = "";
    const timer = setTimeout(() => { child.kill("SIGKILL"); }, timeout);
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { err += d; });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        console.error(`[Sysloop] claude -p exited ${code}: ${err.slice(0, 400)}`);
        resolve(null);
      } else resolve(out);
    });
    child.on("error", (e) => { clearTimeout(timer); console.error("[Sysloop] claude spawn failed:", e.message); resolve(null); });
    child.stdin.write(prompt);
    child.stdin.end();
  });
  if (!stdout) return null;

  try {
    const envelope = JSON.parse(stdout);
    if (envelope.is_error) {
      console.error("[Sysloop] claude reported error:", String(envelope.result).slice(0, 400));
      return null;
    }
    const text = String(envelope.result ?? "");
    const jsonText = text.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1] ?? text;
    const start = jsonText.indexOf("{");
    const end = jsonText.lastIndexOf("}");
    if (start === -1 || end === -1) throw new Error("no JSON object in model output");
    return JSON.parse(jsonText.slice(start, end + 1));
  } catch (e) {
    console.error("[Sysloop] failed to parse claude output — producing NO findings:", e.message);
    return null;
  }
}

export async function gitLog(repoDir, count = 15) {
  try {
    const { stdout } = await pExecFile("git", ["log", "--oneline", `-${count}`], { cwd: repoDir, timeout: 10000 });
    return stdout.trim();
  } catch {
    return "(git log unavailable)";
  }
}

export async function telegramSafe(text) {
  try {
    const { sendMessage } = await import("../lib/telegram.js");
    await sendMessage(text);
    return true;
  } catch (e) {
    console.error("[Sysloop] Telegram unavailable on this host:", e.message);
    return false;
  }
}

export function truncate(text, maxChars) {
  const s = String(text);
  return s.length <= maxChars ? s : s.slice(0, maxChars) + `\n…[truncated ${s.length - maxChars} chars]`;
}
