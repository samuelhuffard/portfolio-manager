import { test } from "node:test";
import assert from "node:assert/strict";
import { assertWalkForwardInputs, createPointInTimeLoader } from "../backtest/loaders/point-in-time.js";

const loader = createPointInTimeLoader({
  universeEvents: [
    { id: "add-old", securityId: "OLD", action: "add", availableAt: "2025-01-01T00:00:00Z", eligible: true },
    { id: "delist-old", securityId: "OLD", action: "remove", availableAt: "2025-02-01T00:00:00Z", reason: "delisted" },
  ],
  evidenceEvents: [
    { id: "filing-original", securityId: "OLD", acceptedAt: "2025-01-10T20:00:00Z", value: 10 },
    { id: "restatement-later", securityId: "OLD", acceptedAt: "2025-01-20T20:00:00Z", value: 7, restates: "filing-original" },
  ],
  marketData: [
    { id: "old-close", securityId: "OLD", completedAt: "2025-01-10T21:00:00Z", executableAt: "2025-01-13T14:30:00Z", price: 10 },
  ],
  policies: [
    { policyType: "scoring", version: "v1", introducedAt: "2025-01-01T00:00:00Z", activeAt: "2025-01-01T00:00:00Z" },
    { policyType: "scoring", version: "v2", introducedAt: "2025-01-15T00:00:00Z", activeAt: "2025-01-15T00:00:00Z" },
  ],
});

test("point-in-time snapshots hide future filings/restatements and retain later-delisted security history", () => {
  const beforeRestatement = loader.snapshotAt("2025-01-12T00:00:00Z");
  assert.deepEqual(beforeRestatement.evidence.map((event) => event.id), ["filing-original"]);
  assert.equal(beforeRestatement.universe.find((entry) => entry.securityId === "OLD").eligible, true);
  assert.equal(beforeRestatement.policies[0].version, "v1");

  const afterRestatement = loader.snapshotAt("2025-02-02T00:00:00Z");
  assert.deepEqual(afterRestatement.evidence.map((event) => event.id), ["filing-original", "restatement-later"]);
  const old = afterRestatement.universe.find((entry) => entry.securityId === "OLD");
  assert.equal(old.eligible, false);
  assert.equal(old.exclusionReason, "delisted");
  assert.equal(afterRestatement.policies[0].version, "v2");
});

test("daily close signals execute no earlier than the next regular session", () => {
  const execution = loader.nextRegularSessionPrice("OLD", "2025-01-10T21:00:00Z");
  assert.equal(execution.executableAt, "2025-01-13T14:30:00.000Z");
  assert.equal(loader.nextRegularSessionPrice("OLD", "2025-01-13T14:30:00Z"), null);
});

test("next regular-session execution chooses the earliest executable time, not completed-data order", () => {
  const outOfOrder = createPointInTimeLoader({
    marketData: [
      { id: "later-execution", securityId: "OLD", completedAt: "2025-01-11T21:00:00Z", executableAt: "2025-01-16T14:30:00Z", price: 11 },
      { id: "z-earliest", securityId: "OLD", completedAt: "2025-01-12T21:00:00Z", executableAt: "2025-01-15T14:30:00Z", price: 10 },
      { id: "a-earliest", securityId: "OLD", completedAt: "2025-01-13T21:00:00Z", executableAt: "2025-01-15T14:30:00Z", price: 10 },
    ],
  });
  assert.equal(outOfOrder.nextRegularSessionPrice("OLD", "2025-01-10T21:00:00Z").id, "a-earliest");
});

test("walk-forward selection rejects future policy or calibration leakage", () => {
  assert.throws(() => assertWalkForwardInputs({
    evaluationAt: "2025-01-10T00:00:00Z",
    policies: [{ version: "v2", introducedAt: "2025-01-15T00:00:00Z" }],
  }), /introduced after evaluationAt/);
  assert.throws(() => assertWalkForwardInputs({
    evaluationAt: "2025-01-10T00:00:00Z",
    calibrations: [{ version: "cal-v2", introducedAt: "2025-01-11T00:00:00Z" }],
  }), /introduced after evaluationAt/);
});
