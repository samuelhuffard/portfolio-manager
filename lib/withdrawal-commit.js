import { canonicalJson } from "./research-version.js";
import { applyLotUpdates, consumeLotsFIFO } from "./tax-lots.js";
import { entryMatchesInvestor, normalizeEmail } from "./investor-ledger.js";

const PLAN_VERSION = 1;
const LOT_COMPARISON_FIELDS = [
  "lotId", "ticker", "openDate", "agentId", "costPerShare", "sharesOriginal", "sharesOpen", "status",
];
const TRADE_COMPARISON_FIELDS = [
  "date", "ticker", "side", "orderId", "agentId", "proposalId",
];
// Money fields survive a RAW write → UNFORMATTED_VALUE read as IEEE doubles, so
// compare them to the cent rather than by identity. An exact-equality check here
// would refuse a legitimate repair over a representation artifact.
const TRADE_MONEY_FIELDS = ["shares", "price", "amount", "realizedGain"];
const MONEY_EPSILON = 1e-6;

function finitePositive(value, field) {
  if (!Number.isFinite(value) || value <= 0) throw new TypeError(`${field} must be a positive finite number.`);
  return value;
}

function sameFields(left, right, fields) {
  return fields.every((field) => left?.[field] === right?.[field]);
}

function sameMoney(left, right, fields) {
  return fields.every((field) => {
    const a = left?.[field];
    const b = right?.[field];
    if (a == null || b == null) return a === b;
    return Number.isFinite(Number(a)) && Number.isFinite(Number(b)) && Math.abs(Number(a) - Number(b)) <= MONEY_EPSILON;
  });
}

function sameTrade(left, right) {
  return sameFields(left, right, TRADE_COMPARISON_FIELDS) && sameMoney(left, right, TRADE_MONEY_FIELDS);
}

function normalizedSales(sales) {
  if (!Array.isArray(sales)) throw new TypeError("sell instructions must be an array.");
  return sales.map((sale, index) => {
    const ticker = String(sale?.ticker ?? "").trim().toUpperCase();
    if (!ticker) throw new TypeError(`sell instructions[${index}].ticker is required.`);
    return {
      ticker,
      shares: finitePositive(sale?.shares, `sell instructions[${index}].shares`),
      price: finitePositive(sale?.price, `sell instructions[${index}].price`),
    };
  });
}

/**
 * Creates the exact one-time money-state plan. The caller persists it before
 * any Trade Ledger, Lots, or Investors write. No retry may create a new plan.
 */
