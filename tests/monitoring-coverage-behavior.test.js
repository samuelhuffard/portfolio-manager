import test from "node:test";
import assert from "node:assert/strict";
import {
  initializeIntradayHoldingCoverage,
  recordIntradayProposalQueueFailure,
  recordIntradayQuoteBatchFailure,
} from "../jobs/intraday-monitor.js";
import { exitProposalAmount, requireQueuedExitProposal } from "../jobs/monitor-positions.js";
import { buildHoldingMonitorCoverage, holdingMonitorCoveragePasses } from "../lib/holding-monitor-coverage.js";
import { readCashBalance, readHoldingsAllocation, readHoldingsDetail, readHoldingsReturnPct } from "../lib/sheets.js";

test("Holdings money readers request unformatted values instead of parsing currency text as zero", async () => {
  const requests = [];
  const sheets = { spreadsheets: { values: { async get(request) {
    requests.push(request);
    const numericRows = [
      ["NVDA", "Nvidia", 0.08, 200, 212.5, 17, 16, 1, 6.25],
      [" Cash ", "", "", "", "", 85],
    ];
    const formattedRows = [
      ["NVDA", "Nvidia", "0.08", "$200.00", "$212.50", "$17.00", "$16.00", "$1.00", "+6.25%"],
      [" Cash ", "", "", "", "", "$85.00"],
    ];
    return { data: { values: request.valueRenderOption === "UNFORMATTED_VALUE" ? numericRows : formattedRows } };
  } } } };

  assert.equal(await readCashBalance(sheets, "sheet-id"), 85);
  assert.deepEqual(await readHoldingsAllocation(sheets, "sheet-id"), [
    { ticker: "NVDA", shares: 0.08, marketValue: 17 },
  ]);
  assert.deepEqual(await readHoldingsDetail(sheets, "sheet-id"), [
    { ticker: "NVDA", shares: 0.08, currentPrice: 212.5, marketValue: 17, costBasis: 16 },
  ]);
  assert.deepEqual(await readHoldingsReturnPct(sheets, "sheet-id"), { NVDA: 6.25 });
  assert.equal(requests.length, 4);
  assert.ok(requests.every((request) => request.valueRenderOption === "UNFORMATTED_VALUE"));
});

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
