import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  initializeSpecialistHoldingCoverage,
  projectSpecialistMonitorHoldings,
  specialistExitPolicyMode,
} from "../lib/holding-monitor-ownership.js";

function lot(agentId, sharesOpen, ticker = "SAME") {
  return {
    agentId,
    ticker,
    openDate: "2026-01-02",
    status: "OPEN",
    sharesOpen,
    sharesOriginal: sharesOpen,
    costPerShare: 80,
  };
}

test("monitor ownership splits a shared ticker by verified strategy lots", () => {
  const result = projectSpecialistMonitorHoldings({
    holdings: [{ ticker: "SAME", shares: 10, marketValue: 1_000 }],
    lots: [
      lot("agent-1", 4),
      lot("agent-2", 3),
      lot("agent-3", 2),
      lot("unattributed", 1),
    ],
  });

  assert.deepEqual(
    result.positions.map(({ agentId, ticker, shares, marketValue }) => ({
      agentId, ticker, shares, marketValue,
    })),
    [
      { agentId: "agent-1", ticker: "SAME", shares: 4, marketValue: 400 },
      { agentId: "agent-2", ticker: "SAME", shares: 3, marketValue: 300 },
      { agentId: "agent-3", ticker: "SAME", shares: 2, marketValue: 200 },
    ]
  );
  assert.deepEqual(result.quarantined, [
    { agentId: "unattributed", ticker: "SAME", shares: 1, marketValue: 100 },
  ]);
  assert.equal(result.positions.every((position) =>
    position.firstOpenAt === "2026-01-02T00:00:00.000Z"
  ), true);
});

test("monitor ownership fails closed when Holdings and signed lots disagree", () => {
  assert.throws(
    () => projectSpecialistMonitorHoldings({
      holdings: [{ ticker: "SAME", shares: 10, marketValue: 1_000 }],
      lots: [lot("agent-1", 9)],
    }),
    /holding_ownership_mismatch/
  );
});

test("unsupported or unattributed exposure is failed Trust coverage, not ordinary degradation", () => {
  assert.deepEqual(
    initializeSpecialistHoldingCoverage({ quarantined: [{ agentId: "unattributed", ticker: "BAD" }] }),
    {
      monitored: 0,
      degraded: 0,
      failed: 1,
      reasons: { unsupported_or_unattributed_holding_owner: 1 },
    }
  );
});

test("intraday automation follows mandate posture while all owners retain quote surveillance", () => {
  assert.equal(specialistExitPolicyMode("agent-1"), "agent_one_atr_intraday");
  assert.equal(specialistExitPolicyMode("agent-2"), "quote_surveillance_only");
  assert.equal(specialistExitPolicyMode("agent-3"), "quote_surveillance_only");
  assert.equal(specialistExitPolicyMode("unattributed"), "quote_surveillance_only");
});

test("both live monitors verify lots and use the shared ownership projection", () => {
  for (const job of ["intraday-monitor.js", "monitor-positions.js"]) {
    const source = readFileSync(new URL(`../jobs/${job}`, import.meta.url), "utf8");
    assert.match(source, /readAllLots\(sheets, spreadsheetId\)/);
    assert.match(source, /projectSpecialistMonitorHoldings\(\{ holdings: allocation, lots: verifiedLots \}\)/);
    assert.doesNotMatch(source, /const (?:EXIT_)?AGENT_ID\s*=\s*"agent-1"/);
  }
});

test("EOD monitor routes every owner through the common mandate holding evaluator", () => {
  const source = readFileSync(new URL("../jobs/monitor-positions.js", import.meta.url), "utf8");
  assert.match(source, /buildLiveHoldingMandateEvidence\(\{/);
  assert.match(source, /evaluateMandateHolding\(\{ agentId, evidence, asOf \}\)/);
  assert.doesNotMatch(source, /mandate_specific_exit_policy_unbound|holdingExitPolicyMode/);
});
