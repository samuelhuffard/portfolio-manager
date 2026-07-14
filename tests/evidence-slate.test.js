import { test } from "node:test";
import assert from "node:assert/strict";
import { selectEvidenceSlate } from "../lib/evidence-slate.js";

const NOW = new Date("2026-07-13T20:00:00.000Z");
const AGE = { version: "event-age-v1", maxAgeDays: 7 };
const COOLDOWN = { version: "cooldown-v1", maxAgeDays: 14 };
const base = (ticker, overrides = {}) => ({ ticker, agentId: "agent-1", ...overrides });

test("protected holdings and mandatory re-underwrites are selected beyond nominal budget", () => {
  const result = selectEvidenceSlate({
    agentId: "agent-1",
    holdings: [base("HOLD1"), base("HOLD2")],
    mandatoryReunderwrites: [base("REVIEW1")],
    budget: 1,
    stableCandidates: [base("STABLE", { score: 95 })],
    cooldownPolicy: COOLDOWN,
    now: NOW,
  });
  assert.deepEqual(result.items.map((item) => item.ticker), ["HOLD1", "HOLD2", "REVIEW1", "STABLE"]);
  assert.ok(result.items.slice(0, 3).every((item) => item.budgetExempt));
  assert.equal(result.items.at(-1).budgetExempt, false);
});

test("duplicate ticker merges lineage at the highest priority without duplicate output", () => {
  const result = selectEvidenceSlate({
    agentId: "agent-1",
    budget: 2,
    eventAgePolicy: AGE,
    events: [base("DUP", { id: "event-1", currentObservationId: "obs-1", primaryCause: "filing", allCauses: ["filing"], researchEligible: true, createdAt: "2026-07-12T20:00:00.000Z", reasonCodes: ["material_filing"] })],
    scoreChanges: [base("DUP", { currentObservationId: "obs-2", primaryCause: "market", allCauses: ["market"], researchEligible: true, triggeringEventId: "event-2", reasonCodes: ["score_changed"] })],
    stableCandidates: [base("DUP", { score: 99 })],
    cooldownPolicy: COOLDOWN,
    now: NOW,
  });
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].bucket, "material_event");
  assert.deepEqual(result.items[0].reasonCodes, [
    "high_stable_score",
    "material_filing",
    "material_thesis_breaking_event",
    "score_changed",
    "validated_economic_score_change",
  ]);
  assert.equal(result.items[0].triggeringEventId, "event-1");
  assert.equal(result.items[0].triggeringObservationId, "obs-1");
});

test("event eligibility, stale age, and missing age policy fail closed", () => {
  const events = [
    base("FRESH", { id: "e1", currentObservationId: "o1", primaryCause: "filing", allCauses: ["filing"], researchEligible: true, createdAt: "2026-07-12T20:00:00.000Z" }),
    base("STALE", { id: "e2", currentObservationId: "o2", primaryCause: "filing", allCauses: ["filing"], researchEligible: true, createdAt: "2026-06-01T20:00:00.000Z" }),
    base("COVERAGE", { id: "e3", currentObservationId: "o3", primaryCause: "coverage", allCauses: ["coverage"], researchEligible: true, createdAt: "2026-07-12T20:00:00.000Z" }),
  ];
  const result = selectEvidenceSlate({ agentId: "agent-1", events, eventAgePolicy: AGE, budget: 3, now: NOW });
  assert.deepEqual(result.items.map((item) => item.ticker), ["FRESH"]);
  assert.equal(result.skipped.staleEvents, 1);
  assert.equal(result.skipped.ineligibleEvents, 1);
  const missing = selectEvidenceSlate({ agentId: "agent-1", events, budget: 3, now: NOW });
  assert.equal(missing.items.length, 0);
  assert.deepEqual(missing.skipped.missingPolicies, ["eventAgePolicy"]);
});

test("concentration cap applies only to replaceable slots and exploration is reserved", () => {
  const result = selectEvidenceSlate({
    agentId: "agent-1",
    holdings: [base("HELD", { sector: "Technology" })],
    budget: 3,
    maxSectorShare: 0.5,
    explorationSlots: 1,
    stableCandidates: [
      base("TECH1", { score: 100, sector: "Technology" }),
      base("TECH2", { score: 99, sector: "Technology" }),
      base("HEALTH", { score: 80, sector: "Health Care" }),
    ],
    explorationCandidates: [base("EXPLORE", { sector: "Technology" })],
    cooldownPolicy: COOLDOWN,
    now: NOW,
  });
  assert.deepEqual(result.items.map((item) => item.ticker), ["HELD", "HEALTH", "EXPLORE"]);
});

test("exploration reservation cannot exceed the replaceable budget", () => {
  assert.throws(
    () => selectEvidenceSlate({ agentId: "agent-1", budget: 1, explorationSlots: 2 }),
    /explorationSlots cannot exceed the replaceable budget/
  );
});

test("reserved exploration obeys the supplied sector cap and remains deterministic", () => {
  const result = selectEvidenceSlate({
    agentId: "agent-1",
    budget: 4,
    explorationSlots: 3,
    maxSectorShare: 0.5,
    explorationCandidates: [
      base("EXP-C", { sector: "Technology" }),
      base("EXP-A", { sector: "Technology" }),
      base("EXP-B", { sector: "Technology" }),
    ],
    stableCandidates: [base("HEALTH", { score: 80, sector: "Health Care" })],
    cooldownPolicy: COOLDOWN,
    now: NOW,
  });
  assert.deepEqual(result.items.map((item) => item.ticker), ["HEALTH", "EXP-A", "EXP-B"]);
  assert.deepEqual(result.items.filter((item) => item.bucket === "exploration").map((item) => item.ticker), ["EXP-A", "EXP-B"]);
});

test("selector output contains no trade action or confidence fields and tie breaks deterministically", () => {
  const result = selectEvidenceSlate({
    agentId: "agent-1",
    budget: 2,
    stableCandidates: [base("ZZZ", { score: 90 }), base("AAA", { score: 90 })],
    cooldownPolicy: COOLDOWN,
    now: NOW,
  });
  assert.deepEqual(result.items.map((item) => item.ticker), ["AAA", "ZZZ"]);
  for (const item of result.items) {
    assert.equal(Object.hasOwn(item, "action"), false);
    assert.equal(Object.hasOwn(item, "confidence"), false);
    assert.deepEqual(Object.keys(item), ["ticker", "agentId", "bucket", "rank", "reasonCodes", "triggeringObservationId", "triggeringEventId", "displacedCandidate", "budgetExempt"]);
  }
});
