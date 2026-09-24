import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runShadowResearchSlate } from "../jobs/shadow-research-slate.js";
import { buildPrivateResearchSlateItems } from "../jobs/research-scan.js";
import { getPrivateResearchSlate, setPrivateResearchSlate, setResearchDataStatus, setShadowSelectionStatus } from "../lib/redis.js";

const NOW = "2026-07-13T20:00:00.000Z";
const CONFIG = { mode: "shadow", policyVersion: "research-selection-v1", canarySlots: 0, explorationSlots: 1, maxSectorShare: 1 };
const UNIVERSE = { aiReviewBudget: 3, researchCooldownDays: 14 };
const observation = (ticker, agentId = "agent-1") => ({
  id: `observation-${agentId}-${ticker}`, runId: "run-fixture", observedAt: NOW, agentId,
  mandateId: "agent_one", mandateVersion: "3.0", mandateUniverseVersion: "eligible-us-operating-common-equities-v3",
  productionUniversePolicyVersion: "catalog-technology-subverticals-v1", scoringConfigVersion: "fixture-score-v1",
  codeRevision: "fixture-revision", ticker, universeSnapshotId: "universe-fixture", eligible: true,
  eligibilityReasonCodes: [], score: 80, uncappedScore: 80, rawPoints: 80, maxAvailablePoints: 100,
  complete: true, actionable: true, coverageMask: ["earnings_quality", "growth"], missingMetrics: [],
  criticalMissingMetrics: [], fallbackMethod: "peer_relative", thinPeerSet: false, peerSetId: "peer-fixture",
  peerSetLevel: "industry", peerCount: 12, specialSectorKey: null, scoreCause: "filing",
  inputSnapshotId: "evidence-fixture", metrics: [
    { metricId: "earnings_quality", value: 0.8, unit: "decimal_ratio", points: 40, maxPoints: 50, source: "fixture", sourceDocumentId: "fixture-document", sourceFiledAt: NOW, sourceAsOf: NOW, retrievedAt: NOW, freshnessState: "fresh", peerCount: 12, calculationMethod: "fixture", thesisCritical: true, missingReason: null },
    { metricId: "growth", value: 0.8, unit: "decimal_ratio", points: 40, maxPoints: 50, source: "fixture", sourceDocumentId: "fixture-document", sourceFiledAt: NOW, sourceAsOf: NOW, retrievedAt: NOW, freshnessState: "fresh", peerCount: 12, calculationMethod: "fixture", thesisCritical: true, missingReason: null },
  ],
});
const BASELINE_PROVENANCE = { agentId: "agent-1", sourceRunId: "research-scan-1", capturedAt: NOW };

test("missing private baseline is explicit, status-only, and writes no empty selection", async () => {
  let selectionWrites = 0; let status = null;
  const result = await runShadowResearchSlate({
    runId: "run-1", config: CONFIG, universe: UNIVERSE, observations: [observation("AAA")],
    loadPrivateBaseline: async () => null, writeSelection: async () => { selectionWrites++; }, writeStatus: async (value) => { status = value; },
  });
  assert.deepEqual(result, { state: "not_configured", reason: "baseline_unavailable", runId: "run-1", failureStage: "baseline" });
  assert.equal(selectionWrites, 0);
  assert.deepEqual(status, result);
  assert.equal(Object.hasOwn(status, "liveSlate"), false);
});

test("private baseline drives a real advisory comparison while preserving the live slate", async () => {
  let persisted = null; let publicStatus = null;
  const baseline = { ...BASELINE_PROVENANCE, items: [
    { agentId: "agent-1", ticker: "HELD", bucket: "holdings" },
    { agentId: "agent-1", ticker: "OLD", bucket: "ranked" },
    { agentId: "agent-1", ticker: "EXP", bucket: "exploration" },
  ] };
  const result = await runShadowResearchSlate({
    runId: "run-2", config: CONFIG, universe: UNIVERSE,
    observations: [observation("HELD"), observation("OLD"), observation("EXP"), observation("NEW")],
    events: [{ id: "event-new", ticker: "NEW", agentId: "agent-1", currentObservationId: observation("NEW").id, primaryCause: "filing", allCauses: ["filing"], researchEligible: true, createdAt: NOW, reasonCodes: ["filing_change"] }],
    eventAgePolicy: { version: "synthetic-age-v1", maxAgeMs: 86_400_000 },
    loadPrivateBaseline: async () => baseline,
    writeSelection: async (value) => { persisted = value; }, writeStatus: async (value) => { publicStatus = value; },
  });
  assert.equal(result.mode, "shadow");
  assert.equal(result.policyUnresolved, false);
  assert.equal(result.liveSlate.length, 3);
  assert.equal(result.overlapCount, 2); // OLD/EXP overlap; protected HELD is excluded.
  assert.ok(persisted.items.some((item) => item.ticker === "HELD" && item.protectedReason === "holding"));
  assert.ok(persisted.items.some((item) => item.ticker === "NEW" && item.triggeringObservationId === observation("NEW").id));
  assert.equal(Object.hasOwn(publicStatus, "liveSlate"), false);
  assert.equal(result.candidateCount, 4);
  assert.equal(persisted.run.selectionPolicy.baselineSourceRunId, "research-scan-1");
  assert.equal(persisted.run.selectionPolicy.baselineCapturedAt, NOW);
  assert.equal(persisted.run.selectionPolicy.comparator.version, "shadow-slate-comparator-v1");
  assert.equal(persisted.run.selectionPolicy.comparator.overlap.nonHoldingCount, 2);
  assert.equal(JSON.stringify(persisted.run.selectionPolicy.comparator).includes("HELD"), false);
  assert.equal(JSON.stringify(persisted.run.selectionPolicy.comparator).includes("NEW"), false);
  assert.deepEqual(persisted.run.selectionPolicy.candidateDossierReadiness, {
    version: "actionable-candidate-dossier-shadow-v2",
    mode: "shadow_only",
    evaluatedCount: 3,
    readyForDeepResearchCount: 3,
    blockedCount: 0,
    invalidObservationCount: 0,
    observationsInputInvalid: false,
    assessmentUnavailableCount: 0,
    reasonCodeCounts: {},
  });
});

