// OFFLINE CONTRACT ONLY — intentionally not imported by the live Athena adapter.
//
// AthenaEvidencePackage-v1 is a read-only, mandate-independent, point-in-time
// research package. It is evidence, never a recommendation, proposal, approval,
// order, sizing instruction, or execution authority.

import { createHash } from "node:crypto";
import { z } from "zod";
import { TICKER_RE } from "./proposal.js";

export const ATHENA_EVIDENCE_PACKAGE_VERSION = "AthenaEvidencePackage-v1";
export const ATHENA_REQUIRED_SECTION_IDS = [
  "analytical_modules",
  "catalysts",
  "challenges",
  "claims",
  "forecasts",
  "kill_criteria",
  "risks",
  "source_facts",
  "valuations",
];
export const ATHENA_EVIDENCE_CLASSES = [
  "financial_fact",
  "filing",
  "transcript",
  "ir_document",
  "news",
  "guidance",
  "insider",
  "short_interest",
  "peer",
  "macro",
  "market_data",
  "consensus",
  "corporate_action",
];

const Iso = z.string().datetime({ offset: true });
const NonEmpty = z.string().min(1);
const HexSha256 = z.string().regex(/^[a-f0-9]{64}$/);
const Finite = z.number().finite();
const Score = z.number().finite().min(0).max(1);
const JsonScalar = z.union([z.string(), z.number().finite(), z.boolean(), z.null()]);
const PackageVersionSchema = z.literal(ATHENA_EVIDENCE_PACKAGE_VERSION);
const EvidenceClassSchema = z.enum(ATHENA_EVIDENCE_CLASSES);
const SectionIdSchema = z.enum(ATHENA_REQUIRED_SECTION_IDS);
const SourceStatusSchema = z.enum(["available", "failed", "unavailable"]);
const SectionStatusSchema = z.enum(["complete", "partial", "unavailable", "failed"]);
const FreshnessStateSchema = z.enum(["fresh", "stale", "unavailable"]);
const ConflictStateSchema = z.enum(["none", "conflicting", "restated", "unresolved"]);
const FailureStateSchema = z.enum(["none", "upstream_failed", "upstream_unavailable", "malformed_upstream"]);

function sortedUnique(values) {
  return values.every((value, index) => index === 0 || values[index - 1] < value);
}

function sameList(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function issue(ctx, path, message) {
  ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });
}

function assertSortedUnique(ctx, path, values) {
  if (!sortedUnique(values)) issue(ctx, path, `${path.join(".")} must be duplicate-free and lexicographically sorted.`);
}

function timestamp(value) {
  return Date.parse(value);
}

function validChronology(values) {
  const present = values.filter((value) => value !== null);
  return present.every((value, index) => index === 0 || timestamp(present[index - 1]) <= timestamp(value));
}

function canonicalize(value, seen = new Set(), path = "$") {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`Athena canonical JSON rejects non-finite numbers at ${path}`);
    return value;
  }
  if (["undefined", "function", "symbol", "bigint"].includes(typeof value)) {
    throw new TypeError(`Athena canonical JSON rejects unsupported ${typeof value} at ${path}`);
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new TypeError(`Athena canonical JSON rejects cyclic values at ${path}`);
    seen.add(value);
    try {
      return value.map((item, index) => {
        if (!(index in value)) throw new TypeError(`Athena canonical JSON rejects sparse arrays at ${path}[${index}]`);
        return canonicalize(item, seen, `${path}[${index}]`);
      });
    } finally {
      seen.delete(value);
    }
  }
  if (Object.prototype.toString.call(value) !== "[object Object]") {
    throw new TypeError(`Athena canonical JSON rejects non-plain objects at ${path}`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`Athena canonical JSON rejects non-plain objects at ${path}`);
  }
  if (seen.has(value)) throw new TypeError(`Athena canonical JSON rejects cyclic values at ${path}`);
  if (Object.getOwnPropertySymbols(value).length) throw new TypeError(`Athena canonical JSON rejects symbol keys at ${path}`);
  seen.add(value);
  try {
    return Object.fromEntries(Object.keys(value).sort().map((key) => {
      if (typeof value[key] === "undefined") throw new TypeError(`Athena canonical JSON rejects undefined at ${path}.${key}`);
      return [key, canonicalize(value[key], seen, `${path}.${key}`)];
    }));
  } finally {
    seen.delete(value);
  }
}

