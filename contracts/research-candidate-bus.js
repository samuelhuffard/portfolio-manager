// Inert, research-only candidate discovery contract.
//
// This file is intentionally not imported by jobs, routes, schedulers, Redis,
// or proposal code. It defines the point-in-time facts and per-agent attention
// rankings that a future candidate bus could exchange. A valid record is not a
// recommendation, proposal, approval, order, or execution instruction.

import { z } from "zod";

export const RESEARCH_CANDIDATE_BUS_VERSION = "research-candidate-bus-v1";
export const ELIGIBLE_CANDIDATE_RECORD_VERSION = "eligible-research-candidate-v1";
export const MANDATE_CANDIDATE_RANK_VERSION = "mandate-candidate-rank-v1";

export const AGENT_IDS = ["agent-1", "agent-2", "agent-3"];
export const MANDATE_IDS = ["agent_one", "agent_two", "agent_three"];
export const AGENT_TO_MANDATE = Object.freeze({
  "agent-1": "agent_one",
  "agent-2": "agent_two",
  "agent-3": "agent_three",
});

export const UNRESOLVED_POLICY_CHOICES = Object.freeze([
  "Q-001: special-sector and balance-sheet economics definitions",
  "Q-002: current-estimate freshness age",
  "Q-003: entry-quote and relative-volume freshness age",
  "Q-004: consensus and 13F completeness requirements",
  "Q-005: per-agent score-event materiality thresholds",
]);

export const VALIDATION_BOUNDARIES = Object.freeze({
  validates: Object.freeze([
    "supported contract and record versions",
    "canonical security identity and explicit eligibility classifications",
    "source, observation, and evidence provenance",
    "point-in-time chronology and cross-record identity consistency",
    "deterministic ordering and duplicate prevention",
    "per-agent mandate/ranking lineage without shared investment scores",
    "research-only and shadow-only authority boundaries",
  ]),
  doesNotValidate: Object.freeze([
    "freshness age or liquidity thresholds",
    "investment merit, conviction, score quality, or event materiality",
    "special-sector economic sufficiency",
    "position sizing, approvals, orders, broker calls, or execution",
  ]),
  unresolvedPolicyChoices: UNRESOLVED_POLICY_CHOICES,
});

const NonBlank = z.string().min(1).refine((value) => value.trim() === value, "must not have surrounding whitespace");
const Iso = z.string().datetime({ offset: true });
const Ticker = z.string().regex(/^[A-Z][A-Z0-9.-]{0,9}$/).refine((value) => value === value.toUpperCase(), "must be uppercase");
const FiniteNumber = z.number().finite();

export const SECURITY_ID_TYPES = ["cusip", "isin", "local_symbol"];
export const SECURITY_TYPES = [
  "operating_common_equity",
  "preferred_equity",
  "adr",
  "etf",
  "fund",
  "warrant",
  "unknown",
];
export const LISTING_VENUES = ["NYSE", "NASDAQ", "NYSE_AMERICAN", "OTHER"];
export const SECTOR_CLASSES = [
  "technology",
  "healthcare",
  "consumer",
  "industrials",
  "energy",
  "materials",
  "utilities",
  "communication_services",
  "financials",
  "banks",
  "insurers",
  "reits",
  "other",
  "unknown",
];
export const MARKET_CAP_CLASSES = ["micro", "small", "mid", "large", "mega", "unknown"];
export const LIQUIDITY_CLASSES = ["liquid", "limited", "unknown"];
export const FRESHNESS_STATES = ["fresh", "stale", "unavailable", "unsupported", "policy_unresolved"];
export const COMPLETENESS_STATES = ["complete", "partial", "unavailable", "policy_unresolved"];
export const HOLDING_STATES = ["held", "not_held", "unknown"];
export const SOURCE_CHANNELS = ["catalog", "holdings", "quote", "fundamentals", "filing", "athena", "robinhood_scan"];
export const UNAVAILABLE_REASON_CODES = [
  "missing_observation",
  "missing_evidence",
  "provider_unavailable",
  "unsupported_source",
  "policy_unresolved",
];
export const EXCLUSION_REASON_CODES = [
  "stale_evidence",
  "incomplete_evidence",
  "excluded_security_type",
  "special_sector_economics_unresolved",
  "unsupported_listing_venue",
  "not_common_equity",
  "liquidity_unavailable",
  "universe_policy_exclusion",
];
export const RANK_STATUSES = ["ranked", "visible_unranked", "mandatory_override"];
export const EVIDENCE_AGE_STATES = ["fresh", "stale", "unknown", "policy_unresolved"];
export const PRIOR_RESEARCH_STATES = ["never_researched", "within_recency_window", "outside_recency_window", "unknown"];
export const RANK_INPUT_UNITS = ["ordinal", "percent", "multiple", "count", "state"];
export const RANK_REASON_CODES = [
  "coverage_unresolved",
  "excluded_security_type",
  "holding_mandatory",
  "long_horizon_quality",
  "medium_horizon_trend",
  "outside_research_recency",
  "short_horizon_velocity",
  "special_sector_unresolved",
  "stale_evidence",
  "within_research_recency",
];

