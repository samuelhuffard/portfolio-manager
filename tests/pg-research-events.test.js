import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyScoreDelta } from "../lib/score-delta.js";
import { ResearchReplayConflictError, ResearchStoreNotConfiguredError } from "../lib/pg/research-observations.js";
import { writeResearchEvents, writeResearchSelectionRun } from "../lib/pg/research-events.js";

const NOW = "2026-07-13T20:00:00.000Z";
const LATER = "2026-07-13T20:05:00.000Z";
const acceptPolicy = Object.freeze({ version: "materiality-v1", evaluate: () => true });

function metric(id, overrides = {}) {
  return {
    metricId: id, value: id === "growth" ? 0.4 : 0.8, unit: "decimal_ratio", points: 40, maxPoints: 50,
    source: "sec_companyfacts", sourceDocumentId: "filing-1", sourceFiledAt: "2026-07-01T12:00:00.000Z",
    sourceAsOf: "2026-06-30T00:00:00.000Z", retrievedAt: NOW, freshnessState: "fresh", peerCount: 12,
    calculationMethod: "peer_percentile_band", thesisCritical: true, missingReason: null, ...overrides,
  };
}

function observation(overrides = {}) {
  const metrics = overrides.metrics ?? [metric("growth"), metric("quality")];
  const rawPoints = metrics.reduce((total, item) => total + item.points, 0);
  const maxAvailablePoints = metrics.reduce((total, item) => total + item.maxPoints, 0);
  const score = rawPoints / maxAvailablePoints * 100;
  return {
    id: "observation-1", runId: "run-1", observedAt: NOW, agentId: "agent-1", mandateId: "agent_one",
    mandateVersion: "3.0", mandateUniverseVersion: "eligible-us-operating-common-equities-v3",
    productionUniversePolicyVersion: "catalog-technology-subverticals-v1", scoringConfigVersion: "score-v1",
    codeRevision: "abc123", ticker: "NVDA", universeSnapshotId: "universe-1", eligible: true,
    eligibilityReasonCodes: [], score, uncappedScore: score, rawPoints, maxAvailablePoints, complete: true,
    actionable: true, coverageMask: metrics.map((item) => item.metricId), missingMetrics: [], criticalMissingMetrics: [],
    fallbackMethod: "peer_relative", thinPeerSet: false, peerSetId: "peer-1", peerSetLevel: "industry", peerCount: 12,
    specialSectorKey: null, scoreCause: "filing", inputSnapshotId: "evidence-1", metrics, ...overrides,
  };
}

function observations() {
  const previous = observation();
  const current = observation({
    id: "observation-2", runId: "run-2", observedAt: LATER,
    metrics: [metric("growth", { value: 0.35, points: 36, sourceDocumentId: "filing-2", sourceFiledAt: "2026-07-12T12:00:00.000Z" }), metric("quality")],
  });
  const aapl = observation({ id: "observation-3", runId: "run-2", observedAt: LATER, ticker: "AAPL", scoreCause: "initial" });
  return { previous, current, aapl };
}

function event(overrides = {}) {
  const { previous, current } = observations();
  const delta = classifyScoreDelta({ previous, current, materialityPolicy: acceptPolicy });
  return {
    id: "event-2", previousObservationId: previous.id, currentObservationId: current.id, ticker: "NVDA", agentId: "agent-1",
    ...delta, materialityPolicyVersion: "materiality-v1", createdAt: LATER, ...overrides,
  };
}

function selectionRun(overrides = {}) {
  return {
    id: "selection-1", sourceRunId: "run-2", policyVersion: "research-selection-v1",
    selectionPolicy: { version: "research-selection-v1", explorationSlots: 3, maxSectorShare: 0.4 }, mode: "shadow",
    candidateCount: 5, selectedCount: 1, displacedCount: 1, createdAt: NOW, completedAt: LATER, ...overrides,
  };
}

