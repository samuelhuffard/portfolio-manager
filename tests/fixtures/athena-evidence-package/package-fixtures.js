import { ATHENA_EVIDENCE_PACKAGE_VERSION, fingerprintAthenaEvidencePackage } from "../../../contracts/athena-evidence-package.js";

const TIMES = {
  asOf: "2026-07-15T20:00:00.000Z",
  publishedAt: "2026-07-15T20:05:00.000Z",
  availableAt: "2026-07-15T20:06:00.000Z",
  retrievedAt: "2026-07-15T20:10:00.000Z",
  generatedAt: "2026-07-15T20:11:00.000Z",
  packageRetrievedAt: "2026-07-15T20:12:00.000Z",
};
const ATHENA_SECTION_IDS = ["analytical_modules", "catalysts", "challenges", "claims", "forecasts", "kill_criteria", "risks", "source_facts", "valuations"];

function source(overrides = {}) {
  const status = overrides.status ?? "available";
  const failureReason = overrides.failureReason ?? (status === "available" ? null : "provider_timeout");
  const unavailable = status !== "available";
  return {
    sourceId: "sec:10-q:0000320193-26-000001",
    provider: "SEC EDGAR",
    sourceTier: "primary",
    canonicalUrl: "https://www.sec.gov/Archives/edgar/data/320193/000032019326000001/aapl-20260630.htm",
    sourceIdentifier: "0000320193-26-000001",
    status,
    asOf: unavailable ? null : TIMES.asOf,
    publishedAt: unavailable ? null : TIMES.publishedAt,
    availableAt: unavailable ? null : TIMES.availableAt,
    retrieval: {
      retrievalId: "retrieval:sec:10-q:0000320193-26-000001",
      attemptedAt: TIMES.retrievedAt,
      completedAt: TIMES.retrievedAt,
      outcome: status === "available" ? "retrieved" : status,
      failureReason,
    },
    failureReason,
    ...overrides,
  };
}

function fact(overrides = {}) {
  return {
    evidenceId: "fact:revenue:q3-2026",
    sourceId: "sec:10-q:0000320193-26-000001",
    evidenceClass: "financial_fact",
    field: "revenue",
    rawValue: "94036000000",
    normalizedValue: 94036,
    unit: "usd_millions",
    periodStart: "2026-04-01T00:00:00.000Z",
    periodEnd: TIMES.asOf,
    asOf: TIMES.asOf,
    publishedAt: TIMES.publishedAt,
    availableAt: TIMES.availableAt,
    retrievedAt: TIMES.retrievedAt,
    freshnessState: "fresh",
    conflictState: "none",
    restatesEvidenceId: null,
    ...overrides,
  };
}

function sections(overrides = {}) {
  return [
    ["analytical_modules", "complete"],
    ["catalysts", "complete"],
    ["challenges", "complete"],
    ["claims", "complete"],
    ["forecasts", "complete"],
    ["kill_criteria", "complete"],
    ["risks", "complete"],
    ["source_facts", "complete"],
    ["valuations", "complete"],
  ].map(([sectionId, status]) => ({ sectionId, status: overrides[sectionId]?.status ?? status, reasons: overrides[sectionId]?.reasons ?? [] }));
}