const enumSchema = (values) => z.enum(values);

const SourceChannelSchema = z.object({
  channel: enumSchema(SOURCE_CHANNELS),
  sourceRecordId: NonBlank,
  sourceVersion: NonBlank,
  sourceAsOf: Iso,
  publishedAt: Iso.nullable(),
  retrievedAt: Iso,
}).strict();

const CUSIP = z.string().regex(/^[0-9A-Z*@#]{8}[0-9]$/, "CUSIP must be an 8-character base plus numeric check-digit structural identifier");
const ISIN = z.string().regex(/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/, "ISIN must be a 12-character structural identifier");

const SecurityIdentityFields = {
  ticker: Ticker,
  issuerName: NonBlank,
  securityType: enumSchema(SECURITY_TYPES),
  listingVenue: enumSchema(LISTING_VENUES),
};

export const SecurityIdentitySchema = z.discriminatedUnion("securityIdType", [
  z.object({
    ...SecurityIdentityFields,
    securityId: CUSIP,
    securityIdType: z.literal("cusip"),
  }).strict(),
  z.object({
    ...SecurityIdentityFields,
    securityId: ISIN,
    securityIdType: z.literal("isin"),
  }).strict(),
  z.object({
    ...SecurityIdentityFields,
    securityId: Ticker,
    securityIdType: z.literal("local_symbol"),
  }).strict(),
]);

function sortedUnique(values) {
  return values.every((value, index) => index === 0 || values[index - 1] < value);
}

function sortedBy(values, key) {
  return values.every((value, index) => index === 0 || key(values[index - 1]) < key(value));
}

function addIssue(ctx, path, message) {
  ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });
}

