import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ResearchReplayConflictError,
  failResearchJobRun,
  finishResearchJobRun,
  readLatestPriorMandateScoreObservation,
  writeEvidenceSnapshot,
  writeResearchJobStart,
  writeMandateScoreObservations,
  writeResearchRun,
} from "../lib/pg/research-observations.js";

const NOW = "2026-07-13T20:00:00.000Z";

function observation(overrides = {}) {
  const metrics = [
    {
      metricId: "earnings_quality",
      value: 0.78,
      unit: "decimal_ratio",
      points: 40,
      maxPoints: 50,
      source: "sec_companyfacts",
      sourceDocumentId: "0000123456-26-000001",
      sourceFiledAt: "2026-07-01T12:00:00.000Z",
      sourceAsOf: "2026-06-30T00:00:00.000Z",
      retrievedAt: NOW,
      freshnessState: "fresh",
      peerCount: 12,
      calculationMethod: "peer_percentile_band",
      thesisCritical: true,
      missingReason: null,
    },
    {
      metricId: "growth",
      value: 0.35,
      unit: "decimal_ratio",
      points: 38,
      maxPoints: 50,
      source: "sec_companyfacts",
      sourceDocumentId: "0000123456-26-000001",
      sourceFiledAt: "2026-07-01T12:00:00.000Z",
      sourceAsOf: "2026-06-30T00:00:00.000Z",
      retrievedAt: NOW,
      freshnessState: "fresh",
      peerCount: 12,
      calculationMethod: "peer_percentile_band",
      thesisCritical: false,
      missingReason: null,
    },
  ];
  return {
    id: "observation-1",
    runId: "run-1",
    observedAt: NOW,
    agentId: "agent-1",
    mandateId: "agent_one",
    mandateVersion: "3.0",
    mandateUniverseVersion: "eligible-us-operating-common-equities-v3",
    productionUniversePolicyVersion: "catalog-technology-subverticals-v1",
    scoringConfigVersion: "mandate-v3-scoring-1+sha256:abc",
    codeRevision: "6e0aa24",
    ticker: "NVDA",
    universeSnapshotId: "universe-1",
    eligible: true,
    eligibilityReasonCodes: [],
    score: 78,
    uncappedScore: 78,
    rawPoints: 78,
    maxAvailablePoints: 100,
    complete: true,
    actionable: true,
    coverageMask: ["earnings_quality", "growth"],
    missingMetrics: [],
    criticalMissingMetrics: [],
    fallbackMethod: "peer_relative",
    thinPeerSet: false,
    peerSetId: "peer-1",
    peerSetLevel: "industry",
    peerCount: 12,
    specialSectorKey: null,
    scoreCause: "filing",
    inputSnapshotId: "evidence-1",
    metrics,
    ...overrides,
  };
}

function observationClient() {
  const rows = new Map();
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql: String(sql), params });
      if (String(sql).includes("INSERT INTO mandate_score_observations")) {
        const key = `${params[1]}/${params[3]}/${params[10]}`;
        if (rows.has(key)) return { rowCount: 0, rows: [] };
        rows.set(key, { id: params[0], content_hash: params[33] });
        return { rowCount: 1, rows: [{ id: params[0], content_hash: params[33] }] };
      }
      if (String(sql).includes("FROM mandate_score_observations")) {
        const row = rows.get(`${params[0]}/${params[1]}/${params[2]}`);
        return { rowCount: row ? 1 : 0, rows: row ? [row] : [] };
      }
      throw new Error(`unexpected query: ${sql}`);
    },
  };
}

test("migration has all mandated observation indexes and runner guards application transactionally", () => {
  const migration = readFileSync(new URL("../db/migrations/0004_research_observations.sql", import.meta.url), "utf8");
  for (const expected of [
    /CREATE INDEX IF NOT EXISTS mandate_score_observations_agent_ticker_observed_at_idx\s+ON mandate_score_observations\(agent_id, ticker, observed_at DESC\)/,
    /CREATE INDEX IF NOT EXISTS mandate_score_observations_agent_score_idx\s+ON mandate_score_observations\(agent_id, score DESC\)/,
    /CREATE INDEX IF NOT EXISTS mandate_score_observations_score_cause_idx\s+ON mandate_score_observations\(score_cause\)/,
  ]) assert.match(migration, expected);

  const runner = readFileSync(new URL("../lib/pg/migrate.js", import.meta.url), "utf8");
  assert.match(runner, /CREATE TABLE IF NOT EXISTS _migrations/);
  assert.match(runner, /await client\.query\("BEGIN"\)/);
  assert.match(runner, /await client\.query\("COMMIT"\)/);
  assert.match(runner, /INSERT INTO _migrations/);
});