export function makeAthenaEvidencePackage(overrides = {}) {
  const pkg = {
    contractVersion: ATHENA_EVIDENCE_PACKAGE_VERSION,
    packageId: "athena:package:aapl:2026-07-15T20:11:00.000Z",
    fingerprint: "0".repeat(64),
    security: {
      ticker: "AAPL",
      cik: "0000320193",
      exchange: "NASDAQ",
      shareClass: "common",
      currency: "USD",
      corporateActionIdentity: null,
    },
    sourceRevision: "athena@483a68b",
    methodologyVersion: "research-methodology-v1",
    modelRoutes: ["research/underwriting-v1", "research/valuation-v1"],
    researchRunId: "athena-run-2026-07-15-aapl-001",
    packageAsOf: TIMES.availableAt,
    generatedAt: TIMES.generatedAt,
    retrievedAt: TIMES.packageRetrievedAt,
    sources: [source()],
    sourceFacts: [fact()],
    analyticalModules: [{
      moduleId: "underwriting",
      status: "complete",
      asOf: TIMES.asOf,
      lastSuccessfulRefreshAt: TIMES.generatedAt,
      freshnessState: "fresh",
      evidenceIds: ["fact:revenue:q3-2026"],
      missingReasons: [],
      failureReasons: [],
    }],
    claims: [{
      claimId: "claim:revenue-growth",
      claimText: "Revenue increased year over year.",
      criticality: "proposal_critical",
      supportState: "supported",
      evidenceIds: ["fact:revenue:q3-2026"],
    }],
    challenges: [{
      challengeId: "challenge:pricing-pressure",
      kind: "adversarial_objection",
      statement: "Pricing pressure could weaken the revenue outlook.",
      disposition: "unresolved",
      response: null,
      evidenceIds: ["fact:revenue:q3-2026"],
      asOf: TIMES.asOf,
    }],
    risks: [{
      riskId: "risk:valuation",
      category: "valuation",
      statement: "The valuation is sensitive to terminal growth.",
      severity: "medium",
      mitigant: null,
      evidenceIds: ["fact:revenue:q3-2026"],
      asOf: TIMES.asOf,
    }],
    catalysts: [{
      catalystId: "catalyst:earnings",
      statement: "The next earnings release may clarify revenue durability.",
      timingDescription: "next reported quarter",
      eventAt: null,
      timingState: "uncertain",
      evidenceIds: ["fact:revenue:q3-2026"],
      asOf: TIMES.asOf,
    }],
    forecasts: [{
      forecastId: "forecast:revenue",
      metric: "revenue",
      horizonDescription: "next fiscal quarter",
      forecastValue: 98000,
      unit: "usd_millions",
      sourceKind: "internal_model",
      outcomeState: "active",
      evidenceIds: ["fact:revenue:q3-2026"],
      asOf: TIMES.asOf,
    }],
    killCriteriaInputs: [{
      killCriterionId: "kill:revenue-deceleration",
      condition: "Revenue materially decelerates from the underwritten trajectory.",
      inputDescription: "reported quarterly revenue",
      observedValue: 94036,
      state: "not_triggered",
      evidenceIds: ["fact:revenue:q3-2026"],
      asOf: TIMES.asOf,
    }],
    valuationAssumptions: [{
      assumptionId: "assumption:terminal-growth",
      name: "terminal growth",
      value: 0.025,
      unit: "decimal_ratio",
      provenanceKind: "observed_input",
      provenanceNote: null,
      evidenceIds: ["fact:revenue:q3-2026"],
      asOf: TIMES.asOf,
    }],
    valuations: [{
      valuationId: "valuation:base",
      methodologyVersion: "dcf-v1",
      asOf: TIMES.asOf,
      currency: "USD",
      range: { low: 180, high: 220 },
      assumptionIds: ["assumption:terminal-growth"],
      evidenceIds: ["fact:revenue:q3-2026"],
      distribution: {
        method: "monte_carlo",
        sampleCount: 10_000,
        p10: 175,
        p50: 200,
        p90: 230,
        priorProvenance: [{
          priorId: "prior:terminal-growth-dispersion",
          provenanceKind: "observed_dispersion",
          provenanceNote: null,
          evidenceIds: ["fact:revenue:q3-2026"],
        }],
      },
    }],
    quality: {
      availability: "available",
      completeness: "complete",
      completenessBySection: sections(),
      missingInputIds: [],
      staleSourceIds: [],
      conflictEvidenceIds: [],
      failedSourceIds: [],
      failureState: "none",
      failureReasons: [],
      intendedUses: ["comparison", "discovery", "proposal_critical", "underwriting"],
      confidence: { stated: 0.72, earned: null, calibrationState: "insufficient_sample", calibrationSampleSize: 0 },
    },
    ...overrides,
  };
  return { ...pkg, fingerprint: fingerprintAthenaEvidencePackage(pkg) };
}

export const validCompletePackage = makeAthenaEvidencePackage();

export const validPartialPackage = makeAthenaEvidencePackage({
  analyticalModules: [{
    ...validCompletePackage.analyticalModules[0],
    status: "partial",
    missingReasons: ["transcript_not_licensed"],
  }],
  quality: {
    ...validCompletePackage.quality,
    completeness: "partial",
    completenessBySection: sections({ analytical_modules: { status: "partial", reasons: ["transcript_not_licensed"] } }),
    missingInputIds: ["transcript:q3-2026"],
    intendedUses: ["comparison", "discovery", "underwriting"],
  },
});

