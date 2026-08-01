import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ATHENA_EVIDENCE_PACKAGE_VERSION,
  AthenaEvidencePackageSchema,
  canonicalAthenaEvidenceJson,
  fingerprintAthenaEvidencePackage,
} from "../contracts/athena-evidence-package.js";
import {
  conflictingPackage,
  danglingReferencePackage,
  failedSourcePackage,
  fingerprintMismatchPackage,
  invalidChronologyPackage,
  malformedPackage,
  makeAthenaEvidencePackage,
  missingSectionPackage,
  missingSourceIdentityPackage,
  stalePackage,
  unavailablePackage,
  validCompletePackage,
  validPartialPackage,
  versionMismatchPackage,
} from "./fixtures/athena-evidence-package/package-fixtures.js";

function signed(overrides) {
  return makeAthenaEvidencePackage(overrides);
}

test("AthenaEvidencePackage-v1 accepts a positive, provenance-linked complete package", () => {
  assert.doesNotThrow(() => AthenaEvidencePackageSchema.parse(validCompletePackage));
  assert.equal(validCompletePackage.contractVersion, ATHENA_EVIDENCE_PACKAGE_VERSION);
  assert.equal(validCompletePackage.challenges[0].disposition, "unresolved");
  assert.equal(validCompletePackage.valuations[0].distribution.method, "monte_carlo");
  assert.equal(validCompletePackage.valuations[0].assumptionIds[0], validCompletePackage.valuationAssumptions[0].assumptionId);
});

test("partial, stale, conflicting, failed-source, and unavailable fixtures remain explicit", () => {
  for (const fixture of [validPartialPackage, stalePackage, conflictingPackage, failedSourcePackage, unavailablePackage]) {
    assert.doesNotThrow(() => AthenaEvidencePackageSchema.parse(fixture));
  }
  assert.equal(stalePackage.quality.completeness, "partial");
  assert.equal(conflictingPackage.quality.conflictEvidenceIds.length, 1);
  assert.equal(failedSourcePackage.quality.failureState, "upstream_failed");
  assert.equal(unavailablePackage.sources[0].publishedAt, null);
  assert.equal(unavailablePackage.sources[0].retrieval.failureReason, "partner_service_unavailable");
});

test("complete metadata cannot mask an omitted required analytical section", () => {
  assert.throws(() => AthenaEvidencePackageSchema.parse(missingSectionPackage), /Complete risks sections require nonempty risks/);
  const fakeCompletePartial = signed({
    ...validPartialPackage,
    quality: { ...validPartialPackage.quality, completeness: "complete" },
  });
  assert.throws(() => AthenaEvidencePackageSchema.parse(fakeCompletePartial), /Complete packages must be available/);
});

test("provenance-linked records and valuation assumption references fail closed when dangling", () => {
  assert.throws(() => AthenaEvidencePackageSchema.parse(malformedPackage), /unknown sourceId/);
  assert.throws(() => AthenaEvidencePackageSchema.parse(danglingReferencePackage), /unknown assumptionId/);
  const danglingChallengeEvidence = signed({
    challenges: [{ ...validCompletePackage.challenges[0], evidenceIds: ["fact:missing"] }],
  });
  assert.throws(() => AthenaEvidencePackageSchema.parse(danglingChallengeEvidence), /Referenced evidence ID fact:missing/);
});

test("unavailable source timestamps may be unknown, but retrieval and failure provenance cannot be omitted", () => {
  const missingFailureProvenance = signed({
    ...unavailablePackage,
    sources: [{
      ...unavailablePackage.sources[0],
      failureReason: null,
      retrieval: { ...unavailablePackage.sources[0].retrieval, failureReason: null },
    }],
  });
  assert.throws(() => AthenaEvidencePackageSchema.parse(missingFailureProvenance), /require a failureReason|matching retrieval/);
});

test("canonical fingerprints are deterministic and change for material package or source-version changes", () => {
  const reordered = Object.fromEntries(Object.entries(validCompletePackage).reverse());
  const changedFact = signed({ sourceFacts: [{ ...validCompletePackage.sourceFacts[0], normalizedValue: 94037 }] });
  const changedRevision = signed({ sourceRevision: "athena@different-revision" });
  assert.equal(fingerprintAthenaEvidencePackage(validCompletePackage), fingerprintAthenaEvidencePackage(reordered));
  assert.notEqual(changedFact.fingerprint, validCompletePackage.fingerprint);
  assert.notEqual(changedRevision.fingerprint, validCompletePackage.fingerprint);
  assert.equal(canonicalAthenaEvidenceJson({ z: [{ b: 2, a: 1 }], a: true }), '{"a":true,"z":[{"a":1,"b":2}]}');
  assert.doesNotThrow(() => AthenaEvidencePackageSchema.parse(reordered));
});