/** Self-contained because contracts/ is mirrored independently. */
export function canonicalAthenaEvidenceJson(value) {
  return JSON.stringify(canonicalize(value));
}

export function athenaEvidencePackagePayload(value) {
  const { fingerprint, ...payload } = value ?? {};
  return payload;
}

export function fingerprintAthenaEvidencePackage(value) {
  return createHash("sha256").update(canonicalAthenaEvidenceJson(athenaEvidencePackagePayload(value))).digest("hex");
}

export const AthenaSecurityIdentitySchema = z.object({
  ticker: z.string().regex(TICKER_RE),
  cik: z.string().regex(/^\d{10}$/),
  exchange: NonEmpty,
  shareClass: NonEmpty,
  currency: z.string().regex(/^[A-Z]{3}$/),
  corporateActionIdentity: NonEmpty.nullable(),
}).strict();

const AthenaSourceRetrievalSchema = z.object({
  retrievalId: NonEmpty,
  attemptedAt: Iso,
  completedAt: Iso.nullable(),
  outcome: z.enum(["retrieved", "failed", "unavailable"]),
  failureReason: NonEmpty.nullable(),
}).strict().superRefine((retrieval, ctx) => {
  if (retrieval.completedAt !== null && timestamp(retrieval.attemptedAt) > timestamp(retrieval.completedAt)) {
    issue(ctx, ["attemptedAt"], "Retrieval attemptedAt must be at or before completedAt.");
  }
  if (retrieval.outcome === "retrieved" && (retrieval.completedAt === null || retrieval.failureReason !== null)) {
    issue(ctx, ["outcome"], "Retrieved source attempts require completedAt and no failureReason.");
  }
  if (retrieval.outcome !== "retrieved" && retrieval.failureReason === null) {
    issue(ctx, ["failureReason"], "Failed or unavailable retrieval attempts require a failureReason.");
  }
});

export const AthenaSourceSchema = z.object({
  sourceId: NonEmpty,
  provider: NonEmpty,
  sourceTier: z.enum(["primary", "licensed", "secondary", "fallback"]),
  canonicalUrl: z.string().url(),
  sourceIdentifier: NonEmpty,
  status: SourceStatusSchema,
  asOf: Iso.nullable(),
  publishedAt: Iso.nullable(),
  availableAt: Iso.nullable(),
  retrieval: AthenaSourceRetrievalSchema,
  failureReason: NonEmpty.nullable(),
}).strict().superRefine((source, ctx) => {
  if (!validChronology([source.asOf, source.publishedAt, source.availableAt, source.retrieval.completedAt])) {
    issue(ctx, ["asOf"], "Known source chronology requires asOf <= publishedAt <= availableAt <= retrieval.completedAt.");
  }
  const sourceIsAvailable = source.status === "available";
  if (sourceIsAvailable && (source.asOf === null || source.publishedAt === null || source.availableAt === null || source.failureReason !== null || source.retrieval.outcome !== "retrieved")) {
    issue(ctx, ["status"], "Available sources require all source timestamps, a retrieved attempt, and no failureReason.");
  }
  if (!sourceIsAvailable && (source.failureReason === null || source.retrieval.outcome !== source.status || source.retrieval.failureReason !== source.failureReason)) {
    issue(ctx, ["status"], "Failed or unavailable sources require matching retrieval/failure provenance and an explicit reason.");
  }
});

