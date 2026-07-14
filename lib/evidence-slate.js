import { AgentIdSchema, TICKER_RE } from "../contracts/proposal.js";

const ECONOMIC_CAUSES = new Set(["filing", "market", "estimate", "ownership"]);
const BUCKETS = Object.freeze({
  HOLDINGS: "holdings",
  MANDATORY: "mandatory_reunderwrite",
  EVENT: "material_event",
  SCORE: "economic_score_change",
  STABLE: "stable_score",
  EXPLORATION: "exploration",
});

function requireObject(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${field} must be an object`);
  }
  return value;
}

function requireTicker(value, field) {
  const ticker = String(value ?? "").trim().toUpperCase();
  if (!TICKER_RE.test(ticker)) throw new TypeError(`${field} must be a canonical ticker`);
  return ticker;
}

function requireAgentId(value, field) {
  try {
    return AgentIdSchema.parse(value);
  } catch {
    throw new TypeError(`${field} must be a known agent ID`);
  }
}

function requireNonnegativeInteger(value, field, fallback = 0) {
  const normalized = value === undefined ? fallback : value;
  if (!Number.isInteger(normalized) || normalized < 0) throw new TypeError(`${field} must be a non-negative integer`);
  return normalized;
}

function uniqueSorted(values) {
  return [...new Set(values.filter((value) => value != null && String(value).trim()).map((value) => String(value).trim()))].sort();
}

function normalizeArray(value, field) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new TypeError(`${field} must be an array`);
  return value;
}

function normalizeItem(value, { field, defaultAgentId, bucket, defaultReason }) {
  const source = typeof value === "string" ? { ticker: value } : requireObject(value, field);
  const ticker = requireTicker(source.ticker, `${field}.ticker`);
  const agentId = requireAgentId(source.agentId ?? defaultAgentId, `${field}.agentId`);
  const reasonCodes = uniqueSorted([
    defaultReason,
    ...(Array.isArray(source.reasonCodes) ? source.reasonCodes : []),
  ]);
  return {
    ...source,
    ticker,
    agentId,
    bucket: bucket ?? source.bucket,
    reasonCodes,
    triggeringObservationId: source.triggeringObservationId == null ? null : String(source.triggeringObservationId),
    triggeringEventId: source.triggeringEventId == null ? null : String(source.triggeringEventId),
  };
}

function mergeLineage(left, right) {
  const observations = uniqueSorted([left.triggeringObservationId, right.triggeringObservationId]);
  const events = uniqueSorted([left.triggeringEventId, right.triggeringEventId]);
  return {
    triggeringObservationId: observations[0] ?? null,
    triggeringEventId: events[0] ?? null,
    reasonCodes: uniqueSorted([...(left.reasonCodes ?? []), ...(right.reasonCodes ?? [])]),
  };
}

function comparePriority(left, right) {
  if (left.priority !== right.priority) return left.priority - right.priority;
  const leftDeclared = Number.isFinite(left.declaredPriority) ? left.declaredPriority : 0;
  const rightDeclared = Number.isFinite(right.declaredPriority) ? right.declaredPriority : 0;
  if (leftDeclared !== rightDeclared) return leftDeclared - rightDeclared;
  if (left.bucket === BUCKETS.EVENT || left.bucket === BUCKETS.SCORE) {
    const leftDelta = Math.abs(Number(left.delta ?? 0));
    const rightDelta = Math.abs(Number(right.delta ?? 0));
    if (leftDelta !== rightDelta) return rightDelta - leftDelta;
  }
  if (left.bucket === BUCKETS.STABLE || left.bucket === BUCKETS.SCORE) {
    const leftScore = Number.isFinite(left.score) ? left.score : -Infinity;
    const rightScore = Number.isFinite(right.score) ? right.score : -Infinity;
    if (leftScore !== rightScore) return rightScore - leftScore;
  }
  return left.ticker.localeCompare(right.ticker) || left.agentId.localeCompare(right.agentId);
}

function eventTimestamp(event) {
  for (const field of ["createdAt", "eventAt", "observedAt", "currentObservedAt", "asOf"]) {
    if (event?.[field] != null) return event[field];
  }
  return null;
}

function normalizeAgePolicy(policy, field) {
  if (policy == null) return null;
  requireObject(policy, field);
  const version = String(policy.version ?? "").trim();
  const maxAgeMs = policy.maxAgeMs ?? (
    policy.maxAgeDays == null ? null : Number(policy.maxAgeDays) * 24 * 60 * 60 * 1000
  );
  if (!version || !Number.isFinite(maxAgeMs) || maxAgeMs < 0) {
    throw new TypeError(`${field} requires a version and non-negative max age`);
  }
  return { version, maxAgeMs };
}

function isFreshEvent(event, agePolicy, now) {
  if (!agePolicy) return false;
  const timestamp = eventTimestamp(event);
  const timestampMs = Date.parse(timestamp ?? "");
  if (!Number.isFinite(timestampMs)) return false;
  const ageMs = now.getTime() - timestampMs;
  return ageMs >= 0 && ageMs <= agePolicy.maxAgeMs;
}

function isOutsideCooldown(candidate, cooldownPolicy, now) {
  const lastResearchedAt = candidate.lastResearchedAt ?? candidate.researchedAt;
  if (!lastResearchedAt) return true;
  if (!cooldownPolicy) return false;
  const timestampMs = Date.parse(lastResearchedAt);
  if (!Number.isFinite(timestampMs)) return false;
  const ageMs = now.getTime() - timestampMs;
  return ageMs >= cooldownPolicy.maxAgeMs;
}

function validateMaxSectorShare(value) {
  if (value == null) return null;
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new TypeError("maxSectorShare must be between 0 and 1");
  return value;
}

function sectorKey(candidate) {
  const value = candidate.sector ?? candidate.subVertical ?? candidate.industry;
  return value == null || String(value).trim() === "" ? null : String(value).trim();
}

function canAddSector(candidate, selected, maxSectorShare, replaceableBudget) {
  if (maxSectorShare == null) return true;
  const sector = sectorKey(candidate);
  if (sector == null) return true;
  const replaceable = selected.filter((item) => !item.budgetExempt);
  const nextCount = replaceable.filter((item) => sectorKey(item._source) === sector).length + 1;
  return replaceableBudget > 0 && nextCount / replaceableBudget <= maxSectorShare;
}

function outputItem(candidate, rank, displacedCandidate = null) {
  return {
    ticker: candidate.ticker,
    agentId: candidate.agentId,
    bucket: candidate.bucket,
    rank,
    reasonCodes: [...candidate.reasonCodes],
    triggeringObservationId: candidate.triggeringObservationId,
    triggeringEventId: candidate.triggeringEventId,
    displacedCandidate,
    budgetExempt: candidate.budgetExempt,
  };
}

function normalizeBaseline(baseline, defaultAgentId) {
  const result = [];
  const seen = new Set();
  for (const value of normalizeArray(baseline, "baselineSlate")) {
    const item = normalizeItem(value, { field: "baselineSlate item", defaultAgentId, defaultReason: "baseline" });
    if (seen.has(item.ticker)) continue;
    seen.add(item.ticker);
    result.push(item);
  }
  return result;
}

/**
 * Selects an advisory evidence slate. This function has no trade vocabulary:
 * its output is attention allocation plus immutable research lineage only.
 *
 * Missing event-age policy and missing cooldown policy fail closed by excluding
 * those respective event/stable candidates. `budget` counts replaceable slots;
 * protected holdings and mandatory re-underwrites are budget-exempt.
 */
export function selectEvidenceSlate(input = {}) {
  requireObject(input, "input");
  const defaultAgentId = input.agentId;
  const now = input.now instanceof Date ? new Date(input.now) : new Date(input.now ?? Date.now());
  if (!Number.isFinite(now.getTime())) throw new TypeError("now must be a valid Date or timestamp");
  const budget = requireNonnegativeInteger(input.budget ?? input.aiReviewBudget, "budget", 0);
  const explorationSlots = requireNonnegativeInteger(input.explorationSlots, "explorationSlots", 0);
  if (explorationSlots > budget) {
    throw new RangeError("explorationSlots cannot exceed the replaceable budget");
  }
  const maxSectorShare = validateMaxSectorShare(input.maxSectorShare);
  const eventAgePolicy = normalizeAgePolicy(input.eventAgePolicy ?? input.eventAge, "eventAgePolicy");
  const cooldownPolicy = normalizeAgePolicy(
    input.cooldownPolicy ?? (
      input.cooldownMs == null && input.cooldownDays == null && input.researchCooldownDays == null
        ? null
        : { version: input.cooldownPolicyVersion ?? "caller-cooldown-policy", maxAgeMs: input.cooldownMs ?? Number(input.cooldownDays ?? input.researchCooldownDays) * 24 * 60 * 60 * 1000 }
    ),
    "cooldownPolicy",
  );

  const candidates = new Map();
  const skipped = { staleEvents: 0, ineligibleEvents: 0, cooldownStable: 0, missingPolicies: [] };
  if ((input.events ?? input.researchEvents)?.length && !eventAgePolicy) skipped.missingPolicies.push("eventAgePolicy");
  if ((input.stableCandidates ?? input.stableScores)?.length && !cooldownPolicy) skipped.missingPolicies.push("cooldownPolicy");

  const add = (value, { priority, bucket, defaultReason, eligibility = () => true, budgetExempt = false, field }) => {
    const source = normalizeItem(value, { field, defaultAgentId, bucket, defaultReason });
    if (!eligibility(source)) return;
    const candidate = {
      ...source,
      priority,
      declaredPriority: Number.isFinite(source.priority) ? source.priority : 0,
      budgetExempt,
      delta: Number.isFinite(source.delta) ? source.delta : null,
      score: Number.isFinite(source.score ?? source.quantScore) ? Number(source.score ?? source.quantScore) : null,
      _source: source,
    };
    const existing = candidates.get(source.ticker);
    if (!existing || comparePriority(candidate, existing) < 0) {
      candidates.set(source.ticker, existing ? { ...candidate, ...mergeLineage(candidate, existing), _source: source } : candidate);
    } else {
      candidates.set(source.ticker, { ...existing, ...mergeLineage(existing, candidate) });
    }
  };

  for (const value of normalizeArray(input.holdings, "holdings")) {
    add(value, { priority: 0, bucket: BUCKETS.HOLDINGS, defaultReason: "holding", budgetExempt: true, field: "holding" });
  }
  for (const value of normalizeArray(input.mandatoryReunderwrites ?? input.mandatoryReviews, "mandatoryReunderwrites")) {
    add(value, { priority: 0, bucket: BUCKETS.MANDATORY, defaultReason: "mandatory_reunderwrite", budgetExempt: true, field: "mandatoryReunderwrite" });
  }

  for (const value of normalizeArray(input.events ?? input.researchEvents, "events")) {
    const event = requireObject(value, "event");
    const causes = Array.isArray(event.allCauses) ? event.allCauses : [];
    const eligible = event.researchEligible === true &&
      ECONOMIC_CAUSES.has(event.primaryCause) && causes.length > 0 && causes.every((cause) => ECONOMIC_CAUSES.has(cause));
    if (!eligible) {
      skipped.ineligibleEvents++;
      continue;
    }
    if (!isFreshEvent(event, eventAgePolicy, now)) {
      skipped.staleEvents++;
      continue;
    }
    add({
      ...event,
      ticker: event.ticker,
      triggeringEventId: event.id ?? event.eventId ?? null,
      triggeringObservationId: event.currentObservationId ?? event.triggeringObservationId ?? null,
      reasonCodes: event.reasonCodes,
      delta: event.delta,
      evidenceAt: eventTimestamp(event),
    }, { priority: 1, bucket: BUCKETS.EVENT, defaultReason: "material_thesis_breaking_event", field: "event" });
  }

  for (const value of normalizeArray(input.scoreChanges ?? input.economicScoreChanges ?? input.scoreDeltaCandidates, "scoreChanges")) {
    const candidate = requireObject(value, "scoreChange");
    const causes = Array.isArray(candidate.allCauses) ? candidate.allCauses : [candidate.primaryCause];
    if (candidate.researchEligible !== true || !ECONOMIC_CAUSES.has(candidate.primaryCause) || causes.some((cause) => !ECONOMIC_CAUSES.has(cause))) continue;
    add({
      ...candidate,
      triggeringEventId: candidate.triggeringEventId ?? candidate.eventId ?? null,
      triggeringObservationId: candidate.triggeringObservationId ?? candidate.currentObservationId ?? null,
    }, { priority: 2, bucket: BUCKETS.SCORE, defaultReason: "validated_economic_score_change", field: "scoreChange" });
  }

  for (const value of normalizeArray(input.stableCandidates ?? input.stableScores ?? input.rankedCandidates, "stableCandidates")) {
    const candidate = requireObject(value, "stableCandidate");
    if (!isOutsideCooldown(candidate, cooldownPolicy, now)) {
      skipped.cooldownStable++;
      continue;
    }
    add(candidate, { priority: 3, bucket: BUCKETS.STABLE, defaultReason: "high_stable_score", field: "stableCandidate" });
  }

  const exploration = normalizeArray(input.explorationCandidates, "explorationCandidates")
    .map((value) => normalizeItem(value, { field: "explorationCandidate", defaultAgentId, bucket: BUCKETS.EXPLORATION, defaultReason: "fixed_exploration_allocation" }))
    .sort((left, right) => {
      const leftRank = Number.isFinite(left.explorationRank) ? left.explorationRank : 0;
      const rightRank = Number.isFinite(right.explorationRank) ? right.explorationRank : 0;
      return leftRank - rightRank || left.ticker.localeCompare(right.ticker) || left.agentId.localeCompare(right.agentId);
    });
  for (const value of exploration) add(value, { priority: 4, bucket: BUCKETS.EXPLORATION, defaultReason: "fixed_exploration_allocation", field: "explorationCandidate" });

  const ordered = [...candidates.values()].sort(comparePriority);
  const selected = [];
  for (const candidate of ordered.filter((item) => item.budgetExempt)) selected.push(candidate);

  const replaceable = ordered.filter((item) => !item.budgetExempt);
  const selectedExploration = [];
  for (const candidate of replaceable.filter((item) => item.bucket === BUCKETS.EXPLORATION)) {
    if (selectedExploration.length >= explorationSlots) break;
    if (canAddSector(candidate, [...selected, ...selectedExploration], maxSectorShare, budget)) {
      selectedExploration.push(candidate);
    }
  }
  const selectedSet = new Set(selected.map((item) => item.ticker));
  for (const candidate of selectedExploration) {
    if (selectedSet.has(candidate.ticker)) continue;
    selected.push(candidate);
    selectedSet.add(candidate.ticker);
  }
  for (const candidate of replaceable) {
    if (selected.length - selected.filter((item) => item.budgetExempt).length >= budget || selectedSet.has(candidate.ticker)) continue;
    if (candidate.bucket === BUCKETS.EXPLORATION) continue;
    if (!canAddSector(candidate, selected, maxSectorShare, budget)) continue;
    selected.push(candidate);
    selectedSet.add(candidate.ticker);
  }
  selected.sort(comparePriority);

  const baseline = normalizeBaseline(input.baselineSlate ?? input.currentSlate, defaultAgentId);
  const baselineNonHolding = baseline.filter((item) => !normalizeArray(input.holdings, "holdings").some((holding) => requireTicker(typeof holding === "string" ? holding : holding.ticker, "holding.ticker") === item.ticker));
  const selectedNew = selected.filter((item) => !item.budgetExempt && !baseline.some((base) => base.ticker === item.ticker));
  const displaced = baselineNonHolding.filter((base) => !selected.some((item) => item.ticker === base.ticker));
  const displacedByTicker = new Map(selectedNew.map((item, index) => [item.ticker, displaced[index]?.ticker ?? null]));
  const items = selected.map((candidate, rank) => outputItem(candidate, rank, displacedByTicker.get(candidate.ticker) ?? null));
  return {
    items,
    selected: items,
    slate: items,
    skipped,
    policy: {
      eventAgePolicyVersion: eventAgePolicy?.version ?? null,
      cooldownPolicyVersion: cooldownPolicy?.version ?? null,
      maxSectorShare,
      explorationSlots,
      budget,
    },
  };
}

export const buildEvidenceSlate = selectEvidenceSlate;
export default selectEvidenceSlate;
