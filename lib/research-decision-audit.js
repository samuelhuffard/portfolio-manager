/**
 * Durable, append-only evidence for a single research candidate's final path.
 * This is deliberately separate from the mutable research ledger: a later
 * review may change the current thesis, but must not rewrite why an earlier
 * recommendation was accepted, revised, rejected, or blocked.
 */
const PREFIX = "pm:research-decision-audit";
const TTL_SECONDS = 45 * 24 * 60 * 60;
const HISTORY_KEY = `${PREFIX}:history`;
const MAX_HISTORY_RECORDS = 5_000;

export const RESEARCH_DECISION_AUDIT_SOURCES = Object.freeze({
  SCAN: "scheduled_scan",
  LEGACY_SHEET: "legacy_recommendation_sheet",
});

export function researchDecisionAuditKey(runId) {
  return `${PREFIX}:run:${encodeURIComponent(String(runId))}`;
}

export function normalizeResearchDecisionAudit(record) {
  const text = (value) => typeof value === "string" ? value.trim() : "";
  const critique = Array.isArray(record?.evaluatorCritique)
    ? record.evaluatorCritique.map(text).filter(Boolean)
    : [];
  return {
    schemaVersion: "research-decision-audit-v1",
    source: Object.values(RESEARCH_DECISION_AUDIT_SOURCES).includes(record?.source)
      ? record.source
      : RESEARCH_DECISION_AUDIT_SOURCES.SCAN,
    runId: text(record?.runId),
    agentId: text(record?.agentId),
    ticker: text(record?.ticker).toUpperCase(),
    decidedAt: text(record?.decidedAt),
    quantScore: Number.isFinite(record?.quantScore) ? record.quantScore : null,
    generatorAction: text(record?.generatorAction) || null,
    finalAction: text(record?.finalAction) || null,
    evaluatorState: text(record?.evaluatorState) || "not_run",
    evaluatorVerdict: text(record?.evaluatorVerdict) || "not run",
    evaluatorCritique: critique,
    proposalDisposition: text(record?.proposalDisposition) || "not_applicable",
    proposalId: text(record?.proposalId) || null,
    reason: text(record?.reason) || null,
    ruleCheck: Array.isArray(record?.ruleCheck) ? record.ruleCheck.map(text).filter(Boolean) : [],
    generatorThesis: text(record?.generatorThesis) || null,
    finalThesis: text(record?.finalThesis) || null,
    rationale: text(record?.rationale) || null,
    requestedTargetWeight: Number.isFinite(record?.requestedTargetWeight) ? record.requestedTargetWeight : null,
    finalTargetWeight: Number.isFinite(record?.finalTargetWeight) ? record.finalTargetWeight : null,
    evaluatorRevisions: Number.isInteger(record?.evaluatorRevisions) ? record.evaluatorRevisions : 0,
    kairosOutcome: text(record?.kairosOutcome) || "not_recorded",
    kairosExplanation: Array.isArray(record?.kairosExplanation) ? record.kairosExplanation.map(text).filter(Boolean) : [],
  };
}

/**
 * Project one historical Agent recommendation-sheet row into the immutable
 * audit shape. Older rows predate candidate-level evaluator/Kairos retention,
 * so the provenance is explicit and unavailable fields stay unavailable.
 */
export function legacyRecommendationToDecisionAudit(row, { agentId, sheetRow } = {}) {
  const text = (value) => typeof value === "string" ? value.trim() : "";
  const ticker = text(row?.ticker).toUpperCase();
  const action = text(row?.action).toUpperCase();
  const date = text(row?.date);
  const decidedAt = /^\d{4}-\d{2}-\d{2}$/.test(date) ? `${date}T12:00:00.000Z` : "";
  const safeRow = Number.isInteger(sheetRow) && sheetRow > 0 ? sheetRow : null;
  return normalizeResearchDecisionAudit({
    source: RESEARCH_DECISION_AUDIT_SOURCES.LEGACY_SHEET,
    runId: safeRow ? `legacy-sheet:${agentId}:${safeRow}` : "",
    agentId,
    ticker,
    decidedAt,
    quantScore: Number.isFinite(row?.quantScore) ? row.quantScore : null,
    generatorAction: action || null,
    finalAction: action || null,
    evaluatorState: "not_recorded_legacy",
    evaluatorVerdict: "Not recorded in the legacy recommendation sheet.",
    proposalDisposition: "legacy_recommendation_record",
    reason: text(row?.rationale) || "Legacy recommendation retained without a narrative.",
    ruleCheck: [
      `Historical backfill from Agent recommendation sheet row ${safeRow ?? "unknown"}.`,
      ...(text(row?.status) ? [`Legacy status: ${text(row.status)}.`] : []),
      ...(text(row?.ruleCheck) ? [`Legacy rule check: ${text(row.ruleCheck)}.`] : []),
    ],
    generatorThesis: text(row?.rationale) || null,
    finalThesis: text(row?.rationale) || null,
    rationale: text(row?.rationale) || null,
    requestedTargetWeight: Number.isFinite(row?.targetWeight) ? row.targetWeight : null,
    finalTargetWeight: Number.isFinite(row?.targetWeight) ? row.targetWeight : null,
    kairosOutcome: "not_recorded_legacy",
    kairosExplanation: ["Kairos was not yet retained as a candidate-level review trace for this historical row."],
  });
}

export async function appendResearchDecisionAudits(records, { redis, ttlSeconds = TTL_SECONDS } = {}) {
  if (!redis) throw new Error("Redis is required to retain research decision audits.");
  const normalized = records.map(normalizeResearchDecisionAudit)
    .filter((record) => record.runId && record.agentId && record.ticker && record.decidedAt);
  if (!normalized.length) return { retained: 0 };
  const runIds = new Set(normalized.map((record) => record.runId));
  if (runIds.size !== 1) throw new Error("Research decision audit records must belong to one run.");
  const key = researchDecisionAuditKey(normalized[0].runId);
  // One append is an ordered immutable snapshot of the run's outcomes. A
  // caller never uses this store to determine whether an order may be placed.
  await redis.rpush(key, ...normalized.map((record) => JSON.stringify(record)));
  await redis.expire(key, ttlSeconds);
  // The global index is intentionally longer lived than the per-run receipt:
  // it powers the human-facing, searchable review history without making a
  // scan's volatile run key a source of truth for any execution decision.
  await redis.lpush(HISTORY_KEY, ...normalized.map((record) => JSON.stringify(record)));
  await redis.ltrim(HISTORY_KEY, 0, MAX_HISTORY_RECORDS - 1);
  return { retained: normalized.length, key, historyKey: HISTORY_KEY };
}
