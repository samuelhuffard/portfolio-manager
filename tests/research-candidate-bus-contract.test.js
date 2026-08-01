import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  RESEARCH_CANDIDATE_BUS_VERSION,
  UNRESOLVED_POLICY_CHOICES,
  VALIDATION_BOUNDARIES,
  ResearchCandidateBusSchema,
  parseResearchCandidateBus,
  validateResearchCandidateBus,
} from "../contracts/research-candidate-bus.js";
import {
  conflictingBus,
  excludedSecurityCandidate,
  futureSourceBus,
  incompleteCandidate,
  invalidMissingProvenanceBus,
  representativeBus,
  specialSectorCandidate,
  staleCandidate,
  validBus,
  versionMismatchBus,
} from "./fixtures/research-candidate-bus/fixtures.js";

test("valid bus parses deterministically and records independent mandate ranks", () => {
  const input = validBus();
  const first = parseResearchCandidateBus(input);
  const second = parseResearchCandidateBus(validBus());
  assert.deepEqual(first, second);
  assert.equal(first.contractVersion, RESEARCH_CANDIDATE_BUS_VERSION);
  assert.deepEqual(first.ranks.map((rank) => [rank.agentId, rank.rankPosition]), [
    ["agent-1", 2],
    ["agent-2", 1],
    ["agent-3", 3],
  ]);
  assert.deepEqual(new Set(first.ranks.map((rank) => rank.candidateId)), new Set(["candidate-NVDA-20260716"]));
  assert.deepEqual(first.ranks.map((rank) => rank.mandateId), ["agent_one", "agent_two", "agent_three"]);
  assert.ok(first.ranks.every((rank) => !Object.hasOwn(rank, "ownerAgentId")));
});

test("representative fixtures preserve coverage visibility, stale/incomplete exclusions, ETF exclusion, and holding protection", () => {
  const parsed = parseResearchCandidateBus(representativeBus());
  const byTicker = new Map(parsed.candidates.map((candidate) => [candidate.security.ticker, candidate]));
  assert.equal(byTicker.get("BANK").eligible, false);
  assert.deepEqual(byTicker.get("BANK").exclusionReasonCodes, ["special_sector_economics_unresolved"]);
  assert.equal(byTicker.get("STALE").freshnessState, "stale");
  assert.equal(byTicker.get("INCOMPLETE").completenessState, "partial");
  assert.equal(byTicker.get("ETF1").security.securityType, "etf");
  assert.equal(byTicker.get("ETF1").eligible, false);
  assert.equal(byTicker.get("HELD").mandatoryReview, true);
  assert.equal(parsed.ranks.find((rank) => rank.ticker === "HELD").rankStatus, "mandatory_override");
  assert.equal(parsed.ranks.find((rank) => rank.ticker === "BANK").rankStatus, "visible_unranked");
});

test("provenance chronology is required and prevents future evidence from entering a snapshot", () => {
  assert.throws(() => ResearchCandidateBusSchema.parse(invalidMissingProvenanceBus()), /evidenceSnapshotIds/);
  assert.throws(() => ResearchCandidateBusSchema.parse(futureSourceBus()), /retrievedAt cannot follow candidate observedAt/);

  const futurePublication = validBus();
  futurePublication.candidates[0].sourceChannels[1].publishedAt = "2026-07-16T13:00:00.000Z";
  assert.throws(() => ResearchCandidateBusSchema.parse(futurePublication), /sourceAsOf cannot follow publishedAt/);

  const futureRank = validBus();
  futureRank.ranks[0].rankedAt = "2026-07-16T15:06:00.000Z";
  assert.throws(() => ResearchCandidateBusSchema.parse(futureRank), /rankedAt cannot follow bus publishedAt/);
});

test("security identities use honest, type-specific structural formats", () => {
  const honestFixture = validBus();
  assert.equal(honestFixture.candidates[0].security.securityId, "NVDA");
  assert.equal(honestFixture.candidates[0].security.securityIdType, "local_symbol");

  const mislabeledCik = validBus();
  mislabeledCik.candidates[0].security.securityId = "0001045810";
  mislabeledCik.candidates[0].security.securityIdType = "cusip";
  assert.throws(() => ResearchCandidateBusSchema.parse(mislabeledCik), /CUSIP/);

  const validCusip = validBus();
  validCusip.candidates[0].security.securityId = "67066G104";
  validCusip.candidates[0].security.securityIdType = "cusip";
  assert.doesNotThrow(() => ResearchCandidateBusSchema.parse(validCusip));

  const validIsin = validBus();
  validIsin.candidates[0].security.securityId = "US67066G1040";
  validIsin.candidates[0].security.securityIdType = "isin";
  assert.doesNotThrow(() => ResearchCandidateBusSchema.parse(validIsin));

  const malformedIsin = validBus();
  malformedIsin.candidates[0].security.securityId = "67066G104";
  malformedIsin.candidates[0].security.securityIdType = "isin";
  assert.throws(() => ResearchCandidateBusSchema.parse(malformedIsin), /ISIN/);
});