test("fingerprint mismatch, malformed values, chronology, and unknown versions fail closed", () => {
  assert.throws(() => AthenaEvidencePackageSchema.parse(versionMismatchPackage), /Invalid literal value/);
  assert.throws(() => AthenaEvidencePackageSchema.parse(fingerprintMismatchPackage), /fingerprint must equal/);
  assert.throws(() => AthenaEvidencePackageSchema.parse(missingSourceIdentityPackage), /String must contain at least 1 character/);
  assert.throws(() => AthenaEvidencePackageSchema.parse(invalidChronologyPackage), /Package chronology/);
  assert.throws(() => canonicalAthenaEvidenceJson({ value: Number.NaN }), /non-finite/);
});

test("package-wide evidence cutoff rejects sources and facts that were not yet available", () => {
  const futureSource = signed({
    sources: [{ ...validCompletePackage.sources[0], availableAt: "2026-07-15T20:07:00.000Z" }],
  });
  const futureFact = signed({
    sourceFacts: [{ ...validCompletePackage.sourceFacts[0], availableAt: "2026-07-15T20:07:00.000Z" }],
  });
  assert.throws(() => AthenaEvidencePackageSchema.parse(futureSource), /Source availableAt cannot follow/);
  assert.throws(() => AthenaEvidencePackageSchema.parse(futureFact), /Fact .* availableAt cannot follow/);
});

test("source retrieval provenance cannot occur after the package was retrieved", () => {
  const lateAttempt = signed({
    sources: [{
      ...validCompletePackage.sources[0],
      retrieval: {
        ...validCompletePackage.sources[0].retrieval,
        attemptedAt: "2026-07-15T20:13:00.000Z",
        completedAt: "2026-07-15T20:13:00.000Z",
      },
    }],
  });
  const lateCompletion = signed({
    sources: [{
      ...validCompletePackage.sources[0],
      retrieval: {
        ...validCompletePackage.sources[0].retrieval,
        completedAt: "2026-07-15T20:13:00.000Z",
      },
    }],
  });
  assert.throws(() => AthenaEvidencePackageSchema.parse(lateAttempt), /attemptedAt cannot follow/);
  assert.throws(() => AthenaEvidencePackageSchema.parse(lateCompletion), /completedAt cannot follow/);
});

test("every timestamped analytical record must exist by package generation time", () => {
  const fields = [
    "analyticalModules",
    "challenges",
    "risks",
    "catalysts",
    "forecasts",
    "killCriteriaInputs",
    "valuationAssumptions",
    "valuations",
  ];
  for (const field of fields) {
    const futureRecord = signed({
      [field]: [{ ...validCompletePackage[field][0], asOf: "2027-07-15T20:11:00.000Z" }],
    });
    assert.throws(
      () => AthenaEvidencePackageSchema.parse(futureRecord),
      new RegExp(`${field} asOf cannot follow package generatedAt`),
    );
  }
});

test("valuation ranges, distributions, and priors are explicit rather than inferred", () => {
  const reversedRange = signed({
    valuations: [{ ...validCompletePackage.valuations[0], range: { low: 221, high: 220 } }],
  });
  const unprovenancedDistribution = signed({
    valuations: [{ ...validCompletePackage.valuations[0], distribution: { ...validCompletePackage.valuations[0].distribution, priorProvenance: [] } }],
  });
  assert.throws(() => AthenaEvidencePackageSchema.parse(reversedRange), /Valuation range low/);
  assert.throws(() => AthenaEvidencePackageSchema.parse(unprovenancedDistribution), /Array must contain at least 1 element/);
});

test("the strict contract rejects every prohibited Portfolio Manager authority field", () => {
  for (const field of ["action", "approval", "sizing", "proposalDisposition", "order", "execution"]) {
    assert.throws(() => AthenaEvidencePackageSchema.parse({ ...validCompletePackage, [field]: "forbidden" }), /Unrecognized key/);
  }
});
