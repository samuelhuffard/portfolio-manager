import "dotenv/config";
import { getServiceAccountClients, resolveSharedSpreadsheetId, readAgentRecommendationAuditRows } from "../lib/sheets.js";
import { AGENTS } from "../config/agents.js";
import { getRedis } from "../lib/redis.js";
import {
  RESEARCH_DECISION_AUDIT_SOURCES,
  legacyRecommendationToDecisionAudit,
} from "../lib/research-decision-audit.js";

const HISTORY_KEY = "pm:research-decision-audit:history";
const MAX_HISTORY_RECORDS = 5_000;
const APPLY_FLAG = "--apply";

function parseRecord(raw) {
  try { return typeof raw === "string" ? JSON.parse(raw) : raw; } catch { return null; }
}

export function backfillableLegacyAudits(rowsByAgent, existing = []) {
  const seen = new Set(existing.map(parseRecord).filter(Boolean).map((record) => record.runId).filter(Boolean));
  const audits = [];
  for (const [agentId, rows] of Object.entries(rowsByAgent)) {
    for (const row of rows) {
      const audit = legacyRecommendationToDecisionAudit(row, { agentId, sheetRow: row.sheetRow });
      if (!audit.runId || !audit.ticker || !audit.decidedAt || seen.has(audit.runId)) continue;
      seen.add(audit.runId);
      audits.push(audit);
    }
  }
  return audits.sort((left, right) => Date.parse(right.decidedAt) - Date.parse(left.decidedAt));
}

export async function runBackfill({ redis, sheets, spreadsheetId, apply = false } = {}) {
  if (!redis || !sheets || !spreadsheetId) throw new Error("Redis, Sheets client, and spreadsheet ID are required.");
  const [existing, ...agentRows] = await Promise.all([
    redis.lrange(HISTORY_KEY, 0, MAX_HISTORY_RECORDS - 1),
    ...AGENTS.map((agent) => readAgentRecommendationAuditRows(sheets, spreadsheetId, agent.id)),
  ]);
  const rowsByAgent = Object.fromEntries(AGENTS.map((agent, index) => [agent.id, agentRows[index]]));
  const capacity = Math.max(0, MAX_HISTORY_RECORDS - existing.length);
  const audits = backfillableLegacyAudits(rowsByAgent, existing).slice(0, capacity);
  if (apply && audits.length) {
    // Existing scan records are newest-first (lpush). Backfilled rows are also
    // newest-first, appended behind them, so no current audit can be displaced.
    await redis.rpush(HISTORY_KEY, ...audits.map((audit) => JSON.stringify(audit)));
    await redis.ltrim(HISTORY_KEY, 0, MAX_HISTORY_RECORDS - 1);
  }
  return {
    source: RESEARCH_DECISION_AUDIT_SOURCES.LEGACY_SHEET,
    existing: existing.length,
    capacity,
    rowsRead: Object.fromEntries(Object.entries(rowsByAgent).map(([agentId, rows]) => [agentId, rows.length])),
    eligible: audits.length,
    applied: apply ? audits.length : 0,
  };
}

async function main() {
  const apply = process.argv.includes(APPLY_FLAG);
  const redis = getRedis();
  if (!redis) throw new Error("Redis is not configured.");
  const { sheets, drive } = getServiceAccountClients();
  const spreadsheetId = await resolveSharedSpreadsheetId(sheets, drive);
  const result = await runBackfill({ redis, sheets, spreadsheetId, apply });
  console.log(JSON.stringify({ ...result, mode: apply ? "apply" : "dry-run" }));
  if (!apply) console.log("Dry run only. Re-run with --apply to write the eligible historical rows.");
}

if (process.argv[1]?.endsWith("backfill-research-decision-audit.js")) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
