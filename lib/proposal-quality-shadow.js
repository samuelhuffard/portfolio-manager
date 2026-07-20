/**
 * Local-only proposal-quality shadow harness.
 *
 * This module has no Redis, Sheets, scheduler, model, approval, or execution
 * dependency. It audits supplied historical or synthetic proposal records so
 * research quality can improve without changing a live Phase 0 workflow.
 */

import { buildProposalEvidence, validateActionableEvidence } from "./ai-overlay.js";
import { assessEvidenceQuality } from "./evidence-quality-policy.js";
import { evaluateMandateBusinessEligibility } from "./mandate-catalog-screen.js";

export const PROPOSAL_QUALITY_SHADOW_VERSION = "proposal-quality-shadow-v1";

function isActionable(action) {
  return action === "BUY" || action === "SELL";
}

function normaliseFact(fact, index) {
  if (!fact || typeof fact !== "object") return null;
  const id = typeof fact.id === "string" && /^[a-z][a-z0-9_]{1,80}$/i.test(fact.id)
    ? fact.id
    : `shadow_fact_${index + 1}`;
  if (fact.value == null || fact.value === "") return null;
  return {
    id,
    kind: ["raw_fact", "filing", "source_reported_text"].includes(fact.kind) ? fact.kind : "raw_fact",
    label: String(fact.label ?? id),
    value: fact.value,
    unit: String(fact.unit ?? "unspecified"),
    source: String(fact.source ?? "shadow-supplied structured fact"),
  };
}

/**
 * Builds a comparison-ready thesis packet from explicitly supplied facts.
 * `primaryFacts` is never fetched or inferred: callers must state the source.
 */
export function buildShadowThesisPacket(input = {}) {
  const news = Array.isArray(input.news) ? input.news : [];
  const quality = assessEvidenceQuality(news);
  const classifiedNews = news.map((item, index) => ({
    ...item,
    thesisSupport: quality[index]?.support === true,
  }));
  const factEvidence = [
    ...(input.factEvidence ?? []),
    ...(input.primaryFacts ?? []).map(normaliseFact).filter(Boolean),
  ];
  const evidence = buildProposalEvidence({
    quantScore: input.quantScore,
    breakdown: input.breakdown,
    nextEarningsDate: input.nextEarningsDate,
    analystTrend: input.analystTrend,
    insiderActivity: input.insiderActivity,
    recentFilings: input.recentFilings,
    news: classifiedNews,
    marketScanSignals: input.marketScanSignals,
    athenaEvidence: input.athenaEvidence,
    factEvidence,
  });
  const rawFacts = evidence.filter((entry) => entry.kind === "raw_fact" || entry.kind === "filing" || entry.kind === "source_reported_text");
  return {
    policyVersion: PROPOSAL_QUALITY_SHADOW_VERSION,
    evidence,
    evidenceIds: evidence.map((entry) => entry.id),
    rawFactCount: rawFacts.length,
    primaryFactCount: rawFacts.filter((entry) => /sec|filing|company|exchange|regulator/i.test(entry.source)).length,
    contextOnlyNews: quality.filter((item) => !item.support).map((item) => ({ index: item.index, reasons: item.reasons })),
  };
}

function detectRankAsRawMetric(proposal, evidenceById) {
  const issues = [];
  for (const citation of proposal?.evidenceCitations ?? []) {
    const claim = String(citation?.claim ?? "");
    const citedEntries = (citation?.evidence_ids ?? []).map((id) => evidenceById.get(id)).filter(Boolean);
    if (!citedEntries.some((entry) => entry.kind === "normalized_rank")) continue;
    // A rank can support a claim that a candidate ranked highly/poorly. It cannot
    // support a claim about a raw P/E, return, margin, RSI, price, or multiple.
    if (/\b(?:p\/?e|earnings multiple|trades at|price|return|momentum|growth|margin|rsi|\d+(?:\.\d+)?x)\b/i.test(claim)) {
      issues.push(`normalized rank is described as a raw metric: ${claim.slice(0, 140)}`);
    }
  }
  return issues;
}