test("observation batch validates before issuing any write", async () => {
  const client = observationClient();
  await assert.rejects(
    writeMandateScoreObservations([observation(), observation({ rawPoints: 77 })], { client }),
    /rawPoints must equal/
  );
  assert.equal(client.calls.length, 0);
});

test("evidence snapshots reject non-ticker labels before issuing any write", async () => {
  let calls = 0;
  await assert.rejects(
    writeEvidenceSnapshot({ id: "evidence-1", ticker: "Last synced", observedAt: NOW, payload: {} }, {
      client: { async query() { calls += 1; } },
    }),
    /canonical ticker/
  );
  assert.equal(calls, 0);
});

test("observation replay is idempotent and divergent content hard-conflicts", async () => {
  const client = observationClient();
  const first = await writeMandateScoreObservations([observation()], { client });
  const replay = await writeMandateScoreObservations([observation()], { client });
  assert.equal(first[0].inserted, true);
  assert.equal(replay[0].inserted, false);

  await assert.rejects(
    writeMandateScoreObservations([observation({ score: 77, uncappedScore: 77, rawPoints: 77, metrics: [
      { ...observation().metrics[0], points: 39 }, observation().metrics[1],
    ] })], { client }),
    ResearchReplayConflictError
  );
});

test("latest-prior helper reads and validates the immutable Postgres payload", async () => {
  const prior = observation({ runId: "run-prior", id: "observation-prior", scoreCause: "initial" });
  const calls = [];
  const loaded = await readLatestPriorMandateScoreObservation({ agentId: "agent-1", ticker: "nvda" }, {
    client: {
      async query(sql, params) {
        calls.push({ sql: String(sql), params });
        return { rowCount: 1, rows: [{ payload: prior }] };
      },
    },
  });
  assert.notEqual(loaded, prior);
  assert.deepEqual(loaded, prior);
  assert.deepEqual(calls[0].params, ["agent-1", "NVDA"]);
  assert.match(calls[0].sql, /ORDER BY observed_at DESC, id DESC/);

  const absent = await readLatestPriorMandateScoreObservation({ agentId: "agent-1", ticker: "NVDA" }, {
    client: { async query() { return { rowCount: 0, rows: [] }; } },
  });
  assert.equal(absent, null);
});

test("writeResearchRun commits a complete research history as one transaction", async () => {
  const calls = [];
  const client = {
    async query(sql) {
      calls.push(String(sql));
      if (String(sql).trimStart().startsWith("UPDATE research_job_runs")) return { rowCount: 1, rows: [{ run_id: "run-1" }] };
      if (String(sql).startsWith("BEGIN") || String(sql).startsWith("COMMIT") || String(sql).startsWith("ROLLBACK")) return { rowCount: 0, rows: [] };
      if (String(sql).includes("INSERT INTO")) return { rowCount: 1, rows: [{ id: "inserted" }] };
      throw new Error(`unexpected query: ${sql}`);
    },
    release() { calls.push("RELEASE"); },
  };
  const pool = {
    connect: async () => client,
    async query(sql) {
      calls.push(`POOL ${String(sql)}`);
      if (String(sql).includes("INSERT INTO research_job_runs")) return { rowCount: 1, rows: [{ run_id: "run-1" }] };
      if (String(sql).trimStart().startsWith("UPDATE research_job_runs")) return { rowCount: 1, rows: [{ run_id: "run-1" }] };
      throw new Error(`unexpected pool query: ${sql}`);
    },
  };
  const result = await writeResearchRun({
    run: { runId: "run-1", startedAt: NOW, sourceRevision: "abc123" },
    universeSnapshot: {
      id: "universe-1", observedAt: NOW, sourceRevision: "abc123", catalogCount: 1,
      eligibleCount: 1, membership: ["NVDA"],
    },
    evidenceSnapshots: [{ id: "evidence-1", ticker: "NVDA", observedAt: NOW, payload: { revenue: 1 } }],
    observations: [observation()],
    summary: { completedAt: NOW, cohortCount: 1, scoredCount: 1, completeCount: 1, skippedCount: 0, errorCount: 0 },
  }, { pool });
  assert.deepEqual(result, { runId: "run-1", finished: true });
  assert.ok(calls[0].includes("INSERT INTO research_job_runs"));
  assert.ok(calls.some((sql) => sql.startsWith("BEGIN")));
  assert.ok(calls.some((sql) => sql.startsWith("COMMIT")));
  assert.ok(!calls.some((sql) => sql.startsWith("ROLLBACK")));
});

