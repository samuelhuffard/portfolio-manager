// Pure E3.2 event construction. Q-005 is deliberately not represented here:
// callers must explicitly inject a reviewed versioned materiality policy.
import { classifyScoreDelta } from "./score-delta.js";
import { contentHash } from "./research-version.js";

function eventId(previousObservationId, currentObservationId, materialityPolicyVersion) {
  return `research-event:${contentHash({ previousObservationId, currentObservationId, materialityPolicyVersion })}`;
}

export function buildResearchEvent({ previous = null, current, materialityPolicy = null } = {}) {
  if (!current) throw new TypeError("current observation is required");
  const delta = classifyScoreDelta({ previous, current, materialityPolicy });
  const materialityPolicyVersion = materialityPolicy?.version ?? null;
  return {
    id: eventId(previous?.id ?? null, current.id, materialityPolicyVersion),
    previousObservationId: previous?.id ?? null,
    currentObservationId: current.id,
    ticker: current.ticker,
    agentId: current.agentId,
    ...delta,
    materialityPolicyVersion,
    // The current immutable observation is the reproducible event timestamp.
    createdAt: current.observedAt,
  };
}

export function buildResearchEvents(comparisons = [], options = {}) {
  if (!Array.isArray(comparisons)) throw new TypeError("comparisons must be an array");
  return comparisons
    .map(({ previous = null, current }) => buildResearchEvent({ previous, current, materialityPolicy: options.materialityPolicy ?? null }))
    .sort((left, right) => left.agentId.localeCompare(right.agentId) || left.ticker.localeCompare(right.ticker) || left.id.localeCompare(right.id));
}
