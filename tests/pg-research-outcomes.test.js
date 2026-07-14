import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyResearchOutcome } from "../lib/research-outcomes.js";
import { contentHash } from "../lib/research-version.js";
import { ResearchReplayConflictError, ResearchStoreNotConfiguredError } from "../lib/pg/research-observations.js";
import { outcomeRecordId, readLatestResearchOutcome, readMaturedResearchOutcomes, writeResearchOutcomes } from "../lib/pg/research-outcomes.js";

const NOW = "2026-07-20T00:00:00.000Z";
const ENTRY = "2026-07-01T14:30:00.000Z";
const EXIT = "2026-07-11T14:30:00.000Z";

function outcome(overrides = {}) {
  return classifyResearchOutcome({
    observationId: "observation-1", securityId: "NVDA", ticker: "NVDA", decisionAt: "2026-07-01T13:00:00.000Z", asOf: NOW,
    entry: { securityId: "NVDA", ticker: "NVDA", executableAt: ENTRY, price: 100 },
    exit: { securityId: "NVDA", ticker: "NVDA", completedAt: EXIT, price: 110 },
    benchmarkEntry: { securityId: "SPY", completedAt: ENTRY, price: 100 }, benchmarkExit: { securityId: "SPY", completedAt: EXIT, price: 105 },
    securityPath: [{ securityId: "NVDA", completedAt: ENTRY, price: 100 }, { securityId: "NVDA", completedAt: EXIT, price: 110 }],
    horizonPolicy: { version: "horizon-v1", horizonDays: 10, observationToleranceMs: 0 }, benchmarkPolicy: { version: "spy-v1", benchmarkSecurityId: "SPY", alignmentToleranceMs: 0 },
    hitPolicy: { version: "hit-v1", evaluate: () => true }, agentId: "agent-1", mandateVersion: "mandate-v1", scoringVersion: "score-v1", scoreCompleteness: "complete", deltaCause: "filing", evidenceClass: "shadow", ...overrides,
  });
}

function fakePool({ failInsert = false, missingObservationIds = [] } = {}) {
  const rows = new Map(); const calls = []; let inserts = 0;
  const client = { async query(sql, params = []) {
    const text = String(sql); calls.push({ text, params });
    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(text)) return { rowCount: 0, rows: [] };
    if (text.includes("FROM mandate_score_observations")) return missingObservationIds.includes(params[0]) ? { rowCount: 0, rows: [] } : { rowCount: 1, rows: [{ id: params[0], ticker: "NVDA", agent_id: "agent-1" }] };
    if (text.includes("FROM research_selection_items")) return { rowCount: 1, rows: [{ id: params[0], ticker: "NVDA", agent_id: "agent-1" }] };
    if (text.includes("INSERT INTO research_outcomes")) { inserts += 1; if (failInsert && inserts === 2) throw new Error("insert failed"); if (rows.has(params[0])) return { rowCount: 0, rows: [] }; rows.set(params[0], { id: params[0], content_hash: params[26] }); return { rowCount: 1, rows: [{ id: params[0] }] }; }
    if (text.includes("SELECT id, content_hash FROM research_outcomes")) { const row = rows.get(params[0]); return { rowCount: row ? 1 : 0, rows: row ? [row] : [] }; }
    if (text.includes("SELECT canonical_payload")) return { rowCount: 0, rows: [] };
    throw new Error(`unexpected query: ${text}`);
  }, release() { calls.push({ text: "RELEASE", params: [] }); } };
  return { calls, connect: async () => client };
}