/**
 * Audits one supplied draft against a baseline packet and a richer shadow packet.
 * It never calls a model, changes a recommendation, queues a proposal, or writes
 * state. `reviewReady` means only that deterministic evidence checks passed.
 */
export function auditProposalQualityShadow({ agentId, candidate = {}, proposal = {}, baseline = {}, enriched = {} } = {}) {
  const baselinePacket = buildShadowThesisPacket(baseline);
  const enrichedPacket = buildShadowThesisPacket(enriched);
  const action = proposal.action ?? "HOLD";
  const evidenceIds = new Set(enrichedPacket.evidenceIds);
  const evidenceValidation = validateActionableEvidence({
    action,
    thesis: proposal.thesis,
    evidenceCitations: proposal.evidenceCitations,
    evidenceIds,
    claimedBusinessFamily: proposal.claimedBusinessFamily,
  });
  const businessEligibility = isActionable(action)
    ? evaluateMandateBusinessEligibility({ agentId, candidate, claimedBusinessFamily: proposal.claimedBusinessFamily })
    : null;
  const evidenceById = new Map(enrichedPacket.evidence.map((entry) => [entry.id, entry]));
  const rankMisuse = detectRankAsRawMetric(proposal, evidenceById);
  const blockers = [
    ...(evidenceValidation.valid ? [] : evidenceValidation.issues),
    ...(businessEligibility && !businessEligibility.eligible ? [`${businessEligibility.reasonCode}: ${businessEligibility.reason}`] : []),
    ...rankMisuse,
  ];
  const evidenceGaps = [];
  if (enrichedPacket.primaryFactCount === 0) evidenceGaps.push("no primary-source structured fact supplied");
  if (enrichedPacket.rawFactCount === 0) evidenceGaps.push("no raw fact supplied beyond normalized ranks");
  if (enrichedPacket.contextOnlyNews.length) evidenceGaps.push("context-only news was excluded from thesis support");

  return {
    policyVersion: PROPOSAL_QUALITY_SHADOW_VERSION,
    ticker: candidate.ticker ?? null,
    agentId,
    action,
    baseline: {
      evidenceCount: baselinePacket.evidence.length,
      rawFactCount: baselinePacket.rawFactCount,
      primaryFactCount: baselinePacket.primaryFactCount,
    },
    enriched: {
      evidenceCount: enrichedPacket.evidence.length,
      rawFactCount: enrichedPacket.rawFactCount,
      primaryFactCount: enrichedPacket.primaryFactCount,
      addedEvidenceCount: Math.max(0, enrichedPacket.evidence.length - baselinePacket.evidence.length),
      contextOnlyNews: enrichedPacket.contextOnlyNews,
    },
    evidenceValidation,
    businessEligibility,
    rankMisuse,
    blockers,
    evidenceGaps,
    reviewReady: isActionable(action) && blockers.length === 0,
    disposition: !isActionable(action) ? "not_actionable" : blockers.length ? "blocked" : "review_ready",
  };
}

/** Aggregate-safe report for a local batch of supplied shadow audits. */
export function summarizeProposalQualityShadow(audits = []) {
  const totals = {
    audited: 0,
    actionable: 0,
    reviewReady: 0,
    blocked: 0,
    notActionable: 0,
    addedEvidence: 0,
    contextOnlyNews: 0,
  };
  const blockerCounts = {};
  for (const audit of audits) {
    totals.audited += 1;
    totals.addedEvidence += audit?.enriched?.addedEvidenceCount ?? 0;
    totals.contextOnlyNews += audit?.enriched?.contextOnlyNews?.length ?? 0;
    if (audit?.disposition === "review_ready") {
      totals.actionable += 1;
      totals.reviewReady += 1;
    } else if (audit?.disposition === "blocked") {
      totals.actionable += 1;
      totals.blocked += 1;
    } else {
      totals.notActionable += 1;
    }
    for (const blocker of audit?.blockers ?? []) blockerCounts[blocker] = (blockerCounts[blocker] ?? 0) + 1;
  }
  return { policyVersion: PROPOSAL_QUALITY_SHADOW_VERSION, totals, blockerCounts, audits };
}