export const EligibleResearchCandidateSchema = z.object({
  recordType: z.literal("EligibleResearchCandidate"),
  recordVersion: z.literal(ELIGIBLE_CANDIDATE_RECORD_VERSION),
  candidateId: NonBlank,
  candidateVersion: NonBlank,
  security: SecurityIdentitySchema,
  observedAt: Iso,
  eligibilityPolicyVersion: NonBlank,
  universeSnapshotId: NonBlank,
  observationIds: z.array(NonBlank).min(1),
  evidenceSnapshotIds: z.array(NonBlank).min(1),
  sourceChannels: z.array(SourceChannelSchema).min(1),
  freshnessState: enumSchema(FRESHNESS_STATES),
  completenessState: enumSchema(COMPLETENESS_STATES),
  sectorClass: enumSchema(SECTOR_CLASSES),
  marketCapClass: enumSchema(MARKET_CAP_CLASSES),
  liquidityClass: enumSchema(LIQUIDITY_CLASSES),
  holdingStatus: enumSchema(HOLDING_STATES),
  mandatoryReview: z.boolean(),
  eligible: z.boolean(),
  unavailableReasonCodes: z.array(enumSchema(UNAVAILABLE_REASON_CODES)),
  exclusionReasonCodes: z.array(enumSchema(EXCLUSION_REASON_CODES)),
}).strict().superRefine((candidate, ctx) => {
  if (!sortedUnique(candidate.observationIds)) addIssue(ctx, ["observationIds"], "observationIds must be duplicate-free and lexicographically sorted.");
  if (!sortedUnique(candidate.evidenceSnapshotIds)) addIssue(ctx, ["evidenceSnapshotIds"], "evidenceSnapshotIds must be duplicate-free and lexicographically sorted.");
  if (!sortedBy(candidate.sourceChannels, (source) => `${source.channel}\u0000${source.sourceRecordId}`)) {
    addIssue(ctx, ["sourceChannels"], "sourceChannels must be deterministically sorted by channel and sourceRecordId.");
  }
  if (!sortedUnique(candidate.unavailableReasonCodes)) addIssue(ctx, ["unavailableReasonCodes"], "unavailableReasonCodes must be duplicate-free and lexicographically sorted.");
  if (!sortedUnique(candidate.exclusionReasonCodes)) addIssue(ctx, ["exclusionReasonCodes"], "exclusionReasonCodes must be duplicate-free and lexicographically sorted.");

  const observedAt = Date.parse(candidate.observedAt);
  const sourceRecordIds = new Set();
  for (const [index, source] of candidate.sourceChannels.entries()) {
    const sourceAsOf = Date.parse(source.sourceAsOf);
    const publishedAt = source.publishedAt === null ? null : Date.parse(source.publishedAt);
    const retrievedAt = Date.parse(source.retrievedAt);
    if (sourceRecordIds.has(source.sourceRecordId)) addIssue(ctx, ["sourceChannels", index, "sourceRecordId"], "sourceRecordId must be unique within a candidate.");
    sourceRecordIds.add(source.sourceRecordId);
    if (sourceAsOf > retrievedAt) addIssue(ctx, ["sourceChannels", index], "sourceAsOf cannot follow retrievedAt.");
    if (publishedAt !== null && sourceAsOf > publishedAt) addIssue(ctx, ["sourceChannels", index], "sourceAsOf cannot follow publishedAt.");
    if (publishedAt !== null && publishedAt > retrievedAt) addIssue(ctx, ["sourceChannels", index], "publishedAt cannot follow retrievedAt.");
    if (retrievedAt > observedAt) addIssue(ctx, ["sourceChannels", index], "retrievedAt cannot follow candidate observedAt.");
  }
  for (const evidenceId of candidate.evidenceSnapshotIds) {
    if (!sourceRecordIds.has(evidenceId)) addIssue(ctx, ["evidenceSnapshotIds"], `evidenceSnapshotId ${evidenceId} must have source provenance.`);
  }

  const reasonCount = candidate.unavailableReasonCodes.length + candidate.exclusionReasonCodes.length;
  if (candidate.eligible && reasonCount > 0) addIssue(ctx, ["eligible"], "eligible candidates cannot carry unavailable or exclusion reasons.");
  if (!candidate.eligible && reasonCount === 0) addIssue(ctx, ["eligible"], "ineligible candidates require an explicit unavailable or exclusion reason.");
  if (candidate.eligible && candidate.freshnessState !== "fresh") addIssue(ctx, ["freshnessState"], "eligible candidates require an explicitly fresh state; no age threshold is implied.");
  if (candidate.eligible && candidate.completenessState !== "complete") addIssue(ctx, ["completenessState"], "eligible candidates require complete evidence.");
  if (candidate.holdingStatus === "held" && !candidate.mandatoryReview) addIssue(ctx, ["mandatoryReview"], "held candidates must remain mandatory for review.");
  if (candidate.security.securityType !== "operating_common_equity" && candidate.eligible) addIssue(ctx, ["security", "securityType"], "only explicitly classified operating common equity can be eligible.");
});

const RankInputSchema = z.object({
  inputId: NonBlank,
  value: z.union([FiniteNumber, z.boolean(), NonBlank]),
  unit: enumSchema(RANK_INPUT_UNITS),
  sourceEvidenceId: NonBlank,
  observedAt: Iso,
}).strict();

const PriorResearchSchema = z.object({
  state: enumSchema(PRIOR_RESEARCH_STATES),
  lastResearchedAt: Iso.nullable(),
  ledgerEntryId: NonBlank.nullable(),
}).strict();

