import test from "node:test";
import assert from "node:assert/strict";
import { buildInvestorLedgerEntry } from "../lib/investor-ledger.js";
import { operationalLedgerEntryHmacMatches, signOperationalLedgerEntry } from "../lib/operational-ledger.js";
import {
  buildWithdrawalCommitPlan,
  parseWithdrawalCommitPlan,
  projectWithdrawalUnitsAfterReplay,
  reconcileWithdrawalLotTransitions,
  serializeWithdrawalCommitPlan,
  withdrawalEntryMatchesPlan,
  withdrawalPlanMatchesRequest,
  withdrawalTradesMatchPlan,
} from "../lib/withdrawal-commit.js";

const secret = "withdrawal-commit-test-secret";
const operationId = "withdrawal-retry-plan-20260916";
const lots = [
  { rowIndex: 3, lotId: "lot-old", ticker: "ABC", openDate: "2025-01-01", agentId: "agent-1", costPerShare: 10, sharesOriginal: 5, sharesOpen: 5, status: "OPEN", rowHmac: "old" },
  { rowIndex: 4, lotId: "lot-new", ticker: "ABC", openDate: "2026-01-01", agentId: "agent-1", costPerShare: 15, sharesOriginal: 5, sharesOpen: 5, status: "OPEN", rowHmac: "new" },
];

function plan() {
  const entry = buildInvestorLedgerEntry({
    date: "2026-09-16", email: "investor@example.com", name: "Investor", type: "Withdrawal",
    amount: 70, navPerUnit: 1, units: -70, investorId: "user_investor", entryId: operationId,
  }, secret);
  return buildWithdrawalCommitPlan({
    operationId,
    createdAt: "2026-09-16T20:00:00.000Z",
    email: "investor@example.com",
    investorId: "user_investor",
    requestedAmount: 70,
    entry,
    sales: [{ ticker: "ABC", shares: 7, price: 20 }],
    lots,
    tradeDate: "2026-09-16",
  });
}

test("a retry after Lots succeeded reuses the signed plan and performs no second consumption", () => {
  const operation = plan();
  const firstUpdates = reconcileWithdrawalLotTransitions(lots, operation.lotTransitions);
  assert.deepEqual(firstUpdates.map((lot) => [lot.lotId, lot.sharesOpen, lot.status]), [
    ["lot-old", 0, "CLOSED"],
    ["lot-new", 3, "OPEN"],
  ]);

  // This models the old failure point: Lots writes succeeded, but Investors
  // append then threw. A retry must see completion, not try FIFO again.
  const afterLots = lots.map((lot) => firstUpdates.find((update) => update.lotId === lot.lotId) ?? lot);
  assert.deepEqual(reconcileWithdrawalLotTransitions(afterLots, operation.lotTransitions), []);
  assert.equal(withdrawalEntryMatchesPlan(operation.entry, operation), true);
  assert.equal(withdrawalTradesMatchPlan(operation.trades, operation), true);
});

test("partial or unrelated lot mutation fails closed instead of guessing a retry", () => {
  const operation = plan();
  const updates = reconcileWithdrawalLotTransitions(lots, operation.lotTransitions);
  const mixed = lots.map((lot) => lot.lotId === "lot-old" ? updates.find((update) => update.lotId === lot.lotId) : lot);
  assert.throws(() => reconcileWithdrawalLotTransitions(mixed, operation.lotTransitions), /partially applied/);

  const changed = lots.map((lot) => lot.lotId === "lot-new" ? { ...lot, sharesOpen: 4 } : lot);
  assert.throws(() => reconcileWithdrawalLotTransitions(changed, operation.lotTransitions), /no longer matches/);
});

test("a persisted plan is canonical, rejects malformed data, and binds the immutable request", () => {
  const operation = plan();
  const parsed = parseWithdrawalCommitPlan(serializeWithdrawalCommitPlan(operation));
  assert.deepEqual(parsed, operation);
  assert.equal(withdrawalPlanMatchesRequest(parsed, {
    email: "INVESTOR@example.com", investorId: "user_investor", requestedAmount: 70,
    sales: [{ ticker: "ABC", shares: 7, price: 999 }],
  }), true);
  assert.equal(withdrawalPlanMatchesRequest(parsed, {
    email: "investor@example.com", investorId: "user_investor", requestedAmount: 71,
    sales: [{ ticker: "ABC", shares: 7, price: 20 }],
  }), false);
  assert.throws(() => parseWithdrawalCommitPlan("{bad json"), /plan JSON is invalid/);

  // Identity is (ticker, shares); price is stripped. A retry that cannot supply
  // a live price must still be able to COMPARE its request rather than throwing.
  assert.equal(withdrawalPlanMatchesRequest(parsed, {
    email: "investor@example.com", investorId: "user_investor", requestedAmount: 70,
    sales: [{ ticker: "ABC", shares: 7 }],
  }), true);
  assert.equal(withdrawalPlanMatchesRequest(parsed, {
    email: "investor@example.com", investorId: "user_investor", requestedAmount: 70,
    sales: [{ ticker: "ABC", shares: 8 }],
  }), false);
  assert.throws(() => withdrawalPlanMatchesRequest(parsed, {
    email: "investor@example.com", investorId: "user_investor", requestedAmount: 70, sales: "ABC:7",
  }), /must be an array/);
});

