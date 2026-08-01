const BASE_OBSERVED_AT = "2026-07-16T15:00:00.000Z";
const BASE_PUBLISHED_AT = "2026-07-16T15:05:00.000Z";
const POLICY_VERSION = "eligible-us-operating-common-equities-v3";

function source(channel, sourceRecordId, sourceAsOf, publishedAt, retrievedAt) {
  return { channel, sourceRecordId, sourceVersion: `${channel}-v1`, sourceAsOf, publishedAt, retrievedAt };
}

export function eligibleCandidate(overrides = {}) {
  return {
    recordType: "EligibleResearchCandidate",
    recordVersion: "eligible-research-candidate-v1",
    candidateId: "candidate-NVDA-20260716",
    candidateVersion: "candidate-NVDA-20260716-v1",
    security: {
      ticker: "NVDA",
      securityId: "NVDA",
      securityIdType: "local_symbol",
      issuerName: "NVIDIA Corporation",
      securityType: "operating_common_equity",
      listingVenue: "NASDAQ",
    },
    observedAt: BASE_OBSERVED_AT,
    eligibilityPolicyVersion: POLICY_VERSION,
    universeSnapshotId: "universe-20260716",
    observationIds: ["observation-NVDA-20260716"],
    evidenceSnapshotIds: ["evidence-NVDA-20260716"],
    sourceChannels: [
      source("catalog", "catalog-20260716", "2026-07-16T14:30:00.000Z", "2026-07-16T14:45:00.000Z", "2026-07-16T14:50:00.000Z"),
      source("fundamentals", "evidence-NVDA-20260716", "2026-07-16T14:00:00.000Z", "2026-07-16T14:10:00.000Z", "2026-07-16T14:55:00.000Z"),
    ],
    freshnessState: "fresh",
    completenessState: "complete",
    sectorClass: "technology",
    marketCapClass: "mega",
    liquidityClass: "liquid",
    holdingStatus: "not_held",
    mandatoryReview: false,
    eligible: true,
    unavailableReasonCodes: [],
    exclusionReasonCodes: [],
    ...overrides,
  };
}

export function candidateRank(overrides = {}) {
  return {
    recordType: "MandateCandidateRank",
    recordVersion: "mandate-candidate-rank-v1",
    rankId: "rank-agent-1-NVDA-20260716",
    candidateId: "candidate-NVDA-20260716",
    candidateVersion: "candidate-NVDA-20260716-v1",
    ticker: "NVDA",
    evidenceSnapshotId: "evidence-NVDA-20260716",
    agentId: "agent-1",
    mandateId: "agent_one",
    mandateVersion: "3.0",
    rankingPolicyVersion: "agent-1-ranking-v3",
    rankedAt: "2026-07-16T15:01:00.000Z",
    rankStatus: "ranked",
    rankPosition: 2,
    rankInputs: [{
      inputId: "velocity",
      value: 0.82,
      unit: "percent",
      sourceEvidenceId: "evidence-NVDA-20260716",
      observedAt: "2026-07-16T15:00:00.000Z",
    }],
    rankReasonCodes: ["short_horizon_velocity"],
    evidenceAgeState: "fresh",
    evidenceAsOf: "2026-07-16T14:00:00.000Z",
    evidenceMeasuredAt: "2026-07-16T15:00:00.000Z",
    priorResearch: {
      state: "outside_recency_window",
      lastResearchedAt: "2026-06-01T15:00:00.000Z",
      ledgerEntryId: "ledger-NVDA-20260601",
    },
    shadowOnly: true,
    ...overrides,
  };
}