export const MandateCandidateRankSchema = z.object({
  recordType: z.literal("MandateCandidateRank"),
  recordVersion: z.literal(MANDATE_CANDIDATE_RANK_VERSION),
  rankId: NonBlank,
  candidateId: NonBlank,
  candidateVersion: NonBlank,
  ticker: Ticker,
  evidenceSnapshotId: NonBlank,
  agentId: enumSchema(AGENT_IDS),
  mandateId: enumSchema(MANDATE_IDS),
  mandateVersion: NonBlank,
  rankingPolicyVersion: NonBlank,
  rankedAt: Iso,
  rankStatus: enumSchema(RANK_STATUSES),
  rankPosition: z.number().int().positive().nullable(),
  rankInputs: z.array(RankInputSchema).min(1),
  rankReasonCodes: z.array(enumSchema(RANK_REASON_CODES)).min(1),
  evidenceAgeState: enumSchema(EVIDENCE_AGE_STATES),
  evidenceAsOf: Iso,
  evidenceMeasuredAt: Iso,
  priorResearch: PriorResearchSchema,
  shadowOnly: z.literal(true),
}).strict().superRefine((rank, ctx) => {
  if (!sortedBy(rank.rankInputs, (input) => input.inputId)) addIssue(ctx, ["rankInputs"], "rankInputs must be deterministically sorted by inputId.");
  if (!sortedUnique(rank.rankReasonCodes)) addIssue(ctx, ["rankReasonCodes"], "rankReasonCodes must be duplicate-free and lexicographically sorted.");
  const evidenceAsOf = Date.parse(rank.evidenceAsOf);
  const evidenceMeasuredAt = Date.parse(rank.evidenceMeasuredAt);
  const rankedAt = Date.parse(rank.rankedAt);
  if (evidenceAsOf > evidenceMeasuredAt) addIssue(ctx, ["evidenceAsOf"], "evidenceAsOf cannot follow evidenceMeasuredAt.");
  if (evidenceMeasuredAt > rankedAt) addIssue(ctx, ["evidenceMeasuredAt"], "evidenceMeasuredAt cannot follow rankedAt.");
  for (const [index, input] of rank.rankInputs.entries()) {
    if (Date.parse(input.observedAt) > rankedAt) addIssue(ctx, ["rankInputs", index, "observedAt"], "rank input observedAt cannot follow rankedAt.");
  }
  if (rank.priorResearch.state === "never_researched" && (rank.priorResearch.lastResearchedAt !== null || rank.priorResearch.ledgerEntryId !== null)) {
    addIssue(ctx, ["priorResearch"], "never_researched requires null prior-research identifiers.");
  }
  if (rank.priorResearch.state !== "never_researched" && rank.priorResearch.state !== "unknown" && rank.priorResearch.lastResearchedAt === null) {
    addIssue(ctx, ["priorResearch", "lastResearchedAt"], "known prior-research states require lastResearchedAt.");
  }
  if (rank.priorResearch.lastResearchedAt !== null && Date.parse(rank.priorResearch.lastResearchedAt) > rankedAt) {
    addIssue(ctx, ["priorResearch", "lastResearchedAt"], "lastResearchedAt cannot follow rankedAt.");
  }
  if (rank.rankStatus === "ranked" && rank.rankPosition === null) addIssue(ctx, ["rankPosition"], "ranked records require a positive rankPosition.");
  if (rank.rankStatus !== "ranked" && rank.rankPosition !== null) addIssue(ctx, ["rankPosition"], "unranked records must have rankPosition=null.");
  if (rank.rankStatus === "mandatory_override" && !rank.rankReasonCodes.includes("holding_mandatory")) {
    addIssue(ctx, ["rankReasonCodes"], "mandatory_override requires the explicit holding_mandatory reason.");
  }
});

