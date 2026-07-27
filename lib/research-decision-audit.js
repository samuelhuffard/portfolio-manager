/**
 * Durable, append-only evidence for a single research candidate's final path.
 * This is deliberately separate from the mutable research ledger: a later
 * review may change the current thesis, but must not rewrite why an earlier
 * recommendation was accepted, revised, rejected, or blocked.
 */
const PREFIX = "pm:research-decision-audit";
const TTL_SECONDS = 45 * 24 * 60 * 60;

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
  };
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
  return { retained: normalized.length, key };
}