export function validBus() {
  return {
    recordType: "ResearchCandidateBus",
    contractVersion: "research-candidate-bus-v1",
    busId: "candidate-bus-20260716-1505",
    runId: "research-run-20260716-1500",
    candidatePolicyVersion: POLICY_VERSION,
    producerRevision: "offline-fixture-revision",
    asOf: BASE_OBSERVED_AT,
    publishedAt: BASE_PUBLISHED_AT,
    authority: "research_only",
    executionAuthority: "none",
    candidates: [eligibleCandidate()],
    ranks: [
      candidateRank({
        rankId: "rank-agent-1-NVDA-20260716",
        agentId: "agent-1",
        mandateId: "agent_one",
        rankPosition: 2,
        rankReasonCodes: ["short_horizon_velocity"],
        rankingPolicyVersion: "agent-1-ranking-v3",
      }),
      candidateRank({
        rankId: "rank-agent-2-NVDA-20260716",
        agentId: "agent-2",
        mandateId: "agent_two",
        rankPosition: 1,
        rankReasonCodes: ["medium_horizon_trend"],
        rankingPolicyVersion: "agent-2-ranking-v3",
      }),
      candidateRank({
        rankId: "rank-agent-3-NVDA-20260716",
        agentId: "agent-3",
        mandateId: "agent_three",
        rankPosition: 3,
        rankReasonCodes: ["long_horizon_quality"],
        rankingPolicyVersion: "agent-3-ranking-v3",
      }),
    ],
  };
}

export function specialSectorCandidate() {
  return eligibleCandidate({
    candidateId: "candidate-BANK-20260716",
    candidateVersion: "candidate-BANK-20260716-v1",
    security: {
      ticker: "BANK",
      securityId: "BANK",
      securityIdType: "local_symbol",
      issuerName: "Example Bank Corporation",
      securityType: "operating_common_equity",
      listingVenue: "NYSE",
    },
    observationIds: ["observation-BANK-20260716"],
    evidenceSnapshotIds: ["evidence-BANK-20260716"],
    sourceChannels: [
      source("catalog", "catalog-BANK-20260716", "2026-07-16T14:30:00.000Z", "2026-07-16T14:45:00.000Z", "2026-07-16T14:50:00.000Z"),
      source("fundamentals", "evidence-BANK-20260716", "2026-07-16T14:00:00.000Z", "2026-07-16T14:10:00.000Z", "2026-07-16T14:55:00.000Z"),
    ],
    sectorClass: "banks",
    completenessState: "policy_unresolved",
    eligible: false,
    unavailableReasonCodes: [],
    exclusionReasonCodes: ["special_sector_economics_unresolved"],
  });
}

export function staleCandidate() {
  return eligibleCandidate({
    candidateId: "candidate-STALE-20260716",
    candidateVersion: "candidate-STALE-20260716-v1",
    security: { ...eligibleCandidate().security, ticker: "STALE", securityId: "STALE" },
    evidenceSnapshotIds: ["evidence-STALE-20260716"],
    observationIds: ["observation-STALE-20260716"],
    sourceChannels: [source("quote", "evidence-STALE-20260716", "2026-07-01T14:00:00.000Z", "2026-07-01T14:01:00.000Z", "2026-07-01T14:02:00.000Z")],
    freshnessState: "stale",
    eligible: false,
    exclusionReasonCodes: ["stale_evidence"],
  });
}

export function incompleteCandidate() {
  return eligibleCandidate({
    candidateId: "candidate-INCOMPLETE-20260716",
    candidateVersion: "candidate-INCOMPLETE-20260716-v1",
    security: { ...eligibleCandidate().security, ticker: "INCOMPLETE", securityId: "INCOMPLETE" },
    evidenceSnapshotIds: ["evidence-INCOMPLETE-20260716"],
    observationIds: ["observation-INCOMPLETE-20260716"],
    sourceChannels: [source("catalog", "evidence-INCOMPLETE-20260716", "2026-07-16T14:00:00.000Z", null, "2026-07-16T14:55:00.000Z")],
    completenessState: "partial",
    eligible: false,
    exclusionReasonCodes: ["incomplete_evidence"],
  });
}

