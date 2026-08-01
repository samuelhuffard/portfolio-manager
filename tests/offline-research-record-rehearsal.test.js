import test from "node:test";
import assert from "node:assert/strict";
import { createOfflineResearchRecordRehearsal } from "../lib/offline-research-record-rehearsal.js";

test("offline research-record rehearsal is append-only, replay-safe, and disconnected", () => {
  const store = createOfflineResearchRecordRehearsal();
  const record = { id: "observation:run-1:agent-1:NVDA", kind: "observation", payload: { ticker: "NVDA", version: "fixture-v1" } };
  assert.equal(store.append(record).inserted, true);
  assert.equal(store.append(structuredClone(record)).inserted, false);
  assert.throws(() => store.append({ ...record, payload: { ticker: "NVDA", version: "changed" } }), /replay conflict/);
  assert.equal(store.snapshot().length, 1);
});