test("keyed trade rows match the plan as a set, tolerating sheet reordering and float drift", () => {
  const twoSaleLots = [
    ...lots,
    { rowIndex: 5, lotId: "lot-xyz", ticker: "XYZ", openDate: "2025-06-01", agentId: "agent-1", costPerShare: 3, sharesOriginal: 4, sharesOpen: 4, status: "OPEN", rowHmac: "xyz" },
  ];
  const operation = buildWithdrawalCommitPlan({
    operationId, createdAt: "2026-09-16T20:00:00.000Z",
    email: "investor@example.com", investorId: "user_investor", requestedAmount: 70,
    entry: plan().entry, lots: twoSaleLots, tradeDate: "2026-09-16",
    sales: [{ ticker: "ABC", shares: 3, price: 20 }, { ticker: "XYZ", shares: 2, price: 5 }],
  });
  assert.equal(operation.trades.length, 2);

  // A user sorting the Trade Ledger must not turn a completed stage into an
  // irreconcilable one.
  assert.equal(withdrawalTradesMatchPlan([...operation.trades].reverse(), operation), true);

  // RAW write → UNFORMATTED_VALUE read can perturb the last bits of a double.
  const drifted = operation.trades.map((trade, index) =>
    index === 0 ? { ...trade, amount: trade.amount + 1e-9, realizedGain: trade.realizedGain - 1e-9 } : trade);
  assert.equal(withdrawalTradesMatchPlan(drifted, operation), true);

  // A materially different row, a missing row, and a duplicated row all fail closed.
  assert.equal(withdrawalTradesMatchPlan(
    operation.trades.map((trade, index) => index === 0 ? { ...trade, shares: trade.shares + 1 } : trade), operation), false);
  assert.equal(withdrawalTradesMatchPlan([operation.trades[0]], operation), false);
  assert.equal(withdrawalTradesMatchPlan([operation.trades[0], { ...operation.trades[0] }], operation), false);
});

test("a replay that would overdraw the investor is detected rather than completed silently", () => {
  const operation = plan(); // burns 70 units
  const capital = (units, entryId) => buildInvestorLedgerEntry({
    date: "2026-09-01", email: "investor@example.com", name: "Investor",
    type: units > 0 ? "Contribution" : "Withdrawal", amount: Math.abs(units), navPerUnit: 1,
    units, investorId: "user_investor", entryId,
  }, secret);

  const healthy = projectWithdrawalUnitsAfterReplay([capital(100, "seed")], operation);
  assert.deepEqual([healthy.heldUnits, healthy.projectedUnits, healthy.overdrawn], [100, 30, false]);

  // Another capital entry landed between the failed attempt and this retry.
  const raced = projectWithdrawalUnitsAfterReplay([capital(100, "seed"), capital(-50, "concurrent")], operation);
  assert.equal(raced.overdrawn, true);
  assert.equal(Math.round(raced.projectedUnits), -20);

  // The plan's own entry must never be double-counted if it is already present.
  const withOwnEntry = projectWithdrawalUnitsAfterReplay([capital(100, "seed"), operation.entry], operation);
  assert.deepEqual([withOwnEntry.projectedUnits, withOwnEntry.overdrawn], [30, false]);
});

test("the persisted recovery plan has its own tamper-evident operational signature", () => {
  const operation = plan();
  const receipt = signOperationalLedgerEntry("withdrawal_operation", {
    operationId,
    createdAt: operation.createdAt,
    planJson: serializeWithdrawalCommitPlan(operation),
  }, secret);
  assert.equal(operationalLedgerEntryHmacMatches("withdrawal_operation", receipt, secret), true);
  assert.equal(operationalLedgerEntryHmacMatches("withdrawal_operation", { ...receipt, planJson: "{}" }, secret), false);
});
