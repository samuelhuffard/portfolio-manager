import test from "node:test";
import assert from "node:assert/strict";
import { runResearchDataRefresh } from "../jobs/research-data-refresh.js";

const enabledEnv = {
  PEER_METRICS_ENABLED: "1",
  PEER_METRICS_EDGAR: "1",
  RESEARCH_CODE_REVISION: "9d44eaf1d31a4bda8ece57ccadbd5eea",
};

function fakeRedis() {
  const values = new Map();
  return {
    values,
    async set(key, value) { values.set(key, value); return "OK"; },
    async eval() { return 1; },
  };
}

function unlocked(_name, fn) {
  return fn();
}

test("research-data refresh runs the guarded stages in order with one run ID and aggregate final status", async () => {
  const events = [];
  const statuses = [];
  const result = await runResearchDataRefresh({
    env: enabledEnv,
    redis: fakeRedis(),
    pool: {},
    createRunId: () => "run-123",
    now: (() => { let n = 0; return () => new Date(`2026-07-13T00:0${n++}:00.000Z`); })(),
    withLock: unlocked,
    writeStatus: async (status) => statuses.push({ ...status }),
    refreshUniverse: async ({ runId, strictPeerMetrics }) => { events.push(`universe:${runId}:${strictPeerMetrics}`); return { cataloged: 100, sectorEnriched: 80 }; },
    buildPeerDistributions: async ({ runId }) => { events.push(`peers:${runId}`); return { built: true, names: 80 }; },
    scoreMandates: async ({ runId, startedAt, codeRevision, pool }) => {
      events.push(`scores:${runId}:${startedAt}:${codeRevision}:${Boolean(pool)}`);
      return { scored: true, agents: { "agent-1": { scored: 75, complete: 50, skipped: 5 } } };
    },
  });

  assert.deepEqual(events, ["universe:run-123:true", "peers:run-123", "scores:run-123:2026-07-13T00:00:00.000Z:9d44eaf1d31a4bda8ece57ccadbd5eea:true"]);
  assert.equal(statuses.length, 2);
  assert.equal(statuses[0].state, "running");
  assert.equal(statuses.at(-1).state, "completed");
  assert.equal(statuses.at(-1).runId, "run-123");
  assert.equal(statuses.at(-1).partial, 25);
  assert.equal(statuses.at(-1).unsupported, 5);
  assert.equal(statuses.filter((status) => status.state === "completed").length, 1);
  assert.equal(statuses.at(-1).classified, 80);
  assert.equal(result.state, "completed");
});

test("research-data refresh aborts downstream stages and records the failing stage", async () => {
  const statuses = [];
  let peersCalled = false;
  let scoresCalled = false;
  await assert.rejects(
    runResearchDataRefresh({
      env: enabledEnv,
      redis: fakeRedis(),
      pool: {},
      createRunId: () => "run-fail",
      withLock: unlocked,
      writeStatus: async (status) => statuses.push({ ...status }),
      refreshUniverse: async () => { throw new Error("listing unavailable"); },
      buildPeerDistributions: async () => { peersCalled = true; },
      scoreMandates: async () => { scoresCalled = true; },
    }),
    /listing unavailable/
  );
  assert.equal(peersCalled, false);
  assert.equal(scoresCalled, false);
  assert.equal(statuses.at(-1).state, "failed");
  assert.equal(statuses.at(-1).failureStage, "universe");
  assert.equal(statuses.length, 2);
  assert.equal(statuses.filter((status) => status.state === "failed").length, 1);
});

test("research-data refresh alerts once only for an orchestrated mandate-scoring failure", async () => {
  const statuses = [];
  const alerts = [];
  await assert.rejects(
    runResearchDataRefresh({
      env: enabledEnv,
      redis: fakeRedis(),
      pool: {},
      withLock: unlocked,
      writeStatus: async (status) => statuses.push({ ...status }),
      refreshUniverse: async () => ({ cataloged: 10 }),
      buildPeerDistributions: async () => ({ built: true, names: 9 }),
      scoreMandates: async () => { throw new Error("scoring unavailable"); },
      alert: async (message) => alerts.push(message),
    }),
    /scoring unavailable/
  );
  assert.equal(statuses.at(-1).failureStage, "mandate-scoring");
  assert.equal(alerts.length, 1);
  assert.match(alerts[0], /mandate scoring/);
});

