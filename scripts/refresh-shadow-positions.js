#!/usr/bin/env node
// Rebuild the non-authoritative Postgres positions projection from the
// authoritative Holdings Sheet. This deliberately does not write Sheets,
// Redis, lots, trades, cash, approvals, or execute anything.
import "dotenv/config";
import { getServiceAccountClients, readHoldingsProjection, resolveSharedSpreadsheetId } from "../lib/sheets.js";
import { shadowReplacePositions } from "../lib/pg/dual-write.js";
import { positionsProjectionFromHoldings } from "../lib/pg/positions-projection.js";

export async function refreshShadowPositions() {
  const { sheets, drive } = getServiceAccountClients();
  const spreadsheetId = await resolveSharedSpreadsheetId(sheets, drive);
  const holdings = await readHoldingsProjection(sheets, spreadsheetId);
  const result = await shadowReplacePositions(positionsProjectionFromHoldings(holdings));
  if (!result?.ok) throw new Error(`Postgres positions projection refresh did not complete: ${result?.error ?? "dual write disabled or unavailable"}`);
  return { positions: holdings.length };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  refreshShadowPositions()
    .then(({ positions }) => console.log(`[ShadowPositions] refreshed ${positions} position(s) from authoritative Holdings Sheet.`))
    .catch((error) => { console.error(`[ShadowPositions] failed: ${error.message}`); process.exit(1); });
}
