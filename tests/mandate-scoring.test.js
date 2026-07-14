import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { diagnosticMandateScoringRunId, runMandateScoring } from "../jobs/mandate-scoring.js";

const ENV = {
  PEER_METRICS_ENABLED: "1",
  PEER_METRICS_EDGAR: "1",
  RESEARCH_CODE_REVISION: "9d44eaf1d31a4bda8ece57ccadbd5eea",
};
const RETRIEVED_AT = "2026-07-13T19:00:00.000Z";

function catalog() {
  return {
    AAA: {
      t: "AAA",
      n: "Alpha Software",
      ea: "2026-07-13",
      v: "Software/SaaS",
      s: "Technology",
      i: "Software - Application",
      mc: 2_000_000_000,
      advd: 15_000_000,
    },
  };
}

function metrics() {
  return {
    AAA: {
      retrievedAt: RETRIEVED_AT,
      src: "edgar+yfinance",
      metrics: { revGrowth: 0.22, epsTrajectory: 0.25, marginTrend: 0.025, peerValuation: 14 },
      derived: { revYoY: 0.22, revAccel: 0.06, epsYoY: 0.25, epsAccel: 0.04, grossMarginTrendYoY: 0.025, _asOf: "2026-03-31" },
    },
  };
}

function options(overrides = {}) {
  return {
    env: ENV,
    redis: {},
    pool: {},
    durableStoreConfigured: () => true,
    runId: "workflow-run-1",
    now: () => new Date("2026-07-13T20:00:00.000Z"),
    getCatalog: async () => catalog(),
    getMetrics: async () => metrics(),
    readPrior: async () => null,
    universeLimits: { allowedSubVerticals: ["Software/SaaS"], microCapMinAvgDollarVolume: 3_000_000 },
    ...overrides,
  };
}

test("one workflow runId reaches durable observations before the Redis latest view", async () => {
  const events = [];
  const result = await runMandateScoring(options({
    startedAt: "2026-07-13T18:00:00.000Z",
    writeResearch: async (payload) => {
      events.push("durable");
      assert.equal(payload.run.runId, "workflow-run-1");
      assert.equal(payload.run.startedAt, "2026-07-13T18:00:00.000Z");
      assert.equal(payload.observations.length, 1);
      assert.equal(payload.observations[0].runId, "workflow-run-1");
      assert.equal(payload.observations[0].scoreCause, "initial");
      assert.equal(payload.evidenceSnapshots.length, 1);
      assert.equal(payload.summary.detail.productionUniversePolicyVersion, "catalog-technology-subverticals-v1");
    },
    writeLatestView: async (_agentId, payload) => {
      events.push("cache");
      assert.equal(payload.runId, "workflow-run-1");
    },
  }));
  assert.deepEqual(events, ["durable", "cache"]);
  assert.equal(result.state, "completed");
  assert.equal(result.runId, "workflow-run-1");
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].primaryCause, "initial");
  assert.equal(result.events[0].material, null);
  assert.equal(result.events[0].researchEligible, false);
});

test("durable write failure aborts scoring before any Redis cache write", async () => {
  let cacheWrites = 0;
  await assert.rejects(
    runMandateScoring(options({
      writeResearch: async () => { throw new Error("durable write unavailable"); },
      writeLatestView: async () => { cacheWrites++; },
    })),
    /durable write unavailable/,
  );
  assert.equal(cacheWrites, 0);
});

test("missing durable storage or code revision is never reported completed", async () => {
  const noStore = await runMandateScoring(options({
    pool: undefined,
    durableStoreConfigured: () => false,
  }));
  assert.deepEqual(noStore, { scored: false, state: "not_configured", reason: "durable_research_store_not_configured", agents: {} });

  const noRevision = await runMandateScoring(options({
    env: { PEER_METRICS_ENABLED: "1", PEER_METRICS_EDGAR: "1" },
  }));
  assert.deepEqual(noRevision, { scored: false, state: "not_configured", reason: "code_revision_not_configured", agents: {} });
});

test("only the direct diagnostic boundary may create a mandate-scoring run ID", () => {
  assert.equal(diagnosticMandateScoringRunId({ env: { RESEARCH_RUN_ID: "diagnostic-run" }, createRunId: () => "generated" }), "diagnostic-run");
  assert.equal(diagnosticMandateScoringRunId({ env: {}, createRunId: () => "generated" }), "generated");
});

test("orchestrated mandate scoring still requires its caller-provided run ID", async () => {
  await assert.rejects(runMandateScoring(options({ runId: undefined })), /requires the workflow runId/);
});

test("a prior immutable observation is classified without inventing Q-005 materiality", async () => {
  let prior = null;
  const first = await runMandateScoring(options({
    writeResearch: async (payload) => { prior = payload.observations[0]; },
    writeLatestView: async () => {},
  }));
  assert.equal(first.state, "completed");
  const second = await runMandateScoring(options({
    runId: "workflow-run-2",
    now: () => new Date("2026-07-13T20:30:00.000Z"),
    readPrior: async () => prior,
    writeResearch: async (payload) => {
      // New immutable snapshot IDs make this a version-series boundary under
      // the existing classifier; no material event is created or implied.
      assert.equal(payload.observations[0].scoreCause, "version");
      assert.equal(payload.observations[0].actionable, false);
    },
    writeLatestView: async () => {},
  }));
  assert.equal(second.state, "completed");
});

test("mandate scoring has no proposal or money-path imports", () => {
  const source = readFileSync(new URL("../jobs/mandate-scoring.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /from\s+["'][^"']*(?:proposal|ledger|broker|execution)[^"']*["']/);
});
