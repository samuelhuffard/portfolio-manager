import "dotenv/config";
import { getServiceAccountClients, resolveSharedSpreadsheetId, readAgentRecommendationAuditRows } from "../lib/sheets.js";
import { AGENTS } from "../config/agents.js";
import { getRedis } from "../lib/redis.js";
import {
  RESEARCH_DECISION_AUDIT_SOURCES,
  LEGACY_AUDIT_START_AT,
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
      if (!audit.runId || !audit.ticker || !audit.decidedAt || audit.decidedAt < LEGACY_AUDIT_START_AT || seen.has(audit.runId)) continue;
      seen.add(audit.runId);
      audits.push(audit);
    }
  }
  return audits.sort((left, right) => Date.parse(right.decidedAt) - Date.parse(left.decidedAt));
}

export function buildBackfilledAuditHistory(rowsByAgent, existing = []) {
  const parsed = existing.map(parseRecord).filter(Boolean);
  // Reproject the legacy slice from its source every time. This prevents an
  // older migration shape from implying that a sheet recommendation was ever
  // queued as a proposal, while preserving all current scan-native history.
  const preserved = parsed.filter((record) => record.source !== RESEARCH_DECISION_AUDIT_SOURCES.LEGACY_SHEET);
  const legacy = backfillableLegacyAudits(rowsByAgent, preserved);
  const records = [...preserved, ...legacy]
    .sort((left, right) => Date.parse(right.decidedAt) - Date.parse(left.decidedAt))
    .slice(0, MAX_HISTORY_RECORDS);
  return {
    records,
    preservedNonLegacy: preserved.length,
    removedLegacy: parsed.length - preserved.length,
    importedLegacy: legacy.length,
  };
}

export async function runBackfill({ redis, sheets, spreadsheetId, apply = false } = {}) {
  if (!redis || !sheets || !spreadsheetId) throw new Error("Redis, Sheets client, and spreadsheet ID are required.");
  const [existing, ...agentRows] = await Promise.all([
    redis.lrange(HISTORY_KEY, 0, MAX_HISTORY_RECORDS - 1),
    ...AGENTS.map((agent) => readAgentRecommendationAuditRows(sheets, spreadsheetId, agent.id)),
  ]);
  const rowsByAgent = Object.fromEntries(AGENTS.map((agent, index) => [agent.id, agentRows[index]]));
  const rebuilt = buildBackfilledAuditHistory(rowsByAgent, existing);
  if (apply) {
    if (await redis.get("pm:workflow-lock:research")) {
      throw new Error("Research scan is active; refusing to rewrite the historical audit slice.");
    }
    await redis.del(HISTORY_KEY);
    if (rebuilt.records.length) {
      await redis.rpush(HISTORY_KEY, ...rebuilt.records.map((audit) => JSON.stringify(audit)));
      await redis.ltrim(HISTORY_KEY, 0, MAX_HISTORY_RECORDS - 1);
    }
  }
  return {
    source: RESEARCH_DECISION_AUDIT_SOURCES.LEGACY_SHEET,
    existing: existing.length,
    legacyStartAt: LEGACY_AUDIT_START_AT,
    rowsRead: Object.fromEntries(Object.entries(rowsByAgent).map(([agentId, rows]) => [agentId, rows.length])),
    preservedNonLegacy: rebuilt.preservedNonLegacy,
    removedLegacy: rebuilt.removedLegacy,
    importedLegacy: rebuilt.importedLegacy,
    retained: rebuilt.records.length,
    applied: apply,
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