export function buildWithdrawalCommitPlan({
  operationId,
  createdAt,
  email,
  investorId,
  requestedAmount,
  entry,
  sales,
  lots,
  tradeDate,
}) {
  const normalizedOperationId = String(operationId ?? "").trim();
  if (!normalizedOperationId) throw new TypeError("operationId is required.");
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) throw new TypeError("email is required.");
  const normalizedInvestorId = String(investorId ?? "").trim();
  if (!normalizedInvestorId) throw new TypeError("investorId is required.");
  finitePositive(requestedAmount, "requestedAmount");
  if (!entry || entry.entryId !== normalizedOperationId) throw new TypeError("entry must be signed for operationId.");
  if (!Array.isArray(lots)) throw new TypeError("lots must be an array.");
  const normalizedTradeDate = String(tradeDate ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedTradeDate)) throw new TypeError("tradeDate must be YYYY-MM-DD.");

  const normalized = normalizedSales(sales);
  let workingLots = lots;
  let totalRealizedGain = 0;
  const transitionByLotId = new Map();
  const trades = [];

  for (const sale of normalized) {
    const { realizedGain, updatedLots } = consumeLotsFIFO(workingLots, sale.ticker, sale.shares, sale.price);
    totalRealizedGain += realizedGain;
    for (const updated of updatedLots) {
      const before = workingLots.find((lot) => lot.lotId === updated.lotId);
      if (!before) throw new Error(`Withdrawal plan lost tax lot ${updated.lotId}.`);
      const prior = transitionByLotId.get(updated.lotId);
      transitionByLotId.set(updated.lotId, {
        // A repeated sell instruction can consume the same lot twice. Preserve
        // its first state and its final state so replay remains a single
        // absolute update rather than an impossible two-step transition.
        before: prior?.before ?? Object.fromEntries(LOT_COMPARISON_FIELDS.map((field) => [field, before[field]])),
        after: Object.fromEntries(LOT_COMPARISON_FIELDS.map((field) => [field, updated[field]])),
      });
    }
    workingLots = applyLotUpdates(workingLots, updatedLots);
    trades.push({
      date: normalizedTradeDate,
      ticker: sale.ticker,
      side: "SELL",
      shares: sale.shares,
      price: sale.price,
      amount: Math.round(sale.shares * sale.price * 100) / 100,
      orderId: null,
      agentId: "withdrawal",
      proposalId: normalizedOperationId,
      realizedGain: Math.round(realizedGain * 100) / 100,
    });
  }

  return {
    version: PLAN_VERSION,
    operationId: normalizedOperationId,
    createdAt: String(createdAt ?? "").trim(),
    request: {
      email: normalizedEmail,
      investorId: normalizedInvestorId,
      requestedAmount,
      sales: normalized.map(({ ticker, shares }) => ({ ticker, shares })),
    },
    entry,
    trades,
    lotTransitions: [...transitionByLotId.values()],
    totalRealizedGain: Math.round(totalRealizedGain * 100) / 100,
  };
}

export function serializeWithdrawalCommitPlan(plan) {
  validateWithdrawalCommitPlan(plan);
  return canonicalJson(plan);
}

export function parseWithdrawalCommitPlan(planJson) {
  let plan;
  try {
    plan = JSON.parse(String(planJson ?? ""));
  } catch {
    throw new Error("Withdrawal operation plan JSON is invalid; refusing to replay it.");
  }
  validateWithdrawalCommitPlan(plan);
  return plan;
}

export function validateWithdrawalCommitPlan(plan) {
  if (!plan || plan.version !== PLAN_VERSION || typeof plan.operationId !== "string" || !plan.operationId) {
    throw new Error("Withdrawal operation plan is invalid; refusing to replay it.");
  }
  finitePositive(plan.request?.requestedAmount, "withdrawal operation requestedAmount");
  if (plan.entry?.entryId !== plan.operationId || !Array.isArray(plan.trades) || !Array.isArray(plan.lotTransitions)) {
    throw new Error("Withdrawal operation plan is incomplete; refusing to replay it.");
  }
  normalizedSales(plan.request.sales.map((sale) => ({ ...sale, price: 1 })));
  for (const transition of plan.lotTransitions) {
    if (!transition?.before || !transition?.after
      || LOT_COMPARISON_FIELDS.some((field) => !(field in transition.before) || !(field in transition.after))
      || !transition.before.lotId || transition.before.lotId !== transition.after.lotId) {
      throw new Error("Withdrawal operation has an invalid lot transition; refusing to replay it.");
    }
  }
  return plan;
}

/** Reject a changed command line rather than letting an idempotency key mean two requests. */
export function withdrawalPlanMatchesRequest(plan, { email, investorId, requestedAmount, sales }) {
  validateWithdrawalCommitPlan(plan);
  const requestedSales = normalizedSales(sales).map(({ ticker, shares }) => ({ ticker, shares }));
  return plan.request.email === normalizeEmail(email)
    && plan.request.investorId === String(investorId ?? "").trim()
    && plan.request.requestedAmount === requestedAmount
    && canonicalJson(plan.request.sales) === canonicalJson(requestedSales);
}

/**
 * Return absolute lot updates only when every lot is still at the planned
 * before-state. If all are at the after-state, the prior attempt completed this
 * stage. A mixed/foreign state is irreconcilable automatically and fails shut.
 */