test("event and selection failures stop the workflow at their distinct stages", async () => {
  const eventStatuses = []; let selected = false;
  await assert.rejects(runResearchDataRefresh({
    env: enabledEnv, redis: fakeRedis(), pool: {}, withLock: unlocked,
    writeStatus: async (status) => eventStatuses.push({ ...status }),
    refreshUniverse: async () => ({ cataloged: 2, sectorEnriched: 2 }), buildPeerDistributions: async () => ({ built: true, names: 2 }),
    scoreMandates: async () => ({ scored: true, agents: { "agent-1": { scored: 1, complete: 0, skipped: 0 } }, observations: [], events: [] }),
    writeEvents: async () => { throw new Error("events unavailable"); }, selectShadowSlate: async () => { selected = true; },
  }), /events unavailable/);
  assert.equal(eventStatuses.at(-1).failureStage, "research-events");
  assert.equal(selected, false);

  const selectionStatuses = [];
  await assert.rejects(runResearchDataRefresh({
    env: enabledEnv, redis: fakeRedis(), pool: {}, withLock: unlocked,
    writeStatus: async (status) => selectionStatuses.push({ ...status }),
    refreshUniverse: async () => ({ cataloged: 2, sectorEnriched: 2 }), buildPeerDistributions: async () => ({ built: true, names: 2 }),
    scoreMandates: async () => ({ scored: true, agents: { "agent-1": { scored: 1, complete: 0, skipped: 0 } }, observations: [], events: [] }),
    writeEvents: async () => {}, selectShadowSlate: async () => { throw new Error("selection unavailable"); },
  }), /selection unavailable/);
  assert.equal(selectionStatuses.at(-1).failureStage, "shadow-selection");
});

test("one workflow run ID binds scored observations, recorded events, and shadow selection", async () => {
  const ids = [];
  const observation = { id: "observation-run-bound", runId: "run-bound", ticker: "AAA", agentId: "agent-1" };
  const event = { id: "event-run-bound", currentObservationId: observation.id, ticker: "AAA", agentId: "agent-1", researchEligible: false };
  const result = await runResearchDataRefresh({
    env: enabledEnv, redis: fakeRedis(), pool: {}, withLock: unlocked, createRunId: () => "run-bound",
    refreshUniverse: async () => ({ cataloged: 2, sectorEnriched: 2 }), buildPeerDistributions: async () => ({ built: true, names: 2 }),
    scoreMandates: async () => ({ scored: true, agents: { "agent-1": { scored: 1, complete: 0, skipped: 0 } }, observations: [observation], events: [event] }),
    writeEvents: async (events) => { ids.push(events[0].currentObservationId); },
    selectShadowSlate: async ({ runId, observations, events }) => {
      ids.push(runId, observations[0].runId, events[0].id);
      return { selectionRunId: "selection-run-bound", mode: "shadow", policyVersion: "research-selection-v1", policyUnresolved: true, candidateCount: 1, selectedCount: 0, displacedCount: 0, overlapCount: 0, reasonCodeCounts: {} };
    },
  });
  assert.deepEqual(ids, ["observation-run-bound", "run-bound", "run-bound", "event-run-bound"]);
  assert.equal(result.selectionMode, "shadow");
});

test("research-data refresh refuses empty peer or scoring results instead of completing with zeros", async () => {
  const peerStatuses = [];
  let scoringCalled = false;
  await assert.rejects(runResearchDataRefresh({
    env: enabledEnv, redis: fakeRedis(), pool: {}, withLock: unlocked,
    writeStatus: async (status) => peerStatuses.push({ ...status }),
    refreshUniverse: async () => ({ cataloged: 10, sectorEnriched: 9 }),
    buildPeerDistributions: async () => ({ built: false, industries: 0, names: 0 }),
    scoreMandates: async () => { scoringCalled = true; return { scored: false }; },
    alert: async () => {},
  }), /Peer distributions were not built/);
  assert.equal(scoringCalled, false);
  assert.equal(peerStatuses.at(-1).failureStage, "peer-distributions");
  assert.equal(peerStatuses.length, 2);
  assert.equal(peerStatuses.filter((status) => status.state === "failed").length, 1);

  const scoreStatuses = [];
  await assert.rejects(runResearchDataRefresh({
    env: enabledEnv, redis: fakeRedis(), pool: {}, withLock: unlocked,
    writeStatus: async (status) => scoreStatuses.push({ ...status }),
    refreshUniverse: async () => ({ cataloged: 10, sectorEnriched: 9 }),
    buildPeerDistributions: async () => ({ built: true, names: 9 }),
    scoreMandates: async () => ({ scored: false, agents: {} }),
    alert: async () => {},
  }), /Mandate scoring did not produce/);
  assert.equal(scoreStatuses.at(-1).failureStage, "mandate-scoring");
  assert.equal(scoreStatuses.length, 2);
  assert.equal(scoreStatuses.filter((status) => status.state === "failed").length, 1);
});

