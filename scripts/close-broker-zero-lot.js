import "dotenv/config";
import { getServiceAccountClients, resolveSharedSpreadsheetId, readAllLots, readHoldingsProjectionWithQuoteSnapshot, applyLotUpdatesToSheet } from "../lib/sheets.js";
import { beginLotReconciliation, getLotReconciliation, markLotReconciliationApplied, markLotReconciliationSheetWriteAttempted } from "../lib/redis.js";
import { shadowWriteLot } from "../lib/pg/dual-write.js";
import { planBrokerZeroLotClosure } from "../lib/lot-reconciliation.js";
import { withWorkflowLock } from "../lib/workflow-lock.js";
const arg = (name) => { const i = process.argv.indexOf(`--${name}`); return i === -1 ? null : process.argv[i + 1]; };
const lotId = arg("lot-id"), expectedSharesOpen = Number(arg("expected-shares-open")), attestation = arg("attestation"), attestedBy = arg("attested-by") ?? "sam", commit = process.argv.includes("--commit");
if (!lotId || !Number.isFinite(expectedSharesOpen) || !attestation) throw new Error("Usage: node scripts/close-broker-zero-lot.js --lot-id <id> --expected-shares-open <shares> --attestation <text> [--attested-by sam] --commit");
const result = await withWorkflowLock("holdings-sync", () => withWorkflowLock("accounting", async () => {
  const { sheets, drive } = getServiceAccountClients(); const spreadsheetId = await resolveSharedSpreadsheetId(sheets, drive);
  const [lots, holdingsSnapshot] = await Promise.all([readAllLots(sheets, spreadsheetId), readHoldingsProjectionWithQuoteSnapshot(sheets, spreadsheetId)]);
  const reconciliationId = `lot-${lotId}`, existing = await getLotReconciliation(reconciliationId), currentLot = lots.find((lot) => lot.lotId === lotId);
  if (existing?.status === "SHEET_WRITE_ATTEMPTED" && currentLot?.status === "CLOSED" && currentLot.sharesOpen === 0) {
    if (existing.originalSharesOpen !== expectedSharesOpen || existing.lotId !== lotId) throw new Error("Pending lot reconciliation does not match the requested residual.");
    if (!commit) return { dryRun: true, recovered: true, ticker: currentLot.ticker, lotId, sharesClosed: expectedSharesOpen, reconciliationId };
    await shadowWriteLot(currentLot); await markLotReconciliationApplied({ reconciliationId });
    return { dryRun: false, recovered: true, ticker: currentLot.ticker, lotId, sharesClosed: expectedSharesOpen, reconciliationId };
  }
  const plan = planBrokerZeroLotClosure({ lots, ...holdingsSnapshot, lotId, expectedSharesOpen });
  if (!commit) return { dryRun: true, ticker: plan.originalLot.ticker, lotId, sharesClosed: plan.originalLot.sharesOpen };
  await beginLotReconciliation({ reconciliationId, lotId, ticker: plan.originalLot.ticker, agentId: plan.originalLot.agentId, originalSharesOpen: plan.originalLot.sharesOpen, brokerShares: plan.brokerShares, originalLotHmac: plan.originalLot.rowHmac, attestedBy, attestation });
  await markLotReconciliationSheetWriteAttempted({ reconciliationId }); await applyLotUpdatesToSheet(sheets, spreadsheetId, [plan.updatedLot]); await shadowWriteLot(plan.updatedLot); await markLotReconciliationApplied({ reconciliationId });
  return { dryRun: false, ticker: plan.originalLot.ticker, lotId, sharesClosed: plan.originalLot.sharesOpen, reconciliationId };
}, { ttlSeconds: 300 }), { ttlSeconds: 300 });
console.log(JSON.stringify(result));