test("stable and exploration paths retain agent-scoped observation lineage and count rejected candidates", async () => {
  let persisted = null;
  const result = await runShadowResearchSlate({
    runId: "run-3", config: CONFIG, universe: UNIVERSE,
    baselineSlate: [{ agentId: "agent-1", ticker: "OLD", bucket: "ranked" }], baselineProvenance: BASELINE_PROVENANCE,
    holdings: [], stableCandidates: [
      { ticker: "GOOD", agentId: "agent-1", score: 90 },
      { ticker: "COOLDOWN", agentId: "agent-1", score: 99, lastResearchedAt: "2026-07-13T19:00:00.000Z" },
      { ticker: "WRONG_AGENT", agentId: "agent-2", score: 100 },
    ], explorationCandidates: [{ ticker: "EXP", agentId: "agent-1", explorationRank: 1 }],
    observations: [observation("GOOD"), observation("COOLDOWN"), observation("EXP"), observation("WRONG_AGENT", "agent-1")],
    writeSelection: async (value) => { persisted = value; }, writeStatus: async () => {},
  });
  assert.equal(result.policyUnresolved, true);
  assert.equal(result.candidateCount, 4); // cooldown and wrong-agent candidates remain counted in the considered pool.
  assert.ok(persisted.items.some((item) => item.ticker === "GOOD" && item.triggeringObservationId === observation("GOOD").id));
  assert.ok(persisted.items.some((item) => item.ticker === "EXP" && item.triggeringObservationId === observation("EXP").id));
  assert.equal(persisted.items.some((item) => item.ticker === "WRONG_AGENT" && item.selected), false);
  assert.ok(persisted.items.some((item) => item.ticker === "OLD" && !item.selected));
});

test("zero-slot canary is rollback-safe while live and positive canary fail closed", async () => {
  const base = { runId: "run-4", universe: UNIVERSE, baselineSlate: [{ ticker: "OLD", agentId: "agent-1", bucket: "ranked" }], baselineProvenance: BASELINE_PROVENANCE, observations: [observation("OLD")], writeSelection: async () => {}, writeStatus: async () => {} };
  const canary = await runShadowResearchSlate({ ...base, config: { ...CONFIG, mode: "canary" } });
  assert.deepEqual(canary.liveSlate.map((item) => item.ticker), ["OLD"]);
  await assert.rejects(runShadowResearchSlate({ ...base, config: { ...CONFIG, mode: "canary", canarySlots: 1 } }), /blocked pending promotion/);
  await assert.rejects(runShadowResearchSlate({ ...base, config: { ...CONFIG, mode: "live" } }), /blocked pending promotion/);
});

test("private baseline and aggregate status helpers cannot project tickers or arbitrary nested reason keys", async () => {
  const values = new Map();
  const redis = { async set(key, value) { values.set(key, value); }, async get(key) { return values.get(key) ?? null; } };
  await setPrivateResearchSlate("agent-1", [{ ticker: "NVDA", bucket: "ranked" }], { sourceRunId: "scan-private", redis, now: () => new Date(NOW) });
  const privateSlate = await getPrivateResearchSlate("agent-1", { redis });
  assert.equal(privateSlate.items[0].ticker, "NVDA");
  assert.equal(privateSlate.items[0].bucket, "ranked");
  assert.equal(privateSlate.sourceRunId, "scan-private");
  assert.equal(privateSlate.capturedAt, NOW);
  await setShadowSelectionStatus({ reasonCodeCounts: { filing_change: 2, NVDA: 99, rationale: 3, material_filing: -1 } }, { redis, now: () => new Date(NOW) });
  await setResearchDataStatus({ selectionReasonCodeCounts: { filing_change: 2, NVDA: 99, evidence_payload: 1 } }, { redis, now: () => new Date(NOW) });
  const payloads = [...values.entries()].filter(([key]) => key !== "pm:research-slate:private:agent-1").map(([, raw]) => JSON.parse(raw));
  assert.deepEqual(payloads.map((payload) => payload.reasonCodeCounts ?? payload.selectionReasonCodeCounts), [{ filing_change: 2 }, { filing_change: 2 }]);
  assert.equal(JSON.stringify(payloads).includes("NVDA"), false);
});

