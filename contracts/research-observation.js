// CANONICAL — edit here only. Mirrored to portfolio-dashboard/lib/contracts/ by
// `npm run contracts:sync`; the dashboard's contracts-drift test enforces equality.
//
// Point-in-time deterministic mandate-score observations. This is an additive
// research-record contract only: it neither creates a proposal nor authorizes a
// trade. See docs/adr/0003-point-in-time-research-record.md.

import { z } from "zod";
import { AgentIdSchema, TICKER_RE } from "./proposal.js";

export const MANDATE_IDS = ["agent_one", "agent_two", "agent_three"];
export const SPECIAL_SECTOR_KEYS = ["banks", "insurers", "reits"];
export const SCORE_CAUSES = [
  "initial",
  "filing",
  "market",
  "estimate",
  "ownership",
  "coverage",
  "peer_set",
  "restatement",
  "version",
  "retry",
];
export const FALLBACK_METHODS = ["peer_relative", "blended_50_50", "absolute", "none"];
export const PEER_SET_LEVELS = ["industry", "sector", "none"];
export const FRESHNESS_STATES = ["fresh", "stale", "unavailable", "unsupported", "policy_unresolved"];
export const OBSERVATION_UNITS = [
  "decimal_ratio",
  "percentage_points",
  "basis_points",
  "usd",
  "usd_millions",
  "shares",
  "count",
  "days",
  "multiple",
  "boolean",
  "date",
  "score_points",
];

export const MandateIdSchema = z.enum(MANDATE_IDS);
export const SpecialSectorKeySchema = z.enum(SPECIAL_SECTOR_KEYS).nullable();
export const ScoreCauseSchema = z.enum(SCORE_CAUSES);
export const FallbackMethodSchema = z.enum(FALLBACK_METHODS);
export const PeerSetLevelSchema = z.enum(PEER_SET_LEVELS);
export const FreshnessStateSchema = z.enum(FRESHNESS_STATES);
export const ObservationUnitSchema = z.enum(OBSERVATION_UNITS);

const Iso = z.string().datetime({ offset: true });
const NonEmpty = z.string().min(1);
const Nonnegative = z.number().finite().nonnegative();
const Score = z.number().finite().min(0).max(100);
const TOLERANCE = 0.01;

function isSortedUnique(values) {
  return values.every((value, index) => index === 0 || values[index - 1] < value);
}

function isCovered(metric) {
  return metric.points !== null && metric.value !== null && !["unavailable", "unsupported"].includes(metric.freshnessState);
}

function isCriticalMissing(metric) {
  return metric.thesisCritical && (!isCovered(metric) || metric.freshnessState !== "fresh");
}

/** One metric as it was actually available and scored at observation time. */
export const MandateScoreMetricSchema = z.object({
  metricId: NonEmpty,
  value: z.union([z.number().finite(), z.boolean(), NonEmpty, z.null()]),
  unit: ObservationUnitSchema,
  points: Nonnegative.nullable(),
  maxPoints: Nonnegative,
  source: NonEmpty,
  sourceDocumentId: NonEmpty.nullable(),
  sourceFiledAt: Iso.nullable(),
  sourceAsOf: Iso.nullable(),
  retrievedAt: Iso,
  freshnessState: FreshnessStateSchema,
  peerCount: z.number().int().nonnegative(),
  calculationMethod: NonEmpty,
  thesisCritical: z.boolean(),
  missingReason: NonEmpty.nullable(),
}).strict().superRefine((metric, ctx) => {
  if (isCovered(metric)) {
    if (metric.missingReason !== null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["missingReason"], message: "Covered metrics must not carry a missingReason." });
    }
    return;
  }

  if (metric.points !== null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["points"], message: "Uncovered metrics must have points=null." });
  }
  if (metric.missingReason === null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["missingReason"], message: "Uncovered metrics require a missingReason." });
  }
});

/**
 * Immutable record of one specialist's deterministic score over one known
 * evidence snapshot. Stored and comparable are deliberately distinct from
 * proposal-actionable; callers must not treat a valid parse as trade authority.
 */