test("candidate evidence snapshots cannot leak future rank evidence or inputs", () => {
  const futureEvidence = validBus();
  futureEvidence.ranks[0].evidenceAsOf = "2026-07-16T15:01:00.000Z";
  futureEvidence.ranks[0].evidenceMeasuredAt = "2026-07-16T15:01:00.000Z";
  assert.throws(() => ResearchCandidateBusSchema.parse(futureEvidence), /rank evidenceAsOf cannot follow candidate observedAt/);

  const futureMeasuredEvidence = validBus();
  futureMeasuredEvidence.ranks[0].evidenceMeasuredAt = "2026-07-16T15:01:00.000Z";
  assert.throws(() => ResearchCandidateBusSchema.parse(futureMeasuredEvidence), /rank evidenceMeasuredAt cannot follow candidate observedAt/);

  const futureRankInput = validBus();
  futureRankInput.ranks[0].rankInputs[0].observedAt = "2026-07-16T15:01:00.000Z";
  assert.throws(() => ResearchCandidateBusSchema.parse(futureRankInput), /rank input observedAt cannot follow candidate observedAt/);
});

test("nullable publication timestamps remain valid when a source has no publication time", () => {
  const parsed = parseResearchCandidateBus(representativeBus());
  for (const candidateId of ["candidate-HELD-20260716", "candidate-INCOMPLETE-20260716"]) {
    const candidate = parsed.candidates.find((item) => item.candidateId === candidateId);
    assert.ok(candidate.sourceChannels.some((source) => source.publishedAt === null));
  }
});

test("malformed and unsupported payloads fail closed", () => {
  const malformed = validBus();
  malformed.candidates[0].security.ticker = "nvda";
  assert.throws(() => parseResearchCandidateBus(malformed), /uppercase/);

  const unsupported = validBus();
  unsupported.candidates[0].security.securityType = "crypto_token";
  assert.throws(() => parseResearchCandidateBus(unsupported), /Invalid enum value/);

  const authority = validBus();
  authority.action = "BUY";
  assert.throws(() => parseResearchCandidateBus(authority), /Unrecognized key/);

  const rankAuthority = validBus();
  rankAuthority.ranks[0].ownerAgentId = "agent-1";
  assert.throws(() => parseResearchCandidateBus(rankAuthority), /Unrecognized key/);
});

test("conflicting identities and version mismatches are distinct fail-closed errors", () => {
  assert.throws(() => parseResearchCandidateBus(conflictingBus()), /candidateId must be unique/);
  assert.throws(() => parseResearchCandidateBus(versionMismatchBus()), /Invalid literal value/);

  const rankVersionMismatch = validBus();
  rankVersionMismatch.ranks[0].candidateVersion = "candidate-NVDA-20260716-v2";
  assert.throws(() => parseResearchCandidateBus(rankVersionMismatch), /candidateVersion must match/);

  const policyVersionMismatch = validBus();
  policyVersionMismatch.candidates[0].eligibilityPolicyVersion = "eligibility-policy-v2";
  assert.throws(() => parseResearchCandidateBus(policyVersionMismatch), /candidate eligibility policy version/);
});

test("rank records remain per-agent and cannot silently turn ineligible facts into ranked candidates", () => {
  const invalid = representativeBus();
  const bankRank = invalid.ranks.find((rank) => rank.ticker === "BANK");
  bankRank.rankStatus = "ranked";
  bankRank.rankPosition = 4;
  bankRank.rankReasonCodes = ["special_sector_unresolved"];
  invalid.ranks.sort((a, b) => `${a.agentId}\u0000${a.candidateId}\u0000${a.rankId}`.localeCompare(`${b.agentId}\u0000${b.candidateId}\u0000${b.rankId}`));
  assert.throws(() => parseResearchCandidateBus(invalid), /ineligible candidates cannot receive/);
});

test("validation reports unresolved policy choices without inventing thresholds", () => {
  const valid = validateResearchCandidateBus(validBus());
  assert.equal(valid.ok, true);
  assert.deepEqual(valid.unresolvedPolicyChoices, [...UNRESOLVED_POLICY_CHOICES]);
  assert.deepEqual(VALIDATION_BOUNDARIES.unresolvedPolicyChoices, UNRESOLVED_POLICY_CHOICES);
  assert.ok(VALIDATION_BOUNDARIES.doesNotValidate.some((item) => item.includes("freshness age")));

  const invalid = validateResearchCandidateBus(versionMismatchBus());
  assert.equal(invalid.ok, false);
  assert.ok(invalid.issues.length > 0);
  assert.deepEqual(invalid.unresolvedPolicyChoices, [...UNRESOLVED_POLICY_CHOICES]);
});

test("contract source is isolated from production imports and parsed records expose no execution authority", () => {
  const source = readFileSync(new URL("../contracts/research-candidate-bus.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /from ["']\.\.(?:\/lib|\/jobs|\/scheduler|\/config)/);
  const parsed = parseResearchCandidateBus(validBus());
  assert.equal(parsed.authority, "research_only");
  assert.equal(parsed.executionAuthority, "none");
  assert.equal(Object.hasOwn(parsed, "action"), false);
  assert.equal(Object.hasOwn(parsed, "order"), false);
  assert.equal(Object.hasOwn(parsed, "amountDollars"), false);
});

test("fixtures cover the explicitly named stale, conflicting, incomplete, special-sector, excluded, and held cases", () => {
  assert.equal(staleCandidate().freshnessState, "stale");
  assert.equal(incompleteCandidate().completenessState, "partial");
  assert.equal(specialSectorCandidate().sectorClass, "banks");
  assert.equal(excludedSecurityCandidate().security.securityType, "etf");
  assert.equal(conflictingBus().candidates.length, 2);
  assert.equal(versionMismatchBus().contractVersion, "research-candidate-bus-v2");
});
