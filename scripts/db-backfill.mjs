#!/usr/bin/env node
// Dual-write backfill (ADR 0001, migration step 1). Seeds the Postgres shadow
// with existing history from the authoritative stores so parity starts from a
// full copy rather than only new writes. Idempotent (shadow writes use ON
// CONFLICT DO NOTHING), so it is safe to re-run.
//
//   PG_DUAL_WRITE=true npm run db:backfill
//
// Writes ONLY to Postgres (the shadow) — never touches Redis/Sheets. Rows that
// don't satisfy their contract are logged and skipped (surfacing legacy data
// issues) rather than aborting the backfill. Sheets-backed objects need the
// service-account creds, so a full backfill runs on the Jetson; elsewhere it
// backfills what it can read and reports the rest.

import "dotenv/config";
import { pgConfigured } from "../lib/pg/client.js";
import {
  dualWriteEnabled,
  shadowWriteProposal,
  shadowWriteLot,
  shadowWriteCapitalEntry,
  shadowReplacePositions,
} from "../lib/pg/dual-write.js";

if (!pgConfigured()) {
  console.error("DATABASE_URL not set — nothing to back fill into.");
  process.exit(1);
}
if (!dualWriteEnabled()) {
  console.error("Refusing to backfill with PG_DUAL_WRITE off. Re-run as: PG_DUAL_WRITE=true npm run db:backfill");
  process.exit(1);
}

async function backfill(label, loadRows, writeRow) {
  let rows;
  try {
    rows = await loadRows();
  } catch (err) {
    console.warn(`[backfill] ${label}: could not read source (skipped): ${err.message}`);
    return;
  }
  if (!Array.isArray(rows)) {
    console.warn(`[backfill] ${label}: source unavailable (skipped).`);
    return;
  }
  let ok = 0, failed = 0;
  for (const row of rows) {
    const res = await writeRow(row);
    if (res.ok) ok += 1;
    else failed += 1; // dual-write already logged the reason (contract mismatch etc.)
  }
  console.log(`[backfill] ${label}: ${ok} shadowed, ${failed} skipped, of ${rows.length}`);
}

// Proposals — Redis.
await backfill(
  "proposals",
  async () => (await import("../lib/redis.js")).listAllProposals(),
  (p) => shadowWriteProposal(p)
);

// Lots + capital entries — Sheets (needs service-account creds).
let sheetsCtx = null;
try {
  const s = await import("../lib/sheets.js");
  const { sheets, drive } = await s.getServiceAccountClients();
  const spreadsheetId = await s.resolveSharedSpreadsheetId(sheets, drive);
  sheetsCtx = { s, sheets, spreadsheetId };
} catch (err) {
  console.warn(`[backfill] Sheets creds unavailable here — lots/capital skipped (run on the Jetson): ${err.message}`);
}

if (sheetsCtx) {
  const { s, sheets, spreadsheetId } = sheetsCtx;
  await backfill("lots", () => s.readAllLots(sheets, spreadsheetId), (l) => shadowWriteLot(l));
  await backfill("capital_entries", () => s.readInvestorLedger(sheets, spreadsheetId), (e) => shadowWriteCapitalEntry(e));

  // Holdings is a replaceable current-state projection, so shadow it as one
  // transaction rather than treating rows as an append-only backfill.
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "Holdings!A2:G",
      valueRenderOption: "UNFORMATTED_VALUE",
    });
    const positions = (res.data.values || [])
      .filter((row) => row[0] && row[0] !== "Cash" && !String(row[0]).startsWith("Last synced") && !String(row[0]).startsWith("⚠️"))
      .map((row) => ({
        ticker: String(row[0]).trim().toUpperCase(),
        name: row[1] == null ? undefined : String(row[1]),
        shares: Number(row[2]),
        avgCost: Number(row[3]),
        marketValue: row[5] === "" || row[5] == null ? null : Number(row[5]),
        costBasis: Number(row[6]),
      }));
    const result = await shadowReplacePositions(positions);
    console.log(`[backfill] positions: ${result.ok ? positions.length : 0} shadowed, ${result.ok ? 0 : positions.length} skipped, of ${positions.length}`);
  } catch (err) {
    console.warn(`[backfill] positions: could not read source (skipped): ${err.message}`);
  }
}

const { closePool } = await import("../lib/pg/client.js");
await closePool();
console.log("backfill complete.");
