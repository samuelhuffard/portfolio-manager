import { selectLatestContributionNav } from "./contribution-nav.js";
import { calculateInvestorLedgerEntry } from "./investor-ledger.js";

// Every withdrawal preview and committed ledger entry must use the same signed
// 16:30 ET NAV. Keep that money-path invariant in one pure helper so neither
// CLI entry point can accidentally preview one price and burn units at another.
export function selectSignedWithdrawalNav(performanceHistory) {
  return selectLatestContributionNav(performanceHistory);
}

export function prepareSignedWithdrawalLedgerEntry({
  agentId = "portfolio",
  ledger,
  performanceHistory,
  email,
  name,
  amount,
  investorId,
  entryId = null,
  navSnapshot = null,
  now,
  secret,
}) {
  const authoritativeSnapshot = selectSignedWithdrawalNav(performanceHistory);
  if (
    navSnapshot != null
    && (navSnapshot.sourceInvocationId !== authoritativeSnapshot.sourceInvocationId
      || navSnapshot.navPerUnit !== authoritativeSnapshot.navPerUnit)
  ) {
    throw new Error("Withdrawal pricing snapshot does not match the latest signed 16:30 ET close.");
  }
  navSnapshot = navSnapshot ?? authoritativeSnapshot;
  const entryResult = calculateInvestorLedgerEntry({
    agentId,
    ledger,
    performanceHistory,
    email,
    name,
    amount,
    isWithdrawal: true,
    investorId,
    pricingNavPerUnit: navSnapshot.navPerUnit,
    entryId,
    now,
    secret,
  });
  return { navSnapshot, entryResult };
}

export function withdrawalCommitAlreadyRecorded(ledger, entryId) {
  // A missing key must never read as "already recorded": sheet rows parse a
  // blank Entry ID column to null, so a null/undefined key would otherwise
  // match a legacy row and silently skip a real withdrawal's ledger write.
  if (!Array.isArray(ledger) || typeof entryId !== "string" || !entryId) return false;
  return ledger.some((entry) => entry?.entryId === entryId);
}