export const AthenaSourceFactSchema = z.object({
  evidenceId: NonEmpty,
  sourceId: NonEmpty,
  evidenceClass: EvidenceClassSchema,
  field: NonEmpty,
  rawValue: JsonScalar,
  normalizedValue: JsonScalar,
  unit: NonEmpty.nullable(),
  periodStart: Iso.nullable(),
  periodEnd: Iso.nullable(),
  asOf: Iso,
  publishedAt: Iso,
  availableAt: Iso,
  retrievedAt: Iso,
  freshnessState: FreshnessStateSchema,
  conflictState: ConflictStateSchema,
  restatesEvidenceId: NonEmpty.nullable(),
}).strict().superRefine((fact, ctx) => {
  if (fact.periodStart !== null && fact.periodEnd !== null && timestamp(fact.periodStart) > timestamp(fact.periodEnd)) {
    issue(ctx, ["periodStart"], "periodStart must be at or before periodEnd.");
  }
  if (!validChronology([fact.asOf, fact.publishedAt, fact.availableAt, fact.retrievedAt])) {
    issue(ctx, ["asOf"], "Fact chronology requires asOf <= publishedAt <= availableAt <= retrievedAt.");
  }
  if (fact.conflictState === "restated" && fact.restatesEvidenceId === null) issue(ctx, ["restatesEvidenceId"], "Restated facts require restatesEvidenceId.");
  if (fact.conflictState !== "restated" && fact.restatesEvidenceId !== null) issue(ctx, ["restatesEvidenceId"], "Only restated facts may carry restatesEvidenceId.");
});

const EvidenceIdsSchema = z.array(NonEmpty).min(1).superRefine((ids, ctx) => assertSortedUnique(ctx, [], ids));

export const AthenaAnalyticalModuleSchema = z.object({
  moduleId: NonEmpty,
  status: SectionStatusSchema,
  asOf: Iso,
  lastSuccessfulRefreshAt: Iso.nullable(),
  freshnessState: FreshnessStateSchema,
  evidenceIds: z.array(NonEmpty),
  missingReasons: z.array(NonEmpty),
  failureReasons: z.array(NonEmpty),
}).strict().superRefine((module, ctx) => {
  for (const field of ["evidenceIds", "missingReasons", "failureReasons"]) assertSortedUnique(ctx, [field], module[field]);
  if (module.lastSuccessfulRefreshAt !== null && timestamp(module.asOf) > timestamp(module.lastSuccessfulRefreshAt)) {
    issue(ctx, ["asOf"], "Module asOf must be at or before lastSuccessfulRefreshAt.");
  }
  if (module.status === "complete" && (module.freshnessState !== "fresh" || module.evidenceIds.length === 0 || module.missingReasons.length || module.failureReasons.length)) {
    issue(ctx, ["status"], "Complete modules must be fresh, evidenced, and free of missing/failure reasons.");
  }
  if (module.status === "partial" && module.missingReasons.length === 0 && module.failureReasons.length === 0 && module.freshnessState !== "stale") {
    issue(ctx, ["status"], "Partial modules require a missing/failure reason or stale freshness.");
  }
  if (["unavailable", "failed"].includes(module.status) && module.lastSuccessfulRefreshAt !== null) {
    issue(ctx, ["lastSuccessfulRefreshAt"], "Unavailable or failed modules must not claim a successful refresh.");
  }
  if (module.status === "failed" && module.failureReasons.length === 0) issue(ctx, ["failureReasons"], "Failed modules require failureReasons.");
});

export const AthenaClaimSchema = z.object({
  claimId: NonEmpty,
  claimText: NonEmpty,
  criticality: z.enum(["contextual", "proposal_critical"]),
  supportState: z.enum(["supported", "partial", "unsupported", "conflicted"]),
  evidenceIds: z.array(NonEmpty),
}).strict().superRefine((claim, ctx) => {
  assertSortedUnique(ctx, ["evidenceIds"], claim.evidenceIds);
  if (claim.supportState === "unsupported" && claim.evidenceIds.length !== 0) issue(ctx, ["evidenceIds"], "Unsupported claims must not cite evidence as support.");
  if (claim.supportState !== "unsupported" && claim.evidenceIds.length === 0) issue(ctx, ["evidenceIds"], "Supported, partial, or conflicted claims require evidence IDs.");
  if (claim.criticality === "proposal_critical" && claim.supportState !== "supported") issue(ctx, ["supportState"], "Proposal-critical claims must be supported, never partial or conflicted.");
});

