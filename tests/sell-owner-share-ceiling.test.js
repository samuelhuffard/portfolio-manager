import { createHmac } from "node:crypto";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CURRENT_PROPOSAL_CONTRACT_VERSION,
  checkSellOwnerShareLimitForExecution,
} from "../contracts/proposal.js";
import { computeDecisionSignature } from "../lib/proposal-signature.js";
import { validateMcpFillInput } from "../lib/mcp-accounting.js";
import { projectAgentOwnedHoldings } from "../lib/research-holding-ownership.js";
import { openLot } from "../lib/tax-lots.js";

const SECRET = "sell-owner-ceiling-test-secret";

function approvedSell(overrides = {}) {
  const proposal = {
    id: "sell-scope-1",
    status: "ApprovedForBrokerReview",
    agentId: "agent-1",
    ticker: "SAME",
    side: "SELL",
    amountDollars: 500,
    maxPrice: null,
    decidedAt: "2026-07-20T15:00:00.000Z",
    decidedByUserId: "user-sam",
    proposalContractVersion: CURRENT_PROPOSAL_CONTRACT_VERSION,
    sellOwnerShareLimit: 5,
    fulfilledAt: null,
    ...overrides,
  };
  proposal.decisionHmac = computeDecisionSignature(proposal, SECRET);
  return proposal;
}

test("legacy signature payload remains byte-identical while v2 signs the owner ceiling", () => {
  const legacy = {
    id: "legacy",
    status: "ApprovedForBrokerReview",
    agentId: "agent-1",
    ticker: "SAME",
    side: "SELL",
    amountDollars: 500,
    maxPrice: null,
    decidedAt: "2026-07-20T15:00:00.000Z",
    decidedByUserId: "user-sam",
  };
  const oldPayload = [
    legacy.id,
    legacy.status,
    legacy.agentId,
    legacy.ticker,
    legacy.side,
    String(legacy.amountDollars),
    "",
    legacy.decidedAt,
    legacy.decidedByUserId,
  ].join("|");
  assert.equal(
    computeDecisionSignature(legacy, SECRET),
    createHmac("sha256", SECRET).update(oldPayload).digest("hex"),
  );

  const scoped = approvedSell();
  assert.notEqual(
    scoped.decisionHmac,
    computeDecisionSignature({ ...scoped, sellOwnerShareLimit: 6 }, SECRET),
  );
});

test("every SELL fails closed without a positive ceiling while legacy non-SELL proposals remain compatible", () => {
  assert.equal(checkSellOwnerShareLimitForExecution({ side: "SELL" }).ok, false);
  assert.deepEqual(
    checkSellOwnerShareLimitForExecution({ side: "BUY", proposalContractVersion: 2 }),
    { ok: true, legacy: false },
  );
  assert.equal(
    checkSellOwnerShareLimitForExecution({
      side: "SELL",
      proposalContractVersion: 2,
      sellOwnerShareLimit: null,
    }).ok,
    false,
  );
  assert.equal(
    checkSellOwnerShareLimitForExecution({
      side: "SELL",
      proposalContractVersion: 2,
      sellOwnerShareLimit: 5,
    }).ok,
    true,
  );
});

test("verified same-ticker lots expose each strategy's independent share ceiling", () => {
  const lots = [
    openLot({ ticker: "SAME", shares: 5, costPerShare: 80, date: "2026-01-01", agentId: "agent-1", lotId: "a1" }),
    openLot({ ticker: "SAME", shares: 7, costPerShare: 90, date: "2026-02-01", agentId: "agent-2", lotId: "a2" }),
  ];
  const holdings = [{ ticker: "SAME", shares: 12, marketValue: 1200 }];
  assert.equal(
    projectAgentOwnedHoldings({ agentId: "agent-1", lots, holdings }).positionSharesByTicker.SAME,
    5,
  );
  assert.equal(
    projectAgentOwnedHoldings({ agentId: "agent-2", lots, holdings }).positionSharesByTicker.SAME,
    7,
  );
});

test("fill accounting rejects shares above the signed strategy-owner ceiling", () => {
  const common = {
    proposal: approvedSell(),
    existingTrades: [],
    ticker: "SAME",
    side: "SELL",
    price: 100,
    agentId: "agent-1",
    signatureSecret: SECRET,
  };
  assert.doesNotThrow(() =>
    validateMcpFillInput({ ...common, orderId: "within", shares: 5 })
  );
  assert.throws(
    () => validateMcpFillInput({ ...common, orderId: "over", shares: 5.00000002 }),
    /exceeds the signed strategy-owner ceiling/,
  );
});