export function excludedSecurityCandidate() {
  return eligibleCandidate({
    candidateId: "candidate-ETF-20260716",
    candidateVersion: "candidate-ETF-20260716-v1",
    security: { ...eligibleCandidate().security, ticker: "ETF1", securityId: "ETF1", securityType: "etf" },
    evidenceSnapshotIds: ["evidence-ETF1-20260716"],
    observationIds: ["observation-ETF1-20260716"],
    sourceChannels: [source("catalog", "evidence-ETF1-20260716", "2026-07-16T14:00:00.000Z", "2026-07-16T14:10:00.000Z", "2026-07-16T14:55:00.000Z")],
    eligible: false,
    exclusionReasonCodes: ["excluded_security_type"],
  });
}

export function holdingCandidate() {
  return eligibleCandidate({
    candidateId: "candidate-HELD-20260716",
    candidateVersion: "candidate-HELD-20260716-v1",
    security: { ...eligibleCandidate().security, ticker: "HELD", securityId: "HELD" },
    evidenceSnapshotIds: ["evidence-HELD-20260716"],
    observationIds: ["observation-HELD-20260716"],
    sourceChannels: [source("holdings", "evidence-HELD-20260716", "2026-07-16T14:00:00.000Z", null, "2026-07-16T14:55:00.000Z")],
    holdingStatus: "held",
    mandatoryReview: true,
  });
}

export function representativeBus() {
  const bus = validBus();
  bus.candidates = [eligibleCandidate(), specialSectorCandidate(), staleCandidate(), incompleteCandidate(), excludedSecurityCandidate(), holdingCandidate()]
    .sort((a, b) => a.candidateId.localeCompare(b.candidateId));
  bus.ranks = [
    ...bus.ranks,
    {
      ...candidateRank({
        rankId: "rank-agent-1-BANK-20260716",
        candidateId: "candidate-BANK-20260716",
        candidateVersion: "candidate-BANK-20260716-v1",
        ticker: "BANK",
        evidenceSnapshotId: "evidence-BANK-20260716",
        rankStatus: "visible_unranked",
        rankPosition: null,
        rankReasonCodes: ["special_sector_unresolved"],
        rankInputs: [{
          inputId: "coverage",
          value: "policy_unresolved",
          unit: "state",
          sourceEvidenceId: "evidence-BANK-20260716",
          observedAt: "2026-07-16T15:00:00.000Z",
        }],
      }),
    },
    {
      ...candidateRank({
        rankId: "rank-agent-1-HELD-20260716",
        candidateId: "candidate-HELD-20260716",
        candidateVersion: "candidate-HELD-20260716-v1",
        ticker: "HELD",
        evidenceSnapshotId: "evidence-HELD-20260716",
        rankStatus: "mandatory_override",
        rankPosition: null,
        rankReasonCodes: ["holding_mandatory"],
        rankInputs: [{
          inputId: "holding",
          value: "held",
          unit: "state",
          sourceEvidenceId: "evidence-HELD-20260716",
          observedAt: "2026-07-16T15:00:00.000Z",
        }],
      }),
    },
  ].sort((a, b) => `${a.agentId}\u0000${a.candidateId}\u0000${a.rankId}`.localeCompare(`${b.agentId}\u0000${b.candidateId}\u0000${b.rankId}`));
  return bus;
}

export function invalidMissingProvenanceBus() {
  const bus = validBus();
  delete bus.candidates[0].evidenceSnapshotIds;
  return bus;
}

export function futureSourceBus() {
  const bus = validBus();
  bus.candidates[0].sourceChannels[1].retrievedAt = "2026-07-16T15:01:00.000Z";
  return bus;
}

export function conflictingBus() {
  const bus = validBus();
  bus.candidates.push(eligibleCandidate({
    candidateVersion: "candidate-NVDA-20260716-v2",
    security: { ...eligibleCandidate().security, ticker: "AMD", securityId: "AMD" },
  }));
  bus.candidates.sort((a, b) => a.candidateId.localeCompare(b.candidateId));
  return bus;
}

export function versionMismatchBus() {
  const bus = validBus();
  bus.contractVersion = "research-candidate-bus-v2";
  return bus;
}