export const AthenaChallengeSchema = z.object({
  challengeId: NonEmpty,
  kind: z.enum(["bear_case", "thesis_threat", "adversarial_objection"]),
  statement: NonEmpty,
  disposition: z.enum(["addressed", "unresolved"]),
  response: NonEmpty.nullable(),
  evidenceIds: EvidenceIdsSchema,
  asOf: Iso,
}).strict().superRefine((challenge, ctx) => {
  if (challenge.disposition === "addressed" && challenge.response === null) issue(ctx, ["response"], "Addressed challenges require a response.");
  if (challenge.disposition === "unresolved" && challenge.response !== null) issue(ctx, ["response"], "Unresolved challenges must not imply a resolved response.");
});

export const AthenaRiskSchema = z.object({
  riskId: NonEmpty,
  category: z.enum(["business", "financial", "valuation", "regulatory", "macro", "operational"]),
  statement: NonEmpty,
  severity: z.enum(["low", "medium", "high"]),
  mitigant: NonEmpty.nullable(),
  evidenceIds: EvidenceIdsSchema,
  asOf: Iso,
}).strict();

export const AthenaCatalystSchema = z.object({
  catalystId: NonEmpty,
  statement: NonEmpty,
  timingDescription: NonEmpty,
  eventAt: Iso.nullable(),
  timingState: z.enum(["observed", "anticipated", "uncertain"]),
  evidenceIds: EvidenceIdsSchema,
  asOf: Iso,
}).strict();

export const AthenaForecastSchema = z.object({
  forecastId: NonEmpty,
  metric: NonEmpty,
  horizonDescription: NonEmpty,
  forecastValue: JsonScalar,
  unit: NonEmpty.nullable(),
  sourceKind: z.enum(["company_guidance", "consensus", "internal_model", "other"]),
  outcomeState: z.enum(["active", "realized", "missed", "unknown"]),
  evidenceIds: EvidenceIdsSchema,
  asOf: Iso,
}).strict();

export const AthenaKillCriterionInputSchema = z.object({
  killCriterionId: NonEmpty,
  condition: NonEmpty,
  inputDescription: NonEmpty,
  observedValue: JsonScalar,
  state: z.enum(["not_triggered", "triggered", "unknown"]),
  evidenceIds: EvidenceIdsSchema,
  asOf: Iso,
}).strict();

export const AthenaValuationAssumptionSchema = z.object({
  assumptionId: NonEmpty,
  name: NonEmpty,
  value: JsonScalar,
  unit: NonEmpty.nullable(),
  provenanceKind: z.enum(["observed_input", "documented_fallback"]),
  provenanceNote: NonEmpty.nullable(),
  evidenceIds: EvidenceIdsSchema,
  asOf: Iso,
}).strict().superRefine((assumption, ctx) => {
  if (assumption.provenanceKind === "documented_fallback" && assumption.provenanceNote === null) {
    issue(ctx, ["provenanceNote"], "Documented fallback assumptions require a provenanceNote.");
  }
  if (assumption.provenanceKind === "observed_input" && assumption.provenanceNote !== null) {
    issue(ctx, ["provenanceNote"], "Observed inputs must not be relabeled as a fallback.");
  }
});