export const ResearchCandidateBusSchema = z.object({
  recordType: z.literal("ResearchCandidateBus"),
  contractVersion: z.literal(RESEARCH_CANDIDATE_BUS_VERSION),
  busId: NonBlank,
  runId: NonBlank,
  candidatePolicyVersion: NonBlank,
  producerRevision: NonBlank,
  asOf: Iso,
  publishedAt: Iso,
  authority: z.literal("research_only"),
  executionAuthority: z.literal("none"),
  candidates: z.array(EligibleResearchCandidateSchema).min(1),
  ranks: z.array(MandateCandidateRankSchema),
}).strict().superRefine((bus, ctx) => {
  if (Date.parse(bus.asOf) > Date.parse(bus.publishedAt)) addIssue(ctx, ["asOf"], "bus asOf cannot follow publishedAt.");

  if (!sortedBy(bus.candidates, (candidate) => candidate.candidateId)) addIssue(ctx, ["candidates"], "candidates must be deterministically sorted by candidateId.");
  if (!sortedBy(bus.ranks, (rank) => `${rank.agentId}\u0000${rank.candidateId}\u0000${rank.rankId}`)) addIssue(ctx, ["ranks"], "ranks must be deterministically sorted by agentId, candidateId, and rankId.");

  const candidates = new Map();
  for (const [index, candidate] of bus.candidates.entries()) {
    if (candidates.has(candidate.candidateId)) addIssue(ctx, ["candidates", index, "candidateId"], "candidateId must be unique; conflicting records cannot share an identity.");
    candidates.set(candidate.candidateId, candidate);
    if (candidate.eligibilityPolicyVersion !== bus.candidatePolicyVersion) {
      addIssue(ctx, ["candidates", index, "eligibilityPolicyVersion"], "candidate eligibility policy version must match the bus policy version.");
    }
    if (Date.parse(candidate.observedAt) > Date.parse(bus.asOf)) addIssue(ctx, ["candidates", index, "observedAt"], "candidate observedAt cannot follow bus asOf.");
  }

  const rankKeys = new Set();
  const positionsByAgent = new Map();
  for (const [index, rank] of bus.ranks.entries()) {
    const candidate = candidates.get(rank.candidateId);
    if (!candidate) {
      addIssue(ctx, ["ranks", index, "candidateId"], "rank must reference a candidate in the same bus.");
      continue;
    }
    if (rank.candidateVersion !== candidate.candidateVersion) addIssue(ctx, ["ranks", index, "candidateVersion"], "rank candidateVersion must match the candidate record.");
    if (rank.ticker !== candidate.security.ticker) addIssue(ctx, ["ranks", index, "ticker"], "rank ticker must match the candidate identity.");
    if (!candidate.evidenceSnapshotIds.includes(rank.evidenceSnapshotId)) addIssue(ctx, ["ranks", index, "evidenceSnapshotId"], "rank evidenceSnapshotId must be listed by the candidate.");
    if (Date.parse(rank.rankedAt) < Date.parse(candidate.observedAt)) addIssue(ctx, ["ranks", index, "rankedAt"], "rankedAt cannot precede candidate observedAt.");
    if (Date.parse(rank.rankedAt) > Date.parse(bus.publishedAt)) addIssue(ctx, ["ranks", index, "rankedAt"], "rankedAt cannot follow bus publishedAt.");
    if (Date.parse(rank.evidenceAsOf) > Date.parse(candidate.observedAt)) addIssue(ctx, ["ranks", index, "evidenceAsOf"], "rank evidenceAsOf cannot follow candidate observedAt.");
    if (Date.parse(rank.evidenceMeasuredAt) > Date.parse(candidate.observedAt)) addIssue(ctx, ["ranks", index, "evidenceMeasuredAt"], "rank evidenceMeasuredAt cannot follow candidate observedAt.");
    if (rank.shadowOnly !== true) addIssue(ctx, ["ranks", index, "shadowOnly"], "candidate-bus rankings are shadow-only.");
    if (AGENT_TO_MANDATE[rank.agentId] !== rank.mandateId) addIssue(ctx, ["ranks", index, "mandateId"], "mandateId must match agentId.");
    if (rank.rankStatus === "ranked" && !candidate.eligible) addIssue(ctx, ["ranks", index, "rankStatus"], "ineligible candidates cannot receive an actionable ranking status.");
    if (rank.rankStatus === "ranked" && rank.evidenceAgeState !== "fresh") addIssue(ctx, ["ranks", index, "evidenceAgeState"], "ranked candidates require an explicitly fresh evidence state.");
    if (rank.rankStatus === "mandatory_override" && !candidate.mandatoryReview) addIssue(ctx, ["ranks", index, "rankStatus"], "mandatory_override requires candidate mandatoryReview=true.");
    for (const [inputIndex, input] of rank.rankInputs.entries()) {
      if (!candidate.evidenceSnapshotIds.includes(input.sourceEvidenceId)) addIssue(ctx, ["ranks", index, "rankInputs"], "rank input sourceEvidenceId must be listed by the candidate.");
      if (Date.parse(input.observedAt) > Date.parse(candidate.observedAt)) addIssue(ctx, ["ranks", index, "rankInputs", inputIndex, "observedAt"], "rank input observedAt cannot follow candidate observedAt.");
    }

    const key = `${rank.agentId}\u0000${rank.candidateId}`;
    if (rankKeys.has(key)) addIssue(ctx, ["ranks", index], "one agent cannot publish duplicate ranks for one candidate.");
    rankKeys.add(key);
    if (rank.rankPosition !== null) {
      const positions = positionsByAgent.get(rank.agentId) ?? new Set();
      if (positions.has(rank.rankPosition)) addIssue(ctx, ["ranks", index, "rankPosition"], "rankPosition must be unique within an agent's ranked records.");
      positions.add(rank.rankPosition);
      positionsByAgent.set(rank.agentId, positions);
    }
  }
});

export function parseResearchCandidateBus(input) {
  return ResearchCandidateBusSchema.parse(input);
}

export function validateResearchCandidateBus(input) {
  try {
    return {
      ok: true,
      value: parseResearchCandidateBus(input),
      unresolvedPolicyChoices: [...UNRESOLVED_POLICY_CHOICES],
    };
  } catch (error) {
    return {
      ok: false,
      issues: Array.isArray(error?.issues)
        ? error.issues.map(({ code, path, message }) => ({ code, path: [...path], message }))
        : [{ code: "invalid_payload", path: [], message: "Candidate-bus payload is invalid." }],
      unresolvedPolicyChoices: [...UNRESOLVED_POLICY_CHOICES],
    };
  }
}

/**
 * @typedef {z.infer<typeof EligibleResearchCandidateSchema>} EligibleResearchCandidate
 * @typedef {z.infer<typeof MandateCandidateRankSchema>} MandateCandidateRank
 * @typedef {z.infer<typeof ResearchCandidateBusSchema>} ResearchCandidateBus
 */