test("research-data refresh stays disabled without prerequisites and treats overlap as skipped", async () => {
  let called = false;
  const disabled = await runResearchDataRefresh({
    env: {}, redis: null,
    refreshUniverse: async () => { called = true; },
  });
  assert.deepEqual(disabled, { state: "disabled", reason: "redis_not_configured" });
  assert.equal(called, false);

  const lockedStatuses = [];
  const skipped = await runResearchDataRefresh({
    env: enabledEnv,
    redis: fakeRedis(),
    pool: {},
    withLock: async () => { const error = new Error("locked"); error.code = "WORKFLOW_LOCKED"; throw error; },
    writeStatus: async (status) => lockedStatuses.push(status),
  });
  assert.deepEqual(skipped, { state: "skipped", reason: "locked" });
  assert.notEqual(skipped.state, "completed");
  assert.equal(lockedStatuses.length, 0);
});

test("research-data refresh preserves a missing shadow baseline as not configured", async () => {
  const statuses = [];
  const result = await runResearchDataRefresh({
    env: enabledEnv,
    redis: {},
    pool: {},
    codeRevision: "abc123",
    durableStoreConfigured: () => true,
    createRunId: () => "run-no-baseline",
    now: () => new Date("2026-07-13T20:00:00.000Z"),
    withLock: async (_name, work) => work(),
    refreshUniverse: async () => ({ cataloged: 10, sectorEnriched: 8 }),
    buildPeerDistributions: async () => ({ built: true, names: 8 }),
    scoreMandates: async () => ({ scored: true, agents: {}, observations: [], events: [] }),
    writeEvents: async () => {},
    selectShadowSlate: async () => ({ state: "not_configured", reason: "baseline_unavailable", failureStage: "baseline" }),
    writeStatus: async (status) => { statuses.push(structuredClone(status)); },
  });
  assert.equal(result.state, "not_configured");
  assert.equal(result.reason, "baseline_unavailable");
  assert.equal(result.failureStage, "baseline");
  assert.equal(statuses.at(-1).state, "not_configured");
  assert.equal(statuses.at(-1).selectionSelectedCount, null);
});

test("research-data refresh is not configured without durable storage or an explicit deployed revision", async () => {
  let stagesCalled = 0;
  const noStore = await runResearchDataRefresh({
    env: enabledEnv,
    redis: fakeRedis(),
    durableStoreConfigured: () => false,
    refreshUniverse: async () => { stagesCalled++; },
  });
  assert.deepEqual(noStore, { state: "not_configured", reason: "durable_research_store_not_configured" });
  assert.equal(stagesCalled, 0);

  const noRevision = await runResearchDataRefresh({
    env: { PEER_METRICS_ENABLED: "1", PEER_METRICS_EDGAR: "1" },
    redis: fakeRedis(),
    pool: {},
    refreshUniverse: async () => { stagesCalled++; },
  });
  assert.deepEqual(noRevision, { state: "not_configured", reason: "code_revision_not_configured" });
  assert.equal(stagesCalled, 0);
});

test("final status publication failure is labeled separately from durable mandate scoring", async () => {
  const statuses = [];
  const alerts = [];
  await assert.rejects(
    runResearchDataRefresh({
      env: enabledEnv,
      redis: fakeRedis(),
      pool: {},
      withLock: unlocked,
      writeStatus: async (status) => {
        if (status.state === "completed") throw new Error("status store unavailable");
        statuses.push({ ...status });
      },
      refreshUniverse: async () => ({ cataloged: 10, sectorEnriched: 9 }),
      buildPeerDistributions: async () => ({ built: true, names: 9 }),
      scoreMandates: async () => ({ scored: true, agents: { "agent-1": { scored: 2, complete: 0, skipped: 0 } } }),
      alert: async (message) => alerts.push(message),
    }),
    /status store unavailable/,
  );
  assert.equal(statuses.at(-1).state, "failed");
  assert.equal(statuses.at(-1).failureStage, "status-publish");
  assert.equal(alerts.length, 0);
});
