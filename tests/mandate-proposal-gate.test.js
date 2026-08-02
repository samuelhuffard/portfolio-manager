import { test } from "node:test";
import assert from "node:assert/strict";
import { applyPersistedMandateScoreGate } from "../lib/mandate-proposal-gate.js";

const BUY = { action: "BUY", targetWeight: 5 };
const AS_OF = "2026-08-01T21:00:00.000Z";

test("persisted mandate gate is a no-I/O passthrough while disabled", async () => {
  let reads = 0;
  const result = await applyPersistedMandateScoreGate(BUY, {
    agentId: "agent-1", ticker: "AAA", asOf: AS_OF, env: {},
    readObservation: async () => { reads++; return null; },
  });
  assert.deepEqual(result.rec, BUY);
  assert.equal(result.applied, false);
  assert.equal(reads, 0);
});

test("enabled persisted mandate gate reads the durable score at the decision instant and fails closed", async () => {
  let received = null;
  const result = await applyPersistedMandateScoreGate(BUY, {
    agentId: "agent-1", ticker: "AAA", asOf: AS_OF,
    env: { MANDATE_SCORE_GATES_PROPOSALS: "1" },
    readObservation: async (args) => { received = args; return null; },
  });
  assert.deepEqual(received, { agentId: "agent-1", ticker: "AAA", asOf: AS_OF });
  assert.equal(result.applied, true);
  assert.equal(result.rec.action, "HOLD");
  assert.match(result.rec.overrideNotes.join(" "), /no mandate score observation/);
});

test("a durable lookup failure cannot open an entry path", async () => {
  const result = await applyPersistedMandateScoreGate(BUY, {
    agentId: "agent-1", ticker: "AAA", asOf: AS_OF,
    env: { MANDATE_SCORE_GATES_PROPOSALS: "1" },
    readObservation: async () => { throw new Error("database unavailable"); },
  });
  assert.equal(result.rec.action, "HOLD");
  assert.match(result.rec.overrideNotes.join(" "), /no mandate score observation/);
});

test("a non-Error durable lookup failure also fails closed without escaping the scan", async () => {
  const result = await applyPersistedMandateScoreGate(BUY, {
    agentId: "agent-1", ticker: "AAA", asOf: AS_OF,
    env: { MANDATE_SCORE_GATES_PROPOSALS: "1" },
    readObservation: async () => { throw null; },
  });
  assert.equal(result.rec.action, "HOLD");
  assert.match(result.rec.overrideNotes.join(" "), /no mandate score observation/);
});