function selectionItems(overrides = {}) {
  return [
    { id: "selection-item-1", ticker: "NVDA", agentId: "agent-1", selected: true, rank: 0, bucket: "economic_score_change", budgetExempt: false, protectedReason: null, reasonCodes: ["material_filing"], triggeringEventId: "event-2", triggeringObservationId: "observation-2", comparedTicker: "AAPL", displacedTicker: "AAPL", ...overrides },
    { id: "selection-item-2", ticker: "AAPL", agentId: "agent-1", selected: false, rank: 1, bucket: "current_rotation", budgetExempt: false, protectedReason: null, reasonCodes: ["displaced"], triggeringObservationId: "observation-3", triggeringEventId: null, comparedTicker: "NVDA", displacedTicker: null },
  ];
}

function fakePool({ eventRows = [], storedObservationTimes = {}, observationOverrides = {} } = {}) {
  const { previous, current, aapl } = observations();
  const observationsById = new Map([[previous.id, previous], [current.id, current], [aapl.id, aapl]].map(([id, value]) => [id, { ...value, ...(observationOverrides[id] ?? {}) }]));
  const events = new Map(eventRows.map((row) => [row.id, row]));
  const runs = new Map(); const items = new Map(); const calls = [];
  const client = {
    async query(sql, params = []) {
      const text = String(sql); calls.push({ text, params });
      if (["BEGIN", "COMMIT", "ROLLBACK"].includes(text)) return { rowCount: 0, rows: [] };
      if (text.includes("FROM research_job_runs")) return params[0] === "run-2" ? { rowCount: 1, rows: [{ run_id: "run-2" }] } : { rowCount: 0, rows: [] };
      if (text.includes("FROM mandate_score_observations")) {
        const payload = observationsById.get(params[0]);
        if (!payload) return { rowCount: 0, rows: [] };
        return { rowCount: 1, rows: [{ id: payload.id, ticker: payload.ticker, agent_id: payload.agentId, observed_at: storedObservationTimes[payload.id] ?? payload.observedAt, payload }] };
      }
      if (text.includes("INSERT INTO research_events")) {
        const [id, key, previousId, currentId, ticker, agentId] = params;
        if (events.has(id) || [...events.values()].some((row) => row.comparison_key === key)) return { rowCount: 0, rows: [] };
        events.set(id, { id, comparison_key: key, previous_observation_id: previousId, current_observation_id: currentId, ticker, agent_id: agentId, content_hash: params[19] });
        return { rowCount: 1, rows: [{ id }] };
      }
      if (text.includes("FROM research_events")) {
        const row = events.get(params[0]) ?? [...events.values()].find((item) => item.comparison_key === params[1]);
        return { rowCount: row ? 1 : 0, rows: row ? [row] : [] };
      }
      if (text.includes("INSERT INTO research_selection_runs")) {
        const [id] = params; if (runs.has(id)) return { rowCount: 0, rows: [] };
        runs.set(id, { id, content_hash: params[10] }); return { rowCount: 1, rows: [{ id }] };
      }
      if (text.includes("FROM research_selection_runs")) {
        const row = runs.get(params[0]); return { rowCount: row ? 1 : 0, rows: row ? [row] : [] };
      }
      if (text.includes("INSERT INTO research_selection_items")) {
        const [id, runId, ticker, agentId] = params;
        if (items.has(id) || [...items.values()].some((row) => row.runId === runId && row.ticker === ticker && row.agentId === agentId)) return { rowCount: 0, rows: [] };
        items.set(id, { id, runId, ticker, agentId, content_hash: params[15] }); return { rowCount: 1, rows: [{ id }] };
      }
      if (text.includes("FROM research_selection_items")) {
        const row = items.get(params[0]) ?? [...items.values()].find((item) => item.runId === params[1] && item.ticker === params[2] && item.agentId === params[3]);
        return { rowCount: row ? 1 : 0, rows: row ? [row] : [] };
      }
      throw new Error(`unexpected query: ${text}`);
    },
    release() { calls.push({ text: "RELEASE", params: [] }); },
  };
  return { calls, connect: async () => client };
}

