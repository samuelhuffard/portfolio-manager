import { test } from "node:test";
import assert from "node:assert/strict";
import { AGENT_SCORING } from "../config/scoring/mandate-v2.js";
import { ABSOLUTE_VALUATION_TABLES } from "../config/scoring/mandate-v2.js";
import { ABSOLUTE_RULE_TABLES, SPECIAL_SECTOR_RULE_TABLES } from "../config/scoring/absolute-thresholds.js";
import {
  canonicalJson,
  contentHash,
  mandateMetadataFor,
  mandateVersionFor,
  observationId,
  peerSetId,
  scoringConfigVersion,
} from "../lib/research-version.js";

const scoringTables = {
  AGENT_SCORING,
  ABSOLUTE_RULE_TABLES,
  SPECIAL_SECTOR_RULE_TABLES,
  ABSOLUTE_VALUATION_TABLES,
};

test("canonicalJson sorts object keys recursively and preserves array order", () => {
  assert.equal(canonicalJson({ b: 2, a: { d: 4, c: 3 }, z: [3, { b: 2, a: 1 }] }), "{\"a\":{\"c\":3,\"d\":4},\"b\":2,\"z\":[3,{\"a\":1,\"b\":2}]}");
});

test("contentHash is stable for key-order changes and remains hex lowercase", () => {
  const a = contentHash({ b: 2, a: [1, 2, 3] });
  const b = contentHash({ a: [1, 2, 3], b: 2 });
  const c = contentHash({ a: [3, 2, 1], b: 2 });
  assert.equal(a, b);
  assert.match(a, /^[a-f0-9]{64}$/);
  assert.notEqual(a, c);
});

test("canonicalJson fail-closes unsupported values", () => {
  assert.throws(() => canonicalJson({ a: undefined }), /undefined/);
  assert.throws(() => canonicalJson({ a: () => {} }), /function/);
  assert.throws(() => canonicalJson({ a: Symbol("x") }), /symbol/);
  assert.throws(() => canonicalJson({ a: Number.NaN }), /non-finite/);
  assert.throws(() => canonicalJson({ a: Infinity }), /non-finite/);
  const cycle = {};
  cycle.self = cycle;
  assert.throws(() => canonicalJson(cycle), /cyclic/);
  assert.throws(() => canonicalJson(new Date("2026-07-13T00:00:00Z")), /non-plain objects/);
});

test("mandate metadata comes from explicit config files only", () => {
  const metadata = mandateMetadataFor("agent-1");
  assert.deepEqual(Object.keys(metadata).sort(), [
    "agentId",
    "canonicalSourcePath",
    "mandateId",
    "mandateVersion",
    "productionUniversePolicyVersion",
    "targetUniversePolicyVersion",
  ]);
  assert.deepEqual(metadata, {
    agentId: "agent-1",
    mandateId: "agent_one",
    mandateVersion: "3.0",
    canonicalSourcePath: "agent_mandates/Agent_One_Mandate_v3.md",
    targetUniversePolicyVersion: "eligible-us-operating-common-equities-v3",
    productionUniversePolicyVersion: "catalog-technology-subverticals-v1",
  });
  assert.equal(mandateVersionFor("agent-1"), "3.0");
  assert.throws(() => mandateMetadataFor("agent-9"), /Unknown mandate agentId/);
  assert.throws(() => mandateVersionFor("agent-9"), /Unknown mandate agentId/);
});

test("scoringConfigVersion ignores source metadata and hashes only executable tables", () => {
  const base = scoringConfigVersion({ semanticVersion: "mandate-v3-scoring-1", scoringTables });
  const withMetadata = scoringConfigVersion({
    semanticVersion: "mandate-v3-scoring-1",
    scoringTables: { ...scoringTables, gitCommit: "abc123", mtime: "2026-07-13T00:00:00Z", comments: "ignored" },
  });
  assert.equal(base, withMetadata);
  assert.match(base, /^mandate-v3-scoring-1\+sha256:[a-f0-9]{64}$/);
  assert.throws(() => scoringConfigVersion({ semanticVersion: "", scoringTables }), /semanticVersion/);
  assert.throws(() => scoringConfigVersion({ semanticVersion: "mandate-v3-scoring-1", scoringTables: { AGENT_SCORING } }), /missing required table export/);
});

test("peerSetId normalizes ticker order, case, and duplicates while preserving asOf", () => {
  const base = peerSetId({ level: "industry", key: "Software", tickers: ["nvda", "AAPL", "MSFT", "AAPL"], asOf: "2026-07-13T12:00:00-04:00" });
  const reordered = peerSetId({ level: "industry", key: "Software", tickers: ["MSFT", "aapl", "NVDA"], asOf: "2026-07-13T12:00:00-04:00" });
  const changedAsOf = peerSetId({ level: "industry", key: "Software", tickers: ["AAPL", "MSFT", "NVDA"], asOf: "2026-07-13T13:00:00-04:00" });
  const changedMembership = peerSetId({ level: "industry", key: "Software", tickers: ["AAPL", "MSFT"], asOf: "2026-07-13T12:00:00-04:00" });
  assert.equal(base, reordered);
  assert.notEqual(base, changedAsOf);
  assert.notEqual(base, changedMembership);
  assert.throws(() => peerSetId({ level: "industry", key: "Software", tickers: ["AAPL"], asOf: "2026-07-13T12:00:00" }), /zoned ISO timestamp/);
});

test("observationId normalizes ticker casing and isolates run identity", () => {
  const base = observationId({ runId: "run-1", agentId: "agent-1", ticker: " nvda " });
  const normalized = observationId({ runId: "run-1", agentId: "agent-1", ticker: "NVDA" });
  const changedRun = observationId({ runId: "run-2", agentId: "agent-1", ticker: "NVDA" });
  assert.equal(base, normalized);
  assert.notEqual(base, changedRun);
  assert.match(base, /^[a-f0-9]{64}$/);
  assert.throws(() => observationId({ runId: "run-1", agentId: "agent-1", ticker: "not ticker!" }), /invalid ticker/);
});