export const stalePackage = makeAthenaEvidencePackage({
  sourceFacts: [fact({ freshnessState: "stale" })],
  analyticalModules: [{
    ...validCompletePackage.analyticalModules[0],
    status: "partial",
    freshnessState: "stale",
  }],
  quality: {
    ...validCompletePackage.quality,
    completeness: "partial",
    completenessBySection: sections({
      analytical_modules: { status: "partial", reasons: ["source_stale"] },
      source_facts: { status: "partial", reasons: ["source_stale"] },
    }),
    staleSourceIds: ["sec:10-q:0000320193-26-000001"],
    intendedUses: ["comparison", "discovery"],
  },
});

export const conflictingPackage = makeAthenaEvidencePackage({
  sourceFacts: [fact({ conflictState: "conflicting" })],
  claims: [{
    ...validCompletePackage.claims[0],
    claimText: "Reported revenue is conflicting across sources.",
    criticality: "contextual",
    supportState: "conflicted",
  }],
  quality: {
    ...validCompletePackage.quality,
    completeness: "partial",
    completenessBySection: sections({ claims: { status: "partial", reasons: ["source_conflict"] }, source_facts: { status: "partial", reasons: ["source_conflict"] } }),
    conflictEvidenceIds: ["fact:revenue:q3-2026"],
    intendedUses: ["comparison", "discovery", "underwriting"],
  },
});

export const failedSourcePackage = makeAthenaEvidencePackage({
  sources: [source({ status: "failed", failureReason: "provider_timeout" })],
  sourceFacts: [],
  analyticalModules: [{
    ...validCompletePackage.analyticalModules[0],
    status: "failed",
    lastSuccessfulRefreshAt: null,
    freshnessState: "unavailable",
    evidenceIds: [],
    failureReasons: ["provider_timeout"],
  }],
  claims: [],
  challenges: [],
  risks: [],
  catalysts: [],
  forecasts: [],
  killCriteriaInputs: [],
  valuationAssumptions: [],
  valuations: [],
  quality: {
    ...validCompletePackage.quality,
    availability: "available",
    completeness: "partial",
    completenessBySection: sections(Object.fromEntries([
      "analytical_modules", "catalysts", "challenges", "claims", "forecasts", "kill_criteria", "risks", "source_facts", "valuations",
    ].map((sectionId) => [sectionId, { status: sectionId === "analytical_modules" || sectionId === "source_facts" ? "failed" : "unavailable", reasons: ["provider_timeout"] }]))),
    failedSourceIds: ["sec:10-q:0000320193-26-000001"],
    failureState: "upstream_failed",
    failureReasons: ["provider_timeout"],
    intendedUses: ["discovery"],
  },
});

export const unavailablePackage = makeAthenaEvidencePackage({
  sources: [source({ status: "unavailable", failureReason: "partner_service_unavailable", retrieval: {
    retrievalId: "retrieval:athena:partner",
    attemptedAt: TIMES.retrievedAt,
    completedAt: null,
    outcome: "unavailable",
    failureReason: "partner_service_unavailable",
  } })],
  sourceFacts: [], analyticalModules: [], claims: [], challenges: [], risks: [], catalysts: [], forecasts: [], killCriteriaInputs: [], valuationAssumptions: [], valuations: [],
  quality: {
    ...validCompletePackage.quality,
    availability: "unavailable",
    completeness: "unavailable",
    completenessBySection: sections(Object.fromEntries(ATHENA_SECTION_IDS.map((sectionId) => [sectionId, { status: "unavailable", reasons: ["partner_service_unavailable"] }]))),
    failedSourceIds: ["sec:10-q:0000320193-26-000001"],
    failureState: "upstream_unavailable",
    failureReasons: ["partner_service_unavailable"],
    intendedUses: ["discovery"],
  },
});

export const malformedPackage = { ...validCompletePackage, sourceFacts: [{ ...validCompletePackage.sourceFacts[0], sourceId: "missing:source" }] };
export const missingSectionPackage = makeAthenaEvidencePackage({ risks: [] });
export const danglingReferencePackage = makeAthenaEvidencePackage({ valuations: [{ ...validCompletePackage.valuations[0], assumptionIds: ["assumption:missing"] }] });
export const missingSourceIdentityPackage = makeAthenaEvidencePackage({ sources: [source({ provider: "" })] });
export const invalidChronologyPackage = makeAthenaEvidencePackage({ packageAsOf: "2026-07-15T20:13:00.000Z" });
export const fingerprintMismatchPackage = { ...validCompletePackage, fingerprint: "f".repeat(64) };
export const versionMismatchPackage = { ...validCompletePackage, contractVersion: "AthenaEvidencePackage-v0" };
