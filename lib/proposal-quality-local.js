/**
 * Fixture-only proposal-quality diagnostic.
 *
 * This module intentionally has no imports. It must stay outside runtime
 * research, model, Redis, broker, approval, signature, and proposal paths.
 */

export const PROPOSAL_QUALITY_LOCAL_VERSION = "proposal-quality-local-v1";

const FAMILIES = new Set([
  "technology", "financial_services", "healthcare", "consumer", "industrials",
  "energy", "materials", "real_estate", "utilities", "communications", "other",
]);

function sentences(text) {
  return String(text ?? "").split(/(?<=[.!?])\s+/).map((item) => item.trim()).filter(Boolean);
}

function normalize(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function businessFamily(candidate = {}) {
  const sector = normalize(candidate.sector);
  const industry = normalize(candidate.industry);
  if (!sector && !industry) return null;
  if (sector.includes("financial") || /bank|insurance|capital markets/.test(industry)) return "financial_services";
  if (sector.includes("technology") || /software|semiconductor|hardware/.test(industry)) return "technology";
  if (sector.includes("health") || /biotech|pharmaceutical|medical/.test(industry)) return "healthcare";
  if (sector.includes("real estate") || /reit/.test(industry)) return "real_estate";
  if (sector.includes("energy")) return "energy";
  if (sector.includes("utility")) return "utilities";
  if (sector.includes("industrial")) return "industrials";
  if (sector.includes("consumer")) return "consumer";
  if (sector.includes("material")) return "materials";
  if (sector.includes("communication")) return "communications";
  return "other";
}

function buildEvidence(input = {}) {
  const evidence = [];
  if (Number.isFinite(input.quantScore)) {
    evidence.push({ id: "quant_score_rank", kind: "normalized_rank", value: input.quantScore, source: "local supplied rank" });
  }
  for (const [key, value] of Object.entries(input.breakdown ?? {})) {
    if (Number.isFinite(Number(value))) evidence.push({ id: `rank_${key}`, kind: "normalized_rank", value: Number(value), source: "local supplied rank" });
  }
  for (const [index, fact] of (input.primaryFacts ?? []).entries()) {
    if (!fact || typeof fact !== "object" || fact.value == null || fact.value === "") continue;
    const id = typeof fact.id === "string" && /^[a-z][a-z0-9_]{1,80}$/i.test(fact.id) ? fact.id : `local_fact_${index + 1}`;
    evidence.push({ id, kind: "raw_fact", value: fact.value, source: String(fact.source ?? "local supplied fact") });
  }
  return evidence.filter((item, index) => evidence.findIndex((candidate) => candidate.id === item.id) === index);
}

function validateCitations(proposal, evidence) {
  const issues = [];
  const ids = new Set(evidence.map((item) => item.id));
  const action = proposal?.action ?? "HOLD";
  if (!["BUY", "SELL"].includes(action)) return issues;
  const family = normalize(proposal.claimedBusinessFamily).replace(/[ -]+/g, "_");
  if (!FAMILIES.has(family)) issues.push("missing_or_invalid_business_family");
  for (const sentence of sentences(proposal.thesis)) {
    const citation = (proposal.evidenceCitations ?? []).find((item) => item?.claim?.trim() === sentence);
    if (!citation) issues.push(`uncited_thesis_sentence:${sentence.slice(0, 120)}`);
    else if (!Array.isArray(citation.evidence_ids) || citation.evidence_ids.length === 0 || citation.evidence_ids.some((id) => !ids.has(id))) {
      issues.push(`unknown_evidence_citation:${sentence.slice(0, 120)}`);
    }
  }
  return issues;
}

function rankMisuse(proposal, evidence) {
  const byId = new Map(evidence.map((item) => [item.id, item]));
  const issues = [];
  for (const citation of proposal?.evidenceCitations ?? []) {
    const usesRank = (citation?.evidence_ids ?? []).some((id) => byId.get(id)?.kind === "normalized_rank");
    if (usesRank && /\b(?:p\/?e|multiple|price|return|growth|margin|rsi|\d+(?:\.\d+)?x)\b/i.test(String(citation.claim ?? ""))) {
      issues.push(`rank_described_as_raw_metric:${String(citation.claim).slice(0, 120)}`);
    }
  }
  return issues;
}

export function auditLocalProposalQuality({ agentId, candidate = {}, proposal = {}, baseline = {}, enriched = {} } = {}) {
  const baselineEvidence = buildEvidence(baseline);
  const evidence = buildEvidence(enriched);
  const action = proposal.action ?? "HOLD";
  const blockers = validateCitations(proposal, evidence);
  const observedFamily = businessFamily(candidate);
  const claimedFamily = normalize(proposal.claimedBusinessFamily).replace(/[ -]+/g, "_");
  if (["BUY", "SELL"].includes(action) && observedFamily && claimedFamily && observedFamily !== claimedFamily) {
    blockers.push(`business_family_mismatch:${claimedFamily}:${observedFamily}`);
  }
  blockers.push(...rankMisuse(proposal, evidence));
  const rawFacts = evidence.filter((item) => item.kind === "raw_fact");
  const evidenceGaps = rawFacts.length === 0 ? ["no_local_raw_fact"] : [];
  const disposition = !["BUY", "SELL"].includes(action) ? "not_actionable" : blockers.length ? "blocked" : "review_ready";
  return {
    version: PROPOSAL_QUALITY_LOCAL_VERSION,
    label: "synthetic_local_non_promotional",
    agentId,
    ticker: candidate.ticker ?? null,
    action,
    baselineEvidenceCount: baselineEvidence.length,
    enrichedEvidenceCount: evidence.length,
    addedEvidenceCount: Math.max(0, evidence.length - baselineEvidence.length),
    rawFactCount: rawFacts.length,
    businessFamily: observedFamily,
    blockers,
    evidenceGaps,
    disposition,
  };
}

export function summarizeLocalProposalQuality(audits = []) {
  const totals = { audited: 0, reviewReady: 0, blocked: 0, notActionable: 0, addedEvidence: 0 };
  const blockerCounts = {};
  for (const audit of audits) {
    totals.audited += 1;
    totals.addedEvidence += audit?.addedEvidenceCount ?? 0;
    if (audit?.disposition === "review_ready") totals.reviewReady += 1;
    else if (audit?.disposition === "blocked") totals.blocked += 1;
    else totals.notActionable += 1;
    for (const blocker of audit?.blockers ?? []) blockerCounts[blocker] = (blockerCounts[blocker] ?? 0) + 1;
  }
  return { version: PROPOSAL_QUALITY_LOCAL_VERSION, label: "synthetic_local_non_promotional", totals, blockerCounts, audits };
}