test("start and terminal replays require exact persisted semantic fields", async () => {
  const startRow = {
    run_id: "run-1", started_at: new Date(NOW), source_revision: "abc123",
    cohort_count: 1, scored_count: 0, complete_count: 0, skipped_count: 1,
    error_count: 0, coverage_summary: { fresh: 1 },
  };
  const startClient = {
    async query(sql) {
      if (String(sql).includes("INSERT INTO research_job_runs")) return { rowCount: 0, rows: [] };
      return { rowCount: 1, rows: [startRow] };
    },
  };
  const start = { runId: "run-1", startedAt: NOW, sourceRevision: "abc123", cohortCount: 1, skippedCount: 1, coverageSummary: { fresh: 1 } };
  assert.deepEqual(await writeResearchJobStart(start, { client: startClient }), { runId: "run-1", inserted: false });
  await assert.rejects(writeResearchJobStart({ ...start, cohortCount: 2 }, { client: startClient }), ResearchReplayConflictError);

  const terminal = {
    completedAt: NOW, cohortCount: 1, scoredCount: 1, completeCount: 1,
    skippedCount: 0, errorCount: 0, coverageSummary: { fresh: 1 }, detail: { version: 1 },
  };
  const finishClient = {
    async query(sql) {
      if (String(sql).trimStart().startsWith("UPDATE research_job_runs")) return { rowCount: 0, rows: [] };
      return { rowCount: 1, rows: [{ status: "completed", completed_at: new Date(NOW), cohort_count: 1, scored_count: 1, complete_count: 1, skipped_count: 0, error_count: 0, coverage_summary: { fresh: 1 }, summary: { version: 1 } }] };
    },
  };
  assert.deepEqual(await finishResearchJobRun("run-1", terminal, { client: finishClient }), { runId: "run-1", finished: false });
  await assert.rejects(finishResearchJobRun("run-1", { ...terminal, errorCount: 1 }, { client: finishClient }), ResearchReplayConflictError);

  const failedClient = {
    async query(sql) {
      if (String(sql).trimStart().startsWith("UPDATE research_job_runs")) return { rowCount: 0, rows: [] };
      return { rowCount: 1, rows: [{ status: "failed", completed_at: new Date(NOW), error_summary: { stage: "write" } }] };
    },
  };
  assert.deepEqual(await failResearchJobRun("run-1", { failedAt: NOW, detail: { stage: "write" } }, { client: failedClient }), { runId: "run-1", failed: false });
  await assert.rejects(failResearchJobRun("run-1", { failedAt: NOW, detail: { stage: "other" } }, { client: failedClient }), ResearchReplayConflictError);
});

test("writeResearchRun rolls back data, records failure, and never completes after a write error", async () => {
  const calls = [];
  let status = "absent";
  const client = {
    async query(sql) {
      const text = String(sql);
      calls.push(text);
      if (text.startsWith("BEGIN") || text.startsWith("ROLLBACK")) return { rowCount: 0, rows: [] };
      if (text.includes("INSERT INTO universe_snapshots")) return { rowCount: 1, rows: [{ id: "universe-1" }] };
      if (text.includes("INSERT INTO evidence_snapshots")) throw new Error("evidence insert failed");
      throw new Error(`unexpected transaction query: ${sql}`);
    },
    release() { calls.push("RELEASE"); },
  };
  const pool = {
    connect: async () => client,
    async query(sql) {
      const text = String(sql);
      calls.push(`POOL ${text}`);
      if (text.includes("INSERT INTO research_job_runs")) {
        status = "running";
        return { rowCount: 1, rows: [{ run_id: "run-1" }] };
      }
      if (text.trimStart().startsWith("UPDATE research_job_runs") && text.includes("status = 'failed'")) {
        assert.equal(status, "running");
        status = "failed";
        return { rowCount: 1, rows: [{ run_id: "run-1" }] };
      }
      throw new Error(`unexpected pool query: ${sql}`);
    },
  };
  await assert.rejects(writeResearchRun({
    run: { runId: "run-1", startedAt: NOW, sourceRevision: "abc123" },
    universeSnapshot: { id: "universe-1", observedAt: NOW, sourceRevision: "abc123", catalogCount: 1, eligibleCount: 1, membership: ["NVDA"] },
    evidenceSnapshots: [{ id: "evidence-1", ticker: "NVDA", observedAt: NOW, payload: { revenue: 1 } }],
    observations: [],
    summary: { completedAt: NOW, cohortCount: 1, scoredCount: 0, completeCount: 0, skippedCount: 1, errorCount: 1 },
  }, { pool }), /evidence insert failed/);
  assert.equal(status, "failed");
  assert.ok(calls.some((sql) => sql.startsWith("ROLLBACK")));
  assert.ok(!calls.some((sql) => sql.startsWith("COMMIT")));
  assert.ok(!calls.some((sql) => sql.includes("status = 'completed'")));
});
