import {
  buildWithdrawalCommitPlan,
  parseWithdrawalCommitPlan,
  projectWithdrawalUnitsAfterReplay,
  reconcileWithdrawalLotTransitions,
  serializeWithdrawalCommitPlan,
  withdrawalEntryMatchesPlan,
  withdrawalPlanMatchesRequest,
  withdrawalTradesMatchPlan,
} from "./withdrawal-commit.js";
import { prepareSignedWithdrawalLedgerEntry, withdrawalCommitAlreadyRecorded } from "./withdrawal-pricing.js";
import { investorLedgerEntryHmacMatches } from "./investor-ledger.js";
import { operationalLedgerEntryHmacMatches } from "./operational-ledger.js";

/**
 * The withdrawal commit sequence, with every Sheet reader/writer injected.
 *
 * This is the money-state ordering itself, so it lives in a pure-ish lib with a
 * fault-injection test file rather than inline in the CLI: the property that
 * matters is not "each helper is correct" but "a failure at ANY write boundary
 * leaves state a same-key re-run can finish". That can only be tested by
 * injecting faults at each boundary, which needs these seams.
 *
 * Caller must already hold the `capital-ledger` workflow lock. Ordering is
 * load-bearing: the signed plan is persisted BEFORE any money state moves, so a
 * retry replays it instead of recomputing FIFO against consumed lots.
 */
export async function runWithdrawalCommit({
  io,
  idempotencyKey,
  email,
  investorId,
  requestedAmount,
  sales,
  previewRealizedGain,
  navSnapshot,
  secret,
  tradeDate,
  now = () => new Date().toISOString(),
}) {
  const [freshLedger, freshHistory, freshLots, operationRows] = await Promise.all([
    io.readInvestorLedger(),
    io.readPerformanceHistory(),
    io.readAllLots(),
    io.readWithdrawalOperations(),
  ]);

  const matchingOperations = operationRows.filter((row) => row.operationId === idempotencyKey);
  // A Sheets append that succeeded but whose response was lost can be retried by
  // the transport, leaving byte-identical duplicate plan rows. Every row here
  // already passed its operational HMAC, so identical duplicates are the same
  // immutable plan and safe to replay. Divergent plans are genuine ambiguity
  // about which one the money state reflects — refuse those.
  if (matchingOperations.length > 1 && new Set(matchingOperations.map((row) => row.planJson)).size > 1) {
    throw new Error("Conflicting signed withdrawal plans use this idempotency key; refusing automatic repair.");
  }

  let plan;
  let entryResult;
  const replayed = matchingOperations.length >= 1;

  if (replayed) {
    plan = parseWithdrawalCommitPlan(matchingOperations[0].planJson);
    if (!withdrawalPlanMatchesRequest(plan, { email, investorId, requestedAmount, sales })) {
      throw new Error("Withdrawal idempotency key is already bound to a different request; refusing to reuse it.");
    }
  } else {
    // A ledger row without a plan predates this recovery mechanism. Never guess
    // whether its tax lots were already updated.
    if (withdrawalCommitAlreadyRecorded(freshLedger, idempotencyKey)) {
      throw new Error("Withdrawal entry exists without a signed recovery plan; refusing to infer lot state automatically.");
    }
    ({ entryResult } = prepareSignedWithdrawalLedgerEntry({
      agentId: "portfolio",
      ledger: freshLedger,
      performanceHistory: freshHistory,
      email,
      name: email,
      amount: requestedAmount,
      investorId,
      entryId: idempotencyKey,
      navSnapshot,
      secret,
    }));
    plan = buildWithdrawalCommitPlan({
      operationId: idempotencyKey,
      createdAt: now(),
      email,
      investorId,
      requestedAmount,
      entry: entryResult.entry,
      sales,
      lots: freshLots,
      tradeDate,
    });
    // The preview computed the realized gain (and so the tax reserve Sam acted
    // on) from lots read before the lock. The plan just recomputed FIFO against
    // fresh lots. Both sides are cent-rounded, so any real difference means the
    // lots moved — refuse rather than record a number he did not approve.
    if (Math.abs(plan.totalRealizedGain - Math.round(previewRealizedGain * 100) / 100) > 1e-6) {
      throw new Error(
        `Tax lots changed since the preview: realized gain would be $${plan.totalRealizedGain.toFixed(2)}, not the $${previewRealizedGain.toFixed(2)} shown. Re-run the dry-run preview and confirm the new tax reserve before committing.`
      );
    }
    await io.appendWithdrawalOperation({
      operationId: idempotencyKey,
      createdAt: plan.createdAt,
      planJson: serializeWithdrawalCommitPlan(plan),
    });
  }
  entryResult ??= { entry: plan.entry };

  // Legacy unsigned trade rows do not block this operation, but a row bearing
  // this key must exactly match its signed plan and carry a valid signature.
  if (plan.trades.length) {
    const existingTrades = await io.readTradeLedger();
    const keyedTrades = existingTrades.filter((row) => row.proposalId === idempotencyKey);
    if (keyedTrades.length && (!withdrawalTradesMatchPlan(existingTrades, plan)
      || !keyedTrades.every((row) => operationalLedgerEntryHmacMatches("trade", row)))) {
      throw new Error("Withdrawal Trade Ledger rows conflict with the signed recovery plan; refusing automatic repair.");
    }
    if (!keyedTrades.length) await io.appendTradeLedgerEntries(plan.trades);
  }

  const lotUpdates = reconcileWithdrawalLotTransitions(freshLots, plan.lotTransitions);
  if (lotUpdates.length) await io.applyLotUpdatesToSheet(lotUpdates);

  // Exactly one — never `.find()`. A Sheets append that succeeded with a lost
  // response can be retried by the transport, producing two validly-signed
  // identical investor rows. Taking the first match would report the operation
  // idempotent and leave both withdrawals burning units, and nothing else in the
  // system detects duplicate investor rows (both verify).
  const existingEntries = freshLedger.filter((entry) => entry.entryId === idempotencyKey);
  if (existingEntries.length > 1) {
    throw new Error(`Investors tab holds ${existingEntries.length} rows for this withdrawal key; refusing automatic repair — remove the duplicate append first.`);
  }
  const existingEntry = existingEntries[0];
  if (existingEntry && !withdrawalEntryMatchesPlan(existingEntry, plan)) {
    throw new Error("Withdrawal Investors row conflicts with the signed recovery plan; refusing automatic repair.");
  }
  // The plan row is signed with the OPERATIONAL secret; the entry inside it is
  // signed with the INVESTOR secret. In production those are different keys, so
  // holding the outer signature must not confer authority to append an arbitrary
  // investor row. Verify the inner signature before writing it.
  if (!existingEntry && !investorLedgerEntryHmacMatches(plan.entry, secret)) {
    throw new Error("Withdrawal plan's investor entry is not validly signed with the investor-ledger key; refusing to append it.");
  }

  // A replay does not re-run the unit ceiling: the lots and trade rows are
  // already committed, so completing beats abandoning a half-written operation.
  // It can still overdraw if another capital entry landed in between — surface it.
  let overdrawWarning = null;
  if (replayed && !existingEntry) {
    const projection = projectWithdrawalUnitsAfterReplay(freshLedger, plan);
    if (projection.overdrawn) overdrawWarning = { ...projection, email: plan.entry.email, units: plan.entry.units };
  }

  if (!existingEntry) await io.appendInvestorLedgerEntry(plan.entry);
  await io.shadowWriteCapitalEntry(plan.entry);

  return { plan, entryResult, alreadyRecorded: Boolean(existingEntry), replayed, overdrawWarning };
}
