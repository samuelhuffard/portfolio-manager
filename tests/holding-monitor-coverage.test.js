import test from "node:test";
import assert from "node:assert/strict";
import { buildHoldingMonitorCoverage, holdingMonitorCoveragePasses } from "../lib/holding-monitor-coverage.js";

test("holding coverage conserves fully monitored and explicitly degraded names", () => {
  const result = buildHoldingMonitorCoverage({ expected: 4, monitored: 2, degraded: 2, reasons: { quote_unavailable: 2 } });
  assert.equal(result.complete, true);
  assert.equal(result.accounted, 4);
  assert.equal(result.silentSkipped, 0);
  assert.equal(holdingMonitorCoveragePasses(result), true);
});

test("holding coverage exposes silent skips, failures, overflow, and malformed counts", () => {
  assert.equal(buildHoldingMonitorCoverage({ expected: 4, monitored: 2, degraded: 1 }).silentSkipped, 1);
  assert.equal(buildHoldingMonitorCoverage({ expected: 4, monitored: 3, degraded: 0, failed: 1 }).complete, false);
  assert.equal(buildHoldingMonitorCoverage({ expected: 1, monitored: 2, degraded: 0 }).overflow, 1);
  assert.equal(buildHoldingMonitorCoverage({ expected: 1, monitored: -1, degraded: 0 }).complete, false);
});