test("0006 is additive, mirrored, and indexed without touching money tables", () => {
  const migration = readFileSync(new URL("../db/migrations/0006_research_outcomes.sql", import.meta.url), "utf8");
  const draft = readFileSync(new URL("../docs/db/schema-draft.sql", import.meta.url), "utf8");
  for (const source of [migration, draft]) {
    assert.match(source, /CREATE TABLE(?: IF NOT EXISTS)? research_outcomes/);
    assert.match(source, /observation_id TEXT REFERENCES mandate_score_observations/);
    assert.match(source, /selection_item_id TEXT REFERENCES research_selection_items/);
    assert.match(source, /observation_id IS NOT NULL OR selection_item_id IS NOT NULL/);
    assert.match(source, /jsonb_typeof\(metrics\) = 'object'/);
    assert.match(source, /canonical_payload->>'evidenceClass' = evidence_class/);
    assert.match(source, /canonical_payload \?& ARRAY\['evidenceClass'/);
    assert.match(source, /canonical_payload->>'status' = status/);
    assert.match(source, /research_outcomes_status_as_of_idx/);
    assert.match(source, /research_outcomes_policy_versions_idx/);
  }
  assert.doesNotMatch(migration, /ALTER TABLE (proposals|orders|fills|capital_entries|lots)/);
  const tableBody = (source) => source.match(/CREATE TABLE(?: IF NOT EXISTS)? research_outcomes \(([\s\S]*?)\n\);/)[1]
    .replace(/\s+/g, " ").replace(/\s*\(\s*/g, "(").replace(/\s*\)\s*/g, ")").trim();
  assert.equal(tableBody(migration), tableBody(draft));
});

test("evidence identity and stored metric shape fail closed", async () => {
  const pool = fakePool(); const good = outcome();
  await assert.rejects(writeResearchOutcomes([{ outcome: good, evidenceClass: "backtest" }], { pool, now: NOW }), /does not match canonical payload/);
  const scalarMetrics = { ...good, metrics: "bad", canonicalPayload: { ...good.canonicalPayload, metrics: "bad" } };
  scalarMetrics.outcomeHash = contentHash(scalarMetrics.canonicalPayload); scalarMetrics.hash = scalarMetrics.outcomeHash;
  await assert.rejects(writeResearchOutcomes([{ outcome: scalarMetrics }], { pool, now: NOW }), /metrics must be an object/);
  const live = outcome({ evidenceClass: "realized_live" });
  assert.notEqual(outcomeRecordId(good), outcomeRecordId(live));
  const lower = outcome({ securityId: "nvda", ticker: "nvda", entry: { securityId: "nvda", ticker: "nvda", executableAt: ENTRY, price: 100 },
    exit: { securityId: "nvda", ticker: "nvda", completedAt: EXIT, price: 110 } });
  assert.equal(outcomeRecordId(good), outcomeRecordId(lower));
});

test("deterministic identity appends immature then matured and exact replay is idempotent", async () => {
  const immature = outcome({ asOf: "2026-07-05T00:00:00.000Z", exit: null, benchmarkEntry: null, benchmarkExit: null, securityPath: [] });
  const matured = outcome(); const pool = fakePool();
  assert.notEqual(outcomeRecordId(immature), outcomeRecordId(matured));
  const first = await writeResearchOutcomes([{ outcome: immature }, { outcome: matured }], { pool, now: NOW });
  const replay = await writeResearchOutcomes([{ outcome: matured }], { pool, now: NOW });
  assert.deepEqual(first.map((row) => row.inserted), [true, true]); assert.equal(replay[0].inserted, false);
  await assert.rejects(writeResearchOutcomes([{ outcome: matured, id: "outcome-wrong" }], { pool, now: NOW }), /deterministic outcomeRecordId/);
  const divergent = { ...matured, metrics: { ...matured.metrics, forwardTotalReturn: 0.9 } };
  divergent.canonicalPayload = { ...matured.canonicalPayload, metrics: divergent.metrics };
  divergent.outcomeHash = contentHash(divergent.canonicalPayload); divergent.hash = divergent.outcomeHash;
  await assert.rejects(writeResearchOutcomes([{ outcome: divergent }], { pool, now: NOW }), ResearchReplayConflictError);
});

test("validation happens before writes and rejects lineage, scalar mismatch, future times, and nonfinite JSON", async () => {
  const pool = fakePool(); const good = outcome();
  const noLineage = { ...good, canonicalPayload: { ...good.canonicalPayload, identity: { ...good.identity, observationId: null } } };
  await assert.rejects(writeResearchOutcomes([{ outcome: good }, { outcome: noLineage }], { pool, now: NOW }), /canonical payload/);
  assert.equal(pool.calls.length, 0);
  await assert.rejects(writeResearchOutcomes([{ outcome: good, evidenceClass: "unsupported" }], { pool, now: NOW }), /evidenceClass/);
  assert.throws(() => outcomeRecordId({ ...good, canonicalPayload: { ...good.canonicalPayload, identity: { ...good.canonicalPayload.identity, observationId: null, selectionItemId: null, comparisonPairId: null } } }), /durable observation/);
  await assert.rejects(writeResearchOutcomes([{ outcome: good, createdAt: "2030-01-01T00:00:00.000Z" }], { pool, now: NOW }), /future/);
  const badJson = { ...good, canonicalPayload: { ...good.canonicalPayload, metrics: { value: Infinity } } };
  await assert.rejects(writeResearchOutcomes([{ outcome: badJson }], { pool, now: NOW }), /canonical JSON/);
  await assert.rejects(writeResearchOutcomes([], {}), ResearchStoreNotConfiguredError);
});

test("foreign-key lineage is prevalidated before any outcome INSERT", async () => {
  const pool = fakePool({ missingObservationIds: ["missing-observation"] });
  await assert.rejects(writeResearchOutcomes([{ outcome: outcome() }, { outcome: outcome({ observationId: "missing-observation" }) }], { pool, now: NOW }), /referenced observation does not exist/);
  assert.equal(pool.calls.filter((call) => call.text.includes("INSERT INTO research_outcomes")).length, 0);
  assert.ok(pool.calls.some((call) => call.text === "ROLLBACK"));
});

test("writer rolls back a failing sequential batch and latest/matured reads have deterministic order", async () => {
  const pool = fakePool({ failInsert: true }); const first = outcome(); const second = outcome({ asOf: "2026-07-21T00:00:00.000Z" });
  await assert.rejects(writeResearchOutcomes([{ outcome: first }, { outcome: second }], { pool, now: "2026-07-21T00:00:00.000Z" }), /insert failed/);
  assert.ok(pool.calls.some((call) => call.text === "ROLLBACK")); assert.ok(!pool.calls.some((call) => call.text === "COMMIT"));
  const calls = [];
  const client = { async query(sql, params) { calls.push({ sql: String(sql), params }); return { rowCount: 0, rows: [] }; } };
  assert.equal(await readLatestResearchOutcome({ observationId: "observation-1" }, { client }), null);
  assert.deepEqual(await readMaturedResearchOutcomes({}, { client }), []);
  assert.match(calls[0].sql, /ORDER BY as_of DESC, created_at DESC, id DESC/);
  assert.match(calls[1].sql, /ORDER BY agent_id ASC, mandate_version ASC NULLS FIRST/);
});
