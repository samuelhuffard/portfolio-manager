import { test } from "node:test";
import assert from "node:assert/strict";
import { openLot } from "../lib/tax-lots.js";
import { projectAgentOwnedHoldings } from "../lib/research-holding-ownership.js";

function lots() {
  return [
    openLot({ ticker: "SAME", shares: 4, costPerShare: 80, date: "2026-01-01", agentId: "agent-1", lotId: "a1" }),
    openLot({ ticker: "SAME", shares: 6, costPerShare: 100, date: "2026-02-01", agentId: "agent-2", lotId: "a2" }),
    openLot({ ticker: "LEGACY", shares: 3, costPerShare: 50, date: "legacy", agentId: "unattributed", lotId: "u1" }),
  ];
}

const holdings = [
  { ticker: "SAME", shares: 10, marketValue: 1200 },
  { ticker: "LEGACY", shares: 3, marketValue: 180 },
];

test("same ticker is projected independently for each owning agent", () => {
  const one = projectAgentOwnedHoldings({ agentId: "agent-1", lots: lots(), holdings });
  const two = projectAgentOwnedHoldings({ agentId: "agent-2", lots: lots(), holdings });
  assert.deepEqual(one.tickers, ["SAME"]);
  assert.deepEqual(two.tickers, ["SAME"]);
  assert.equal(one.positionValueByTicker.SAME, 480);
  assert.equal(two.positionValueByTicker.SAME, 720);
});

test("unattributed inventory remains quarantined from every named agent", () => {
  const result = projectAgentOwnedHoldings({ agentId: "agent-3", lots: lots(), holdings });
  assert.deepEqual(result.positions, []);
  assert.equal(result.positionValueByTicker.LEGACY, undefined);
});

test("aggregate Holdings-versus-open-lot mismatch fails closed", () => {
  assert.throws(
    () => projectAgentOwnedHoldings({
      agentId: "agent-1",
      lots: lots(),
      holdings: [{ ticker: "SAME", shares: 11, marketValue: 1320 }, holdings[1]],
    }),
    /holding_ownership_mismatch: SAME/
  );
});

test("four-decimal Holdings display rounding passes only within share and dollar tolerances", () => {
  const roundedLots = [
    {
      ...openLot({ ticker: "ROUND", shares: 10, costPerShare: 100, date: "2026-01-01", agentId: "agent-1", lotId: "round" }),
      sharesOpen: 10.000045,
    },
  ];
  const result = projectAgentOwnedHoldings({
    agentId: "agent-1",
    lots: roundedLots,
    holdings: [{ ticker: "ROUND", shares: 10, marketValue: 1200 }],
  });
  assert.deepEqual(result.tickers, ["ROUND"]);

  assert.throws(
    () => projectAgentOwnedHoldings({
      agentId: "agent-1",
      lots: [
        {
          ...openLot({ ticker: "ROUND", shares: 10, costPerShare: 100, date: "2026-01-01", agentId: "agent-1", lotId: "too-many-shares" }),
          sharesOpen: 10.000101,
        },
      ],
      holdings: [{ ticker: "ROUND", shares: 10, marketValue: 1200 }],
    }),
    /holding_ownership_mismatch/
  );

  assert.throws(
    () => projectAgentOwnedHoldings({
      agentId: "agent-1",
      lots: [
        {
          ...openLot({ ticker: "PRICEY", shares: 1, costPerShare: 900_000, date: "2026-01-01", agentId: "agent-1", lotId: "too-many-dollars" }),
          sharesOpen: 1.0000001,
        },
      ],
      holdings: [{ ticker: "PRICEY", shares: 1, marketValue: 1_000_000 }],
    }),
    /holding_ownership_mismatch/
  );
});

test("invalid or duplicate aggregate holdings fail closed", () => {
  assert.throws(
    () => projectAgentOwnedHoldings({ agentId: "agent-1", lots: [], holdings: [{ ticker: "BAD", shares: null, marketValue: 0 }] }),
    /holding_ownership_invalid/
  );
});