export const MandateScoreObservationSchema = z.object({
  id: NonEmpty,
  runId: NonEmpty,
  observedAt: Iso,
  agentId: AgentIdSchema,
  mandateId: MandateIdSchema,
  mandateVersion: NonEmpty,
  mandateUniverseVersion: NonEmpty,
  productionUniversePolicyVersion: NonEmpty,
  scoringConfigVersion: NonEmpty,
  codeRevision: NonEmpty,
  ticker: z.string().regex(TICKER_RE),
  universeSnapshotId: NonEmpty,
  eligible: z.boolean(),
  eligibilityReasonCodes: z.array(NonEmpty),
  score: Score,
  uncappedScore: Score,
  rawPoints: Nonnegative,
  maxAvailablePoints: Nonnegative.max(100),
  complete: z.boolean(),
  actionable: z.boolean(),
  coverageMask: z.array(NonEmpty),
  missingMetrics: z.array(NonEmpty),
  criticalMissingMetrics: z.array(NonEmpty),
  fallbackMethod: FallbackMethodSchema,
  thinPeerSet: z.boolean(),
  peerSetId: NonEmpty,
  peerSetLevel: PeerSetLevelSchema,
  peerCount: z.number().int().nonnegative(),
  specialSectorKey: SpecialSectorKeySchema,
  scoreCause: ScoreCauseSchema,
  inputSnapshotId: NonEmpty,
  metrics: z.array(MandateScoreMetricSchema),
}).strict().superRefine((observation, ctx) => {
  const addIssue = (path, message) => ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });
  const lists = [
    ["eligibilityReasonCodes", observation.eligibilityReasonCodes],
    ["coverageMask", observation.coverageMask],
    ["missingMetrics", observation.missingMetrics],
    ["criticalMissingMetrics", observation.criticalMissingMetrics],
  ];
  for (const [name, values] of lists) {
    if (!isSortedUnique(values)) addIssue([name], `${name} must be duplicate-free and lexicographically sorted.`);
  }

  const metricIds = observation.metrics.map((metric) => metric.metricId);
  if (!isSortedUnique(metricIds)) addIssue(["metrics"], "metrics must have unique metricIds in lexicographic order.");

  const coveredMetrics = observation.metrics.filter(isCovered);
  const uncoveredMetrics = observation.metrics.filter((metric) => !isCovered(metric));
  const expectedCoverage = coveredMetrics.map((metric) => metric.metricId);
  const expectedMissing = uncoveredMetrics.map((metric) => metric.metricId);
  const expectedCriticalMissing = observation.metrics.filter(isCriticalMissing).map((metric) => metric.metricId);
  if (JSON.stringify(observation.coverageMask) !== JSON.stringify(expectedCoverage)) {
    addIssue(["coverageMask"], "coverageMask must exactly equal the covered metric IDs.");
  }
  if (JSON.stringify(observation.missingMetrics) !== JSON.stringify(expectedMissing)) {
    addIssue(["missingMetrics"], "missingMetrics must exactly equal the uncovered metric IDs.");
  }
  if (JSON.stringify(observation.criticalMissingMetrics) !== JSON.stringify(expectedCriticalMissing)) {
    addIssue(["criticalMissingMetrics"], "criticalMissingMetrics must exactly equal non-fresh or missing thesis-critical metric IDs.");
  }

  const rawPoints = coveredMetrics.reduce((sum, metric) => sum + metric.points, 0);
  const maxAvailablePoints = coveredMetrics.reduce((sum, metric) => sum + metric.maxPoints, 0);
  if (Math.abs(observation.rawPoints - rawPoints) > TOLERANCE) {
    addIssue(["rawPoints"], "rawPoints must equal the covered metric points within two-decimal tolerance.");
  }
  if (Math.abs(observation.maxAvailablePoints - maxAvailablePoints) > TOLERANCE) {
    addIssue(["maxAvailablePoints"], "maxAvailablePoints must equal covered metric maxPoints within two-decimal tolerance.");
  }
  if (observation.maxAvailablePoints > 0) {
    const expectedUncappedScore = (observation.rawPoints / observation.maxAvailablePoints) * 100;
    if (Math.abs(observation.uncappedScore - expectedUncappedScore) > TOLERANCE) {
      addIssue(["uncappedScore"], "uncappedScore must equal rawPoints/maxAvailablePoints*100 within two-decimal tolerance.");
    }
    if (observation.fallbackMethod === "none") {
      addIssue(["fallbackMethod"], "fallbackMethod=none is only valid when no points are available.");
    }
  } else if (observation.score !== 0 || observation.uncappedScore !== 0 || observation.fallbackMethod !== "none") {
    addIssue(["maxAvailablePoints"], "No available points requires score=0, uncappedScore=0, and fallbackMethod=none.");
  }

  const shouldBeComplete = observation.missingMetrics.length === 0 && observation.criticalMissingMetrics.length === 0 && observation.maxAvailablePoints === 100;
  if (observation.complete !== shouldBeComplete) {
    addIssue(["complete"], "complete must reflect full 100-point coverage with no missing or critical metrics.");
  }
  if (!observation.thinPeerSet && observation.fallbackMethod !== "peer_relative") {
    addIssue(["thinPeerSet"], "thinPeerSet=false requires fallbackMethod=peer_relative.");
  }
  if (["blended_50_50", "absolute"].includes(observation.fallbackMethod) && !observation.thinPeerSet) {
    addIssue(["thinPeerSet"], "blended_50_50 and absolute fallback methods require thinPeerSet=true.");
  }

  const thesisCriticalMetrics = observation.metrics.filter((metric) => metric.thesisCritical);
  const freshCriticalInputs = thesisCriticalMetrics.length > 0
    && thesisCriticalMetrics.every((metric) => metric.freshnessState === "fresh");
  if (observation.actionable) {
    if (!observation.eligible) addIssue(["actionable"], "actionable observations must be eligible.");
    if (observation.coverageMask.length === 0) addIssue(["actionable"], "actionable observations require nonempty coverage.");
    if (observation.maxAvailablePoints < 80) addIssue(["actionable"], "actionable observations require at least 80 available points.");
    if (observation.criticalMissingMetrics.length !== 0 || !freshCriticalInputs) {
      addIssue(["actionable"], "actionable observations require every thesis-critical metric to be fresh and present.");
    }
    if (["coverage", "version", "retry"].includes(observation.scoreCause)) {
      addIssue(["actionable"], "coverage, version, and retry observations are never directly research-actionable.");
    }
  }
});

/**
 * @typedef {z.infer<typeof MandateScoreMetricSchema>} MandateScoreMetric
 * @typedef {z.infer<typeof MandateScoreObservationSchema>} MandateScoreObservation
 */
