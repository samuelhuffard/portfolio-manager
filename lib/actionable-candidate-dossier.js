// Shadow-only readiness assessment for the step between peer-relative ranking
// and a full investment dossier. This module deliberately has no model,
// proposal, broker, Redis, or execution dependency.

import { MandateScoreObservationSchema } from "../contracts/research-observation.js";

export const ACTIONABLE_CANDIDATE_DOSSIER_VERSION = "actionable-candidate-dossier-shadow-v2";

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function sortedUnique(values) {
  return [...new Set(values.filter(Boolean))].sort();
}

function observationKey(observation) {
  return `${observation.agentId}/${observation.ticker}`;
}

function canonicalObservations(observations) {
  if (!Array.isArray(observations)) {
    return { byIdentity: new Map(), invalidIdentities: new Set(), invalidCount: 0, observationsInputInvalid: true };
  }
  const valid = [];
  const invalidIdentities = new Set();
  let invalidCount = 0;
  for (const observation of observations) {
    const parsed = MandateScoreObservationSchema.safeParse(observation);
    if (parsed.success) valid.push(parsed.data);
    else {
      invalidCount++;
      const agentId = text(observation?.agentId);
      const ticker = text(observation?.ticker).toUpperCase();
      if (agentId && ticker) invalidIdentities.add(`${agentId}/${ticker}`);
    }
  }
  valid.sort((left, right) => {
    const observedAt = left.observedAt.localeCompare(right.observedAt);
    if (observedAt !== 0) return observedAt;
    return left.id.localeCompare(right.id);
  });
  return {
    byIdentity: new Map(valid.map((observation) => [observationKey(observation), observation])),
    invalidIdentities,
    invalidCount,
    observationsInputInvalid: false,
  };
}

/**
 * Builds one internal, shadow-only evidence-readiness record. `readyForDeepResearch`
 * means the packet merits a full dossier investigation; it never means a security is
 * buyable and it never grants proposal authority.
 */
function buildActionableCandidateDossier(item, observationsByIdentity, invalidObservationIdentities) {
  const ticker = text(item?.ticker).toUpperCase();
  const agentId = text(item?.agentId);
  if (!ticker || !agentId) throw new TypeError("candidate dossier requires a ticker and agentId");

  const observation = observationsByIdentity.get(`${agentId}/${ticker}`) ?? null;
  const reasonCodes = [];
  if (!observation) {
    reasonCodes.push(invalidObservationIdentities.has(`${agentId}/${ticker}`)
      ? "observation_invalid" : "observation_missing");
  } else if (observation.actionable !== true) reasonCodes.push("observation_not_research_actionable");

  const blockedBy = sortedUnique(reasonCodes);
  return {
    schemaVersion: ACTIONABLE_CANDIDATE_DOSSIER_VERSION,
    mode: "shadow_only",
    ticker,
    agentId,
    observationId: observation?.id ?? null,
    evidenceSnapshotId: observation?.inputSnapshotId ?? null,
    peerSetId: observation?.peerSetId ?? null,
    score: Number.isFinite(observation?.score) ? observation.score : null,
    readyForDeepResearch: blockedBy.length === 0,
    proposalEligible: false,
    blockedBy,
  };
}

/** Aggregate only: suitable for status and shadow-run payloads that must not expose tickers. */
export function summarizeActionableCandidateDossiers(items = [], observations = []) {
  const candidates = Array.isArray(items) ? items : [];
  const { byIdentity, invalidIdentities, invalidCount, observationsInputInvalid } = canonicalObservations(observations);
  const dossiers = [];
  let assessmentUnavailableCount = 0;
  for (const item of candidates) {
    try {
      dossiers.push(buildActionableCandidateDossier(item, byIdentity, invalidIdentities));
    } catch {
      assessmentUnavailableCount++;
    }
  }
  const reasonCodeCounts = {};
  for (const dossier of dossiers) {
    for (const reason of dossier.blockedBy) reasonCodeCounts[reason] = (reasonCodeCounts[reason] ?? 0) + 1;
  }
  return {
    version: ACTIONABLE_CANDIDATE_DOSSIER_VERSION,
    mode: "shadow_only",
    evaluatedCount: candidates.length,
    readyForDeepResearchCount: dossiers.filter((dossier) => dossier.readyForDeepResearch).length,
    blockedCount: candidates.length - dossiers.filter((dossier) => dossier.readyForDeepResearch).length,
    invalidObservationCount: invalidCount,
    observationsInputInvalid,
    assessmentUnavailableCount,
    reasonCodeCounts: Object.fromEntries(Object.entries(reasonCodeCounts).sort(([left], [right]) => left.localeCompare(right))),
  };
}
