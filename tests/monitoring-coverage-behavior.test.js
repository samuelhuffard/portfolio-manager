import test from "node:test";
import assert from "node:assert/strict";
import {
  initializeIntradayHoldingCoverage,
  recordIntradayProposalQueueFailure,
  recordIntradayQuoteBatchFailure,
} from "../jobs/intraday-monitor.js";
import { exitProposalAmount, requireQueuedExitProposal } from "../jobs/monitor-positions.js";
import { buildHoldingMonitorCoverage, holdingMonitorCoveragePasses } from "../lib/holding-monitor-coverage.js";
import { readHoldingsAllocation } from "../lib/sheets.js";

test("holdings allocation preserves numeric zero but exposes missing, malformed, and negative shares", async () => {
  const sheets = { spreadsheets: { values: { async get() {
    return { data: { values: [
      ["ZERO", "Zero", "0", "", "", "0"],
      ["BLANK", "Blank", "", "", "", "10"],
      ["BAD", "Bad", "not-a-number", "", "", "10"],
      ["NEG", "Negative", "-2", "", "", "10"],
    ] } };
  } } } };
  const rows = await readHoldingsAllocation(sheets, "sheet-id");
  assert.deepEqual(rows.map((row) => row.shares), [0, null, null, -2]);
});

test("intraday batch quote failure accounts every valid and malformed held row with exact reasons", () => {
  const initialized = initializeIntradayHoldingCoverage([
    { ticker: "ZERO", shares: 0 },
    { ticker: "GOOD", shares: 2 },
    { ticker: "BLANK", shares: null },
    { ticker: "BAD", shares: Number.NaN },
    { ticker: "NEG", shares: -1 },
  ]);
  assert.deepEqual(initialized.validHeld.map((row) => row.ticker), ["GOOD"]);
  assert.equal(initialized.invalidHeld.length, 3);
  const coverage = recordIntradayQuoteBatchFailure(initialized.validHeld, initialized.coverage);
  assert.deepEqual(coverage.reasons, { invalid_held_shares: 3, quote_batch_unavailable: 1 });
  assert.equal(coverage.reasonAccountingComplete, true);
  assert.equal(coverage.accounted, 4);
  assert.equal(coverage.complete, false);
});

test("intraday queue failure is failed coverage and cannot pass Phase 0", () => {
  const coverage = { monitored: 0, degraded: 0, failed: 0, reasons: {} };
  recordIntradayProposalQueueFailure(coverage);
  const proof = buildHoldingMonitorCoverage({ expected: 1, ...coverage });
  assert.equal(proof.failed, 1);
  assert.deepEqual(proof.reasons, { exit_proposal_queue_failure: 1 });
  assert.equal(holdingMonitorCoveragePasses(proof), false);
});

test("exit sizing rejects missing/nonpositive values and durable queue failure", () => {
  assert.throws(() => exitProposalAmount({ action: "SELL", reducePct: 100 }, null), /positive market value/);
  assert.throws(() => exitProposalAmount({ action: "TRIM", reducePct: 0 }, 100), /amount is not positive/);
  assert.equal(exitProposalAmount({ action: "TRIM", reducePct: 25 }, 100), 25);
  assert.throws(() => requireQueuedExitProposal(null), /durably queued/);
  assert.deepEqual(requireQueuedExitProposal({ id: "proposal-1" }), { id: "proposal-1" });
});