const AthenaDistributionSchema = z.object({
  method: z.literal("monte_carlo"),
  sampleCount: z.number().int().positive(),
  p10: Finite,
  p50: Finite,
  p90: Finite,
  priorProvenance: z.array(z.object({
    priorId: NonEmpty,
    provenanceKind: z.enum(["observed_dispersion", "documented_fallback"]),
    provenanceNote: NonEmpty.nullable(),
    evidenceIds: EvidenceIdsSchema,
  }).strict()).min(1),
}).strict().superRefine((distribution, ctx) => {
  if (distribution.p10 > distribution.p50 || distribution.p50 > distribution.p90) issue(ctx, ["p10"], "Distribution percentiles require p10 <= p50 <= p90.");
  assertSortedUnique(ctx, ["priorProvenance"], distribution.priorProvenance.map((prior) => prior.priorId));
  distribution.priorProvenance.forEach((prior, index) => {
    if (prior.provenanceKind === "documented_fallback" && prior.provenanceNote === null) issue(ctx, ["priorProvenance", index, "provenanceNote"], "Documented fallback priors require a provenanceNote.");
    if (prior.provenanceKind === "observed_dispersion" && prior.provenanceNote !== null) issue(ctx, ["priorProvenance", index, "provenanceNote"], "Observed-dispersion priors must not be relabeled as a fallback.");
  });
});

export const AthenaValuationSchema = z.object({
  valuationId: NonEmpty,
  methodologyVersion: NonEmpty,
  asOf: Iso,
  currency: z.string().regex(/^[A-Z]{3}$/),
  range: z.object({ low: Finite, high: Finite }).strict(),
  assumptionIds: z.array(NonEmpty).min(1),
  evidenceIds: EvidenceIdsSchema,
  distribution: AthenaDistributionSchema.nullable(),
}).strict().superRefine((valuation, ctx) => {
  assertSortedUnique(ctx, ["assumptionIds"], valuation.assumptionIds);
  if (valuation.range.low > valuation.range.high) issue(ctx, ["range", "low"], "Valuation range low must be less than or equal to high.");
});

const CompletenessBySectionSchema = z.object({
  sectionId: SectionIdSchema,
  status: SectionStatusSchema,
  reasons: z.array(NonEmpty),
}).strict().superRefine((section, ctx) => {
  assertSortedUnique(ctx, ["reasons"], section.reasons);
  if (section.status === "complete" && section.reasons.length) issue(ctx, ["reasons"], "Complete sections must not carry reasons.");
  if (section.status !== "complete" && section.reasons.length === 0) issue(ctx, ["reasons"], "Partial, unavailable, or failed sections require reasons.");
});

export const AthenaEvidenceQualitySchema = z.object({
  availability: z.enum(["available", "unavailable"]),
  completeness: z.enum(["complete", "partial", "unavailable"]),
  completenessBySection: z.array(CompletenessBySectionSchema).length(ATHENA_REQUIRED_SECTION_IDS.length),
  missingInputIds: z.array(NonEmpty),
  staleSourceIds: z.array(NonEmpty),
  conflictEvidenceIds: z.array(NonEmpty),
  failedSourceIds: z.array(NonEmpty),
  failureState: FailureStateSchema,
  failureReasons: z.array(NonEmpty),
  intendedUses: z.array(z.enum(["discovery", "comparison", "underwriting", "proposal_critical"])).min(1),
  confidence: z.object({
    stated: Score.nullable(),
    earned: Score.nullable(),
    calibrationState: z.enum(["unknown", "insufficient_sample", "calibrated"]),
    calibrationSampleSize: z.number().int().nonnegative(),
  }).strict(),
}).strict().superRefine((quality, ctx) => {
  const sections = quality.completenessBySection.map((section) => section.sectionId);
  if (!sameList(sections, ATHENA_REQUIRED_SECTION_IDS)) issue(ctx, ["completenessBySection"], "Completeness must name every required section once in canonical order.");
  for (const field of ["missingInputIds", "staleSourceIds", "conflictEvidenceIds", "failedSourceIds", "failureReasons", "intendedUses"]) {
    assertSortedUnique(ctx, [field], quality[field]);
  }
  if (quality.confidence.calibrationState === "calibrated" && quality.confidence.calibrationSampleSize === 0) {
    issue(ctx, ["confidence", "calibrationSampleSize"], "Calibrated confidence requires a nonzero sample size.");
  }
  if (quality.failureState === "none" && quality.failureReasons.length) issue(ctx, ["failureReasons"], "failureState=none must not carry failureReasons.");
  if (quality.failureState !== "none" && quality.failureReasons.length === 0) issue(ctx, ["failureReasons"], "A failureState requires failureReasons.");
  const allComplete = quality.completenessBySection.every((section) => section.status === "complete");
  if (quality.completeness === "complete" && (quality.availability !== "available" || !allComplete || quality.missingInputIds.length || quality.staleSourceIds.length || quality.conflictEvidenceIds.length || quality.failedSourceIds.length || quality.failureState !== "none")) {
    issue(ctx, ["completeness"], "Complete packages must be available with complete sections and no missing, stale, conflicting, or failed inputs.");
  }
  if (quality.completeness === "partial" && (quality.availability !== "available" || (allComplete && !quality.missingInputIds.length && !quality.staleSourceIds.length && !quality.conflictEvidenceIds.length && !quality.failedSourceIds.length && quality.failureState === "none"))) {
    issue(ctx, ["completeness"], "Partial packages must be available and expose an explicit incompleteness condition.");
  }
  if (quality.completeness === "unavailable" && (quality.availability !== "unavailable" || quality.failureState === "none")) {
    issue(ctx, ["completeness"], "Unavailable packages require availability=unavailable and a non-none failureState.");
  }
});