export function reconcileWithdrawalLotTransitions(currentLots, transitions) {
  if (!Array.isArray(currentLots) || !Array.isArray(transitions)) throw new TypeError("lots and transitions must be arrays.");
  const byLotId = new Map(currentLots.map((lot) => [lot.lotId, lot]));
  const states = transitions.map((transition) => {
    const current = byLotId.get(transition.before.lotId);
    if (!current) throw new Error(`Withdrawal tax lot ${transition.before.lotId} is missing; refusing to replay.`);
    if (sameFields(current, transition.before, LOT_COMPARISON_FIELDS)) return { current, transition, state: "before" };
    if (sameFields(current, transition.after, LOT_COMPARISON_FIELDS)) return { current, transition, state: "after" };
    throw new Error(`Withdrawal tax lot ${transition.before.lotId} no longer matches its signed plan; refusing to replay.`);
  });
  if (!states.length || states.every((item) => item.state === "after")) return [];
  if (!states.every((item) => item.state === "before")) {
    throw new Error("Withdrawal lot updates are only partially applied; refusing automatic repair.");
  }
  return states.map(({ current, transition }) => ({ ...transition.after, rowIndex: current.rowIndex }));
}

/**
 * Keyed rows must be exactly the planned set — matched as a multiset, not by
 * position. The Trade Ledger is a human-sortable sheet, so a reordering must not
 * turn a completed stage into an irreconcilable one.
 */
export function withdrawalTradesMatchPlan(entries, plan) {
  validateWithdrawalCommitPlan(plan);
  const actual = entries.filter((entry) => entry?.proposalId === plan.operationId);
  if (actual.length !== plan.trades.length) return false;
  const unmatched = [...actual];
  for (const planned of plan.trades) {
    const index = unmatched.findIndex((entry) => sameTrade(entry, planned));
    if (index === -1) return false;
    unmatched.splice(index, 1);
  }
  return unmatched.length === 0;
}

/**
 * Units the plan's investor would hold once this plan's entry is appended.
 *
 * A replay deliberately does NOT re-run the unit ceiling: the operation is
 * already partly committed (lots consumed, trade rows written), so refusing to
 * finish leaves a worse inconsistency than finishing it. But another capital
 * operation can run between the failed attempt and the retry — the lock only
 * serializes operations, it does not reserve the plan's units — so the replay
 * can legitimately overdraw. Surface that instead of completing silently.
 */
export function projectWithdrawalUnitsAfterReplay(ledger, plan) {
  validateWithdrawalCommitPlan(plan);
  if (!Array.isArray(ledger)) throw new TypeError("ledger must be an array.");
  // Reuse the canonical identity predicate the ceiling check uses. A second
  // local copy here could drift and make this projection disagree with the
  // very check it exists to stand in for on the replay path.
  const held = ledger
    .filter((entry) => entry?.entryId !== plan.operationId
      && entryMatchesInvestor(entry, { investorId: plan.entry.investorId, email: plan.entry.email }))
    .reduce((sum, entry) => sum + Number(entry.units ?? 0), 0);
  const projected = held + Number(plan.entry.units ?? 0);
  return { heldUnits: held, projectedUnits: projected, overdrawn: projected < -1e-6 };
}

export function withdrawalEntryMatchesPlan(entry, plan) {
  validateWithdrawalCommitPlan(plan);
  return entry?.entryId === plan.operationId
    && entry.date === plan.entry.date
    && entry.email === plan.entry.email
    && entry.name === plan.entry.name
    && entry.investorId === plan.entry.investorId
    && entry.type === plan.entry.type
    && entry.amount === plan.entry.amount
    && entry.navPerUnit === plan.entry.navPerUnit
    && entry.units === plan.entry.units
    && entry.rowHmac === plan.entry.rowHmac;
}
