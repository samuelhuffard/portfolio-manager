#!/usr/bin/env node
// Dual-write parity runner (ADR 0001). Compares the authoritative stores
// (Redis proposals + Sheets ledgers) against the Postgres shadow and prints a
// per-key report. Intended to run daily on the Jetson during the shadow period;
// runs anywhere the creds exist, degrading gracefully where they don't.
//
//   npm run db:parity
//
// Until the shadow writes are wired into the create paths and history is
// backfilled, expect Postgres to read lower — that's the point: this is how the
// backfill/wiring progress is measured toward the 30-day zero-divergence gate.

import "dotenv/config";
import { compareParity, renderParityReport } from "../lib/pg/parity.js";
import { pgConfigured, pgQuery, closePool } from "../lib/pg/client.js";

async function pgCount(sql) {
  try {
    const r = await pgQuery(sql);
    return { count: Number(r.rows[0].count), sum: r.rows[0].sum != null ? Number(r.rows[0].sum) : undefined };
  } catch (err) {
    return { error: err.message };
  }
}

async function gatherPostgres() {
  if (!pgConfigured()) return { error: "DATABASE_URL not set" };
  return {
    proposals: await pgCount("SELECT count(*)::int AS count FROM proposals"),
    capital_entries: await pgCount("SELECT count(*)::int AS count, COALESCE(sum(amount),0) AS sum FROM capital_entries"),
    lots: await pgCount("SELECT count(*)::int AS count FROM lots"),
    positions: await pgCount("SELECT count(*)::int AS count FROM positions"),
  };
}

async function gatherAuthoritative() {
  const out = {};
  // Proposals live in Redis.
  try {
    const { listAllProposals } = await import("../lib/redis.js");
    const proposals = await listAllProposals();
    if (Array.isArray(proposals)) out.proposals = { count: proposals.length };
  } catch (err) {
    console.warn(`[parity] could not read Redis proposals: ${err.message}`);
  }
  // Lots + capital entries live in Sheets (needs the service-account creds).
  try {
    const { getServiceAccountClients, resolveSharedSpreadsheetId, readAllLots, readInvestorLedger } = await import("../lib/sheets.js");
    const { sheets, drive } = await getServiceAccountClients();
    const spreadsheetId = await resolveSharedSpreadsheetId(sheets, drive);
    const [lots, investors] = await Promise.all([
      readAllLots(sheets, spreadsheetId).catch(() => null),
      readInvestorLedger(sheets, spreadsheetId).catch(() => null),
    ]);
    if (Array.isArray(lots)) out.lots = { count: lots.length };
    if (Array.isArray(investors)) {
      out.capital_entries = { count: investors.length, sum: investors.reduce((s, e) => s + (Number(e.amount) || 0), 0) };
    }
  } catch (err) {
    console.warn(`[parity] could not read Sheets ledgers (creds absent here?): ${err.message}`);
  }
  return out;
}

const [authoritative, postgres] = await Promise.all([gatherAuthoritative(), gatherPostgres()]);

// Only compare keys both sides could actually gather — a side we couldn't read is
// a tooling gap to report, not a data divergence to alarm on.
const comparable = {};
const pgClean = {};
for (const key of Object.keys(authoritative)) {
  if (postgres[key] && !postgres[key].error) {
    comparable[key] = authoritative[key];
    pgClean[key] = postgres[key];
  }
}

console.log("Authoritative:", JSON.stringify(authoritative));
console.log("Postgres shadow:", JSON.stringify(postgres));
console.log("");
console.log(renderParityReport(compareParity(comparable, pgClean)));

await closePool();