const SECTION_FIELDS = Object.freeze({
  analytical_modules: "analyticalModules",
  catalysts: "catalysts",
  challenges: "challenges",
  claims: "claims",
  forecasts: "forecasts",
  kill_criteria: "killCriteriaInputs",
  risks: "risks",
  source_facts: "sourceFacts",
  valuations: "valuations",
});

export const AthenaEvidencePackageSchema = z.object({
  contractVersion: PackageVersionSchema,
  packageId: NonEmpty,
  fingerprint: HexSha256,
  security: AthenaSecurityIdentitySchema,
  sourceRevision: NonEmpty,
  methodologyVersion: NonEmpty,
  modelRoutes: z.array(NonEmpty).min(1),
  researchRunId: NonEmpty,
  packageAsOf: Iso,
  generatedAt: Iso,
  retrievedAt: Iso,
  sources: z.array(AthenaSourceSchema).min(1),
  sourceFacts: z.array(AthenaSourceFactSchema),
  analyticalModules: z.array(AthenaAnalyticalModuleSchema),
  claims: z.array(AthenaClaimSchema),
  challenges: z.array(AthenaChallengeSchema),
  risks: z.array(AthenaRiskSchema),
  catalysts: z.array(AthenaCatalystSchema),
  forecasts: z.array(AthenaForecastSchema),
  killCriteriaInputs: z.array(AthenaKillCriterionInputSchema),
  valuationAssumptions: z.array(AthenaValuationAssumptionSchema),
  valuations: z.array(AthenaValuationSchema),
  quality: AthenaEvidenceQualitySchema,
}).strict().superRefine((pkg, ctx) => {
  assertSortedUnique(ctx, ["modelRoutes"], pkg.modelRoutes);
  const lists = [
    ["sources", pkg.sources.map((source) => source.sourceId)],
    ["sourceFacts", pkg.sourceFacts.map((fact) => fact.evidenceId)],
    ["analyticalModules", pkg.analyticalModules.map((module) => module.moduleId)],
    ["claims", pkg.claims.map((claim) => claim.claimId)],
    ["challenges", pkg.challenges.map((challenge) => challenge.challengeId)],
    ["risks", pkg.risks.map((risk) => risk.riskId)],
    ["catalysts", pkg.catalysts.map((catalyst) => catalyst.catalystId)],
    ["forecasts", pkg.forecasts.map((forecast) => forecast.forecastId)],
    ["killCriteriaInputs", pkg.killCriteriaInputs.map((criterion) => criterion.killCriterionId)],
    ["valuationAssumptions", pkg.valuationAssumptions.map((assumption) => assumption.assumptionId)],
    ["valuations", pkg.valuations.map((valuation) => valuation.valuationId)],
  ];
  for (const [name, values] of lists) assertSortedUnique(ctx, [name], values);
  if (!validChronology([pkg.packageAsOf, pkg.generatedAt, pkg.retrievedAt])) issue(ctx, ["packageAsOf"], "Package chronology requires packageAsOf <= generatedAt <= retrievedAt.");

  const assertAtOrBefore = (path, value, cutoff, message) => {
    if (value !== null && timestamp(value) > timestamp(cutoff)) issue(ctx, path, message);
  };
  pkg.sources.forEach((source, index) => {
    assertAtOrBefore(
      ["sources", index, "availableAt"],
      source.availableAt,
      pkg.packageAsOf,
      "Source availableAt cannot follow the packageAsOf evidence cutoff.",
    );
    assertAtOrBefore(
      ["sources", index, "retrieval", "attemptedAt"],
      source.retrieval.attemptedAt,
      pkg.retrievedAt,
      "Source retrieval attemptedAt cannot follow package retrievedAt.",
    );
    assertAtOrBefore(
      ["sources", index, "retrieval", "completedAt"],
      source.retrieval.completedAt,
      pkg.retrievedAt,
      "Source retrieval completedAt cannot follow package retrievedAt.",
    );
  });

  const generatedRecords = [
    ["analyticalModules", pkg.analyticalModules],
    ["challenges", pkg.challenges],
    ["risks", pkg.risks],
    ["catalysts", pkg.catalysts],
    ["forecasts", pkg.forecasts],
    ["killCriteriaInputs", pkg.killCriteriaInputs],
    ["valuationAssumptions", pkg.valuationAssumptions],
    ["valuations", pkg.valuations],
  ];
  for (const [field, records] of generatedRecords) {
    records.forEach((record, index) => assertAtOrBefore(
      [field, index, "asOf"],
      record.asOf,
      pkg.generatedAt,
      `${field} asOf cannot follow package generatedAt.`,
    ));
  }

  const sourceById = new Map(pkg.sources.map((source) => [source.sourceId, source]));
  const factById = new Map(pkg.sourceFacts.map((fact) => [fact.evidenceId, fact]));
  const assumptionById = new Map(pkg.valuationAssumptions.map((assumption) => [assumption.assumptionId, assumption]));
  for (const fact of pkg.sourceFacts) {
    const source = sourceById.get(fact.sourceId);
    assertAtOrBefore(
      ["sourceFacts", fact.evidenceId, "availableAt"],
      fact.availableAt,
      pkg.packageAsOf,
      `Fact ${fact.evidenceId} availableAt cannot follow the packageAsOf evidence cutoff.`,
    );
    if (!source) issue(ctx, ["sourceFacts"], `Fact ${fact.evidenceId} references an unknown sourceId.`);
    else if (source.status !== "available") issue(ctx, ["sourceFacts"], `Fact ${fact.evidenceId} cannot cite a ${source.status} source.`);
    else if (timestamp(fact.retrievedAt) > timestamp(pkg.retrievedAt)) issue(ctx, ["sourceFacts"], `Fact ${fact.evidenceId} was retrieved after the package.`);
  }
  const requireFacts = (path, ids) => ids.forEach((id) => {
    if (!factById.has(id)) issue(ctx, path, `Referenced evidence ID ${id} is absent from sourceFacts.`);
  });
  pkg.analyticalModules.forEach((module) => requireFacts(["analyticalModules", module.moduleId, "evidenceIds"], module.evidenceIds));
  pkg.claims.forEach((claim) => requireFacts(["claims", claim.claimId, "evidenceIds"], claim.evidenceIds));
  pkg.challenges.forEach((challenge) => requireFacts(["challenges", challenge.challengeId, "evidenceIds"], challenge.evidenceIds));
  pkg.risks.forEach((risk) => requireFacts(["risks", risk.riskId, "evidenceIds"], risk.evidenceIds));
  pkg.catalysts.forEach((catalyst) => requireFacts(["catalysts", catalyst.catalystId, "evidenceIds"], catalyst.evidenceIds));
  pkg.forecasts.forEach((forecast) => requireFacts(["forecasts", forecast.forecastId, "evidenceIds"], forecast.evidenceIds));
  pkg.killCriteriaInputs.forEach((criterion) => requireFacts(["killCriteriaInputs", criterion.killCriterionId, "evidenceIds"], criterion.evidenceIds));
  pkg.valuationAssumptions.forEach((assumption) => requireFacts(["valuationAssumptions", assumption.assumptionId, "evidenceIds"], assumption.evidenceIds));
  pkg.valuations.forEach((valuation) => {
    requireFacts(["valuations", valuation.valuationId, "evidenceIds"], valuation.evidenceIds);
    valuation.assumptionIds.forEach((id) => {
      if (!assumptionById.has(id)) issue(ctx, ["valuations", valuation.valuationId, "assumptionIds"], `Valuation ${valuation.valuationId} references an unknown assumptionId.`);
    });
    valuation.distribution?.priorProvenance.forEach((prior, index) => requireFacts(["valuations", valuation.valuationId, "distribution", "priorProvenance", index, "evidenceIds"], prior.evidenceIds));
  });

  const expectedFailed = pkg.sources.filter((source) => source.status !== "available").map((source) => source.sourceId).sort();
  const expectedStale = [...new Set(pkg.sourceFacts.filter((fact) => fact.freshnessState === "stale").map((fact) => fact.sourceId))].sort();
  const expectedConflicts = pkg.sourceFacts.filter((fact) => fact.conflictState !== "none").map((fact) => fact.evidenceId).sort();
  if (!sameList(pkg.quality.failedSourceIds, expectedFailed)) issue(ctx, ["quality", "failedSourceIds"], "failedSourceIds must exactly reflect non-available sources.");
  if (!sameList(pkg.quality.staleSourceIds, expectedStale)) issue(ctx, ["quality", "staleSourceIds"], "staleSourceIds must exactly reflect stale source facts.");
  if (!sameList(pkg.quality.conflictEvidenceIds, expectedConflicts)) issue(ctx, ["quality", "conflictEvidenceIds"], "conflictEvidenceIds must exactly reflect conflicted or restated facts.");

  const sectionById = new Map(pkg.quality.completenessBySection.map((section) => [section.sectionId, section]));
  for (const sectionId of ATHENA_REQUIRED_SECTION_IDS) {
    const field = SECTION_FIELDS[sectionId];
    if (sectionById.get(sectionId)?.status === "complete" && pkg[field].length === 0) {
      issue(ctx, ["quality", "completenessBySection"], `Complete ${sectionId} sections require nonempty ${field}.`);
    }
  }
  const analyticalSection = sectionById.get("analytical_modules");
  if (analyticalSection?.status === "complete" && pkg.analyticalModules.some((module) => module.status !== "complete")) {
    issue(ctx, ["quality", "completenessBySection"], "Complete analytical_modules sections cannot contain partial, unavailable, or failed modules.");
  }
  if (pkg.quality.completeness === "complete" && pkg.valuationAssumptions.length === 0) {
    issue(ctx, ["valuationAssumptions"], "Complete packages require valuation assumption records.");
  }
  const expectedFingerprint = fingerprintAthenaEvidencePackage(pkg);
  if (pkg.fingerprint !== expectedFingerprint) issue(ctx, ["fingerprint"], "fingerprint must equal the SHA-256 canonical package payload.");
});

/** @typedef {z.infer<typeof AthenaEvidencePackageSchema>} AthenaEvidencePackage */
