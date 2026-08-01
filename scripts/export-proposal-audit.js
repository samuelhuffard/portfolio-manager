import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getRedis } from "../lib/redis.js";
import { buildProposalAuditReviewPacket } from "../lib/proposal-audit-export.js";

const HISTORY_KEY = "pm:research-decision-audit:history";
const PROPOSALS_KEY = "pm:approval_proposals";

function option(name, fallback) {
  const value = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  return value ? value.slice(name.length + 3) : fallback;
}

function nonNegativeInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${label} must be a positive integer.`);
  return parsed;
}

function parseJson(raw, key) {
  try {
    return typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    throw new Error(`Malformed JSON in ${key}. Refusing to export a partial review packet.`);
  }
}

async function readProposals(redis, limit) {
  const ids = await redis.lrange(PROPOSALS_KEY, 0, Math.max(limit - 1, 0));
  const rows = await Promise.all(ids.map(async (id) => {
    const key = `pm:approval_proposal:${id}`;
    const raw = await redis.get(key);
    return raw == null ? null : parseJson(raw, key);
  }));
  return rows.filter(Boolean);
}

async function readJsonList(redis, key, limit) {
  const rows = await redis.lrange(key, 0, Math.max(limit - 1, 0));
  return rows.map((row) => parseJson(row, key));
}

function auditDates(days, now = new Date()) {
  return Array.from({ length: days }, (_, index) => new Date(now.getTime() - index * 86_400_000).toISOString().slice(0, 10));
}

export async function exportProposalAudit({ outPath, proposalLimit = 250, researchLimit = 500, auditDays = 30 } = {}) {
  if (!outPath) throw new Error("An output path is required.");
  const redis = getRedis();
  if (!redis) throw new Error("UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are required.");

  const [proposals, researchDecisions, ...dailyActivity] = await Promise.all([
    readProposals(redis, proposalLimit),
    readJsonList(redis, HISTORY_KEY, researchLimit),
    ...auditDates(auditDays).map((date) => readJsonList(redis, `pm:audit:${date}`, 10_000)),
  ]);
  const packet = buildProposalAuditReviewPacket({
    proposals,
    researchDecisions,
    activity: dailyActivity.flat(),
  });
  const target = resolve(outPath);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(packet, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
  return { target, proposals: proposals.length, researchDecisions: researchDecisions.length, activity: dailyActivity.flat().length };
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  const outPath = option("out", null);
  exportProposalAudit({
    outPath,
    proposalLimit: nonNegativeInteger(option("proposals", "250"), "--proposals"),
    researchLimit: nonNegativeInteger(option("research", "500"), "--research"),
    auditDays: nonNegativeInteger(option("audit-days", "30"), "--audit-days"),
  }).then((result) => {
    console.log(`[Proposal audit export] ${result.proposals} proposals, ${result.researchDecisions} research decisions, ${result.activity} activity events → ${result.target}`);
  }).catch((error) => {
    console.error(`[Proposal audit export] ${error.message}`);
    process.exit(1);
  });
}