test("health never reads the private baseline, and the live scan never imports evidence selection", () => {
  const health = readFileSync(new URL("../server.js", import.meta.url), "utf8");
  const scan = readFileSync(new URL("../jobs/research-scan.js", import.meta.url), "utf8");
  assert.doesNotMatch(health, /getPrivateResearchSlate|pm:research-slate:private/);
  assert.doesNotMatch(scan, /shadow-research-slate|selectEvidenceSlate|research-selection\.json/);
  assert.match(scan, /buildPrivateResearchSlateItems\(peerScoredToReview, reviewBuckets\)/);
  assert.ok(scan.indexOf("await applyResearchRecords(agent.id, researchRecords)") < scan.indexOf("await setPrivateResearchSlate("));
  assert.doesNotMatch(scan.slice(0, scan.indexOf("const toReview = new Map()")), /setPrivateResearchSlate\(agent\.id/);
  assert.match(health, /researchStoreConfigured\(\)/);
  assert.match(health, /resolveResearchCodeRevision/);
});

test("private research baseline contains only peer-scored candidates actually reviewed", () => {
  const prePeerSelection = new Map([
    ["DEFERRED", { ticker: "DEFERRED" }],
    ["REVIEWED", { ticker: "REVIEWED" }],
  ]);
  const peerScoredSelection = new Map([["REVIEWED", { ticker: "REVIEWED" }]]);
  const buckets = new Map([["DEFERRED", "ranked"], ["REVIEWED", "exploration"]]);
  assert.deepEqual(buildPrivateResearchSlateItems(peerScoredSelection, buckets), [{ ticker: "REVIEWED", bucket: "exploration" }]);
  assert.notDeepEqual(buildPrivateResearchSlateItems(peerScoredSelection, buckets), [...prePeerSelection.keys()].map((ticker) => ({
    ticker,
    bucket: buckets.get(ticker),
  })));
  assert.throws(() => buildPrivateResearchSlateItems([], buckets), /must be Maps/);
});

test("peer-ready backfills retain valid private-slate provenance instead of an undefined original bucket", async () => {
  const reviewed = new Map([
    ["PRIORITY", { ticker: "PRIORITY" }],
    ["BACKFILL", { ticker: "BACKFILL" }],
  ]);
  const buckets = new Map([["PRIORITY", "ranked"]]);
  const items = buildPrivateResearchSlateItems(reviewed, buckets);
  assert.deepEqual(items, [
    { ticker: "PRIORITY", bucket: "ranked" },
    { ticker: "BACKFILL", bucket: "peer_ready_backfill" },
  ]);

  const values = new Map();
  const redis = { async set(key, value) { values.set(key, value); } };
  const persisted = await setPrivateResearchSlate("agent-1", items, {
    sourceRunId: "scan-backfill", redis, now: () => new Date(NOW),
  });
  assert.equal(persisted.items[1].bucket, "peer_ready_backfill");
});

test("stale, future, and incomplete baseline provenance fail closed without a durable selection", async () => {
  for (const [reason, baseline] of [
    ["baseline_stale", { ...BASELINE_PROVENANCE, capturedAt: "2026-07-11T00:00:00.000Z", items: [{ agentId: "agent-1", ticker: "OLD", bucket: "ranked" }] }],
    ["baseline_stale", { ...BASELINE_PROVENANCE, capturedAt: "2026-07-13T21:00:00.000Z", items: [{ agentId: "agent-1", ticker: "OLD", bucket: "ranked" }] }],
    ["baseline_provenance_invalid", { agentId: "agent-1", capturedAt: NOW, items: [{ agentId: "agent-1", ticker: "OLD", bucket: "ranked" }] }],
    ["baseline_provenance_invalid", { ...BASELINE_PROVENANCE, agentId: "agent-2", items: [{ agentId: "agent-1", ticker: "OLD", bucket: "ranked" }] }],
  ]) {
    let writes = 0;
    const result = await runShadowResearchSlate({
      runId: `run-${reason}-${writes}`, config: CONFIG, universe: UNIVERSE, observations: [observation("OLD")],
      loadPrivateBaseline: async () => baseline, writeSelection: async () => { writes++; }, writeStatus: async () => {},
    });
    assert.equal(result.state, "not_configured");
    assert.equal(result.reason, reason);
    assert.equal(writes, 0);
  }
});
