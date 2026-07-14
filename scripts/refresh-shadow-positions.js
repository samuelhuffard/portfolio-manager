#!/usr/bin/env node
// Rebuild the non-authoritative Postgres positions and accounting projections
// from the authoritative signed Sheets state. This deliberately does not write
// Sheets, Redis, lots, trades, approvals, or execute anything.
import "dotenv/config";
import {
  getServiceAccountClients,
  readHoldingsProjectionWithQuoteSnapshot,
  readLatestAccountingProjection,
  resolveSharedSpreadsheetId,
} from "../lib/sheets.js";
import { shadowReplacePositions, shadowWriteNavSnapshot } from "../lib/pg/dual-write.js";
import { positionsProjectionFromHoldings } from "../lib/pg/positions-projection.js";

export async function refreshShadowPositions() {
  const { sheets, drive } = getServiceAccountClients();
  const spreadsheetId = await resolveSharedSpreadsheetId(sheets, drive);
  const [{ holdings, quoteSnapshot }, accounting] = await Promise.all([
    readHoldingsProjectionWithQuoteSnapshot(sheets, spreadsheetId),
    readLatestAccountingProjection(sheets, spreadsheetId),
  ]);
  const [positionsResult, accountingResult] = await Promise.all([
    shadowReplacePositions(positionsProjectionFromHoldings(holdings), { valuation: quoteSnapshot }),
    shadowWriteNavSnapshot(accounting),
  ]);
  if (!positionsResult?.ok) throw new Error(`Postgres positions projection refresh did not complete: ${positionsResult?.error ?? "dual write disabled or unavailable"}`);
  if (!accountingResult?.ok) throw new Error(`Postgres accounting projection refresh did not complete: ${accountingResult?.error ?? "dual write disabled or unavailable"}`);
  return { positions: holdings.length, accountingDate: accounting.date };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  refreshShadowPositions()
    .then(({ positions, accountingDate }) => console.log(`[ShadowPositions] refreshed ${positions} position(s) and accounting snapshot ${accountingDate} from authoritative Sheets.`))
    .catch((error) => { console.error(`[ShadowPositions] failed: ${error.message}`); process.exit(1); });
}