test("migration and schema mirror capture policy-series events and reproducible selection lineage", () => {
  const migration = readFileSync(new URL("../db/migrations/0005_research_events.sql", import.meta.url), "utf8");
  const draft = readFileSync(new URL("../docs/db/schema-draft.sql", import.meta.url), "utf8");
  for (const source of [migration, draft]) {
    assert.match(source, /comparison_key TEXT NOT NULL UNIQUE/);
    assert.doesNotMatch(source, /current_observation_id TEXT NOT NULL UNIQUE/);
    assert.match(source, /source_run_id TEXT NOT NULL REFERENCES research_job_runs/);
    assert.match(source, /budget_exempt BOOLEAN NOT NULL/);
    assert.match(source, /UNIQUE \(selection_run_id, rank\)/);
    assert.match(source, /primary_cause = 'initial' AND material IS NULL AND materiality_policy_version IS NULL/);
    assert.match(source, /NOT budget_exempt OR \(selected AND bucket IN \('holding', 'mandatory_reunderwrite'\)/);
  }
});

test("events recompute exact E3.1 output from immutable observation payloads and permit policy re-evaluation", async () => {
  const pool = fakePool();
  const first = await writeResearchEvents([event()], { pool, materialityPolicy: acceptPolicy });
  const policyTwo = { version: "materiality-v2", evaluate: () => false };
  const second = await writeResearchEvents([event({ id: "event-policy-two", material: false, researchEligible: false, reasonCodes: [...classifyScoreDelta({ previous: observations().previous, current: observations().current, materialityPolicy: policyTwo }).reasonCodes], materialityPolicyVersion: "materiality-v2" })], { pool, materialityPolicy: policyTwo });
  assert.equal(first[0].inserted, true); assert.equal(second[0].inserted, true);
  assert.ok(pool.calls.some((call) => call.text === "BEGIN"));
  assert.ok(pool.calls.some((call) => call.text === "COMMIT"));
  await assert.rejects(writeResearchEvents([event({ delta: 99 })], { pool, materialityPolicy: acceptPolicy }), /does not match classifyScoreDelta/);
  await assert.rejects(writeResearchEvents([event({ allCauses: ["market", "filing"] })], { pool, materialityPolicy: acceptPolicy }), /canonical E3.1 priority/);
});

test("event materiality states, timing, and reference invariants fail closed", async () => {
  const pool = fakePool(); const { previous, current } = observations();
  const structuralCurrent = { ...current, scoringConfigVersion: "score-v2", scoreCause: "version", actionable: false };
  const structural = classifyScoreDelta({ previous, current: structuralCurrent });
  const structuralEvent = { ...event(), id: "event-version", currentObservationId: structuralCurrent.id, primaryCause: structural.primaryCause, allCauses: structural.allCauses, delta: structural.delta, material: false, materialityPolicyVersion: null, researchEligible: false, reasonCodes: structural.reasonCodes, changedMetrics: structural.changedMetrics, coverageChanged: structural.coverageChanged, peerSetChanged: structural.peerSetChanged, versionChanged: structural.versionChanged };
  await assert.rejects(writeResearchEvents([event({ material: false, materialityPolicyVersion: null })], { pool }), /economic material=true\/false requires/);
  await assert.rejects(writeResearchEvents([event()], { pool }), /requires injected materiality policy materiality-v1/);
  await assert.rejects(writeResearchEvents([event({ previousObservationId: "observation-2" })], { pool, materialityPolicy: acceptPolicy }), /distinct previous\/current/);
  await assert.rejects(writeResearchEvents([event({ createdAt: NOW })], { pool, materialityPolicy: acceptPolicy }), />= current observation/);
  assert.equal(structural.material, false);
  assert.equal(structural.researchEligible, false);
  assert.equal(structuralEvent.materialityPolicyVersion, null);
  const structuralWrite = await writeResearchEvents([structuralEvent], { pool: fakePool({ observationOverrides: { "observation-2": structuralCurrent } }) });
  assert.equal(structuralWrite[0].inserted, true);
});

test("initial events preserve unknown materiality, and event provenance timestamps cannot precede or contradict observations", async () => {
  const pool = fakePool(); const current = observations().aapl;
  const initial = classifyScoreDelta({ current });
  const initialEvent = {
    id: "event-initial", previousObservationId: null, currentObservationId: current.id, ticker: "AAPL", agentId: "agent-1",
    ...initial, materialityPolicyVersion: null, createdAt: LATER,
  };
  const result = await writeResearchEvents([initialEvent], { pool });
  assert.equal(result[0].inserted, true);
  await assert.rejects(writeResearchEvents([{ ...initialEvent, id: "event-early", createdAt: NOW }], { pool: fakePool() }), />= current observation/);
  await assert.rejects(writeResearchEvents([event()], { pool: fakePool({ storedObservationTimes: { "observation-2": NOW } }), materialityPolicy: acceptPolicy }), /payload observedAt does not match/);
});

test("selection runs preserve source run/policy, canonical item order, pool counts, protected exceptions, and exact lineage", async () => {
  const pool = fakePool({ eventRows: [{ id: "event-2", ticker: "NVDA", agent_id: "agent-1", current_observation_id: "observation-2" }] });
  const result = await writeResearchSelectionRun({ run: selectionRun(), items: [...selectionItems()].reverse() }, { pool });
  assert.deepEqual(result.items.map((item) => item.id), ["selection-item-1", "selection-item-2"]);
  const replay = await writeResearchSelectionRun({ run: selectionRun(), items: selectionItems() }, { pool });
  assert.equal(replay.run.inserted, false);
  const protectedItem = { id: "protected", ticker: "NVDA", agentId: "agent-1", selected: true, rank: 0, bucket: "holding", budgetExempt: true, protectedReason: "holding_reunderwrite", reasonCodes: ["holding_reunderwrite"], triggeringObservationId: null, triggeringEventId: null, comparedTicker: null, displacedTicker: null };
  const protectedRun = selectionRun({ id: "selection-protected", candidateCount: 1, selectedCount: 1, displacedCount: 0 });
  await writeResearchSelectionRun({ run: protectedRun, items: [protectedItem] }, { pool });
  await assert.rejects(writeResearchSelectionRun({ run: selectionRun({ id: "bad-time", completedAt: "2026-07-13T19:00:00.000Z" }), items: selectionItems() }, { pool }), />= createdAt/);
  await assert.rejects(writeResearchSelectionRun({ run: selectionRun({ id: "bad-source", sourceRunId: "missing" }), items: selectionItems() }, { pool }), /source research run does not exist/);
  await assert.rejects(writeResearchSelectionRun({ run: selectionRun({ id: "bad-lineage" }), items: selectionItems({ triggeringObservationId: "observation-1" }) }, { pool }), /current observation must match/);
});

test("selection count and protected-lineage validation reject non-reproducible writes and configured-store absence remains loud", async () => {
  const pool = fakePool({ eventRows: [{ id: "event-2", ticker: "NVDA", agent_id: "agent-1", current_observation_id: "observation-2" }] });
  await assert.rejects(writeResearchSelectionRun({ run: selectionRun({ selectedCount: 2 }), items: selectionItems() }, { pool }), /selection counts/);
  await assert.rejects(writeResearchSelectionRun({ run: selectionRun({ candidateCount: 0 }), items: selectionItems() }, { pool }), /candidateCount/);
  await assert.rejects(writeResearchSelectionRun({ run: selectionRun(), items: selectionItems({ triggeringEventId: null, triggeringObservationId: null }) }, { pool }), /non-protected selected/);
  await assert.rejects(writeResearchSelectionRun({ run: selectionRun(), items: selectionItems({ selected: false, budgetExempt: true, protectedReason: "holding_reunderwrite", bucket: "holding", reasonCodes: ["holding_reunderwrite"], triggeringEventId: null, triggeringObservationId: null }) }, { pool }), /must be selected protected holdings/);
  await assert.rejects(writeResearchSelectionRun({ run: selectionRun(), items: [selectionItems()[0], { ...selectionItems()[1], rank: 0 }] }, { pool }), /duplicate deterministic identity/);
  await assert.rejects(writeResearchEvents([event()]), ResearchStoreNotConfiguredError);
});
