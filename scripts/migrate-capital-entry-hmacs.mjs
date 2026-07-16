#!/usr/bin/env node
import "dotenv/config";
import { getServiceAccountClients, readInvestorLedger, resolveSharedSpreadsheetId } from "../lib/sheets.js";
import { closePool, pgQuery, pgTransaction } from "../lib/pg/client.js";
import {
  applyCapitalEntryHmacMigration,
  planCapitalEntryHmacMigration,
  summarizeCapitalEntryHmacPlan,
} from "../lib/pg/capital-hmac-migration.js";
import { runDailyDbParityCheck } from "../jobs/db-parity-check.js";

const args = process.argv.slice(2);
const commit = args.includes("--commit");
const attestationIndex = args.indexOf("--attestation");
const attestation = attestationIndex >= 0 ? String(args[attestationIndex + 1] ?? "").trim() : "";
if (commit && attestation.length < 20) {
  throw new Error("A descriptive --attestation is required with --commit.");
}

const SHADOW_QUERY = `SELECT c.entry_id AS "entryId", c.entry_date::text AS date,
  i.email, i.name, c.type, c.amount, c.nav_per_unit AS "navPerUnit", c.units,
  c.investor_id AS "investorId", c.row_hmac AS "rowHmac"
  FROM capital_entries c JOIN investors i ON i.investor_id = c.investor_id`;

try {
  const { sheets, drive } = getServiceAccountClients();
  const spreadsheetId = await resolveSharedSpreadsheetId(sheets, drive);
  // Normal read verifies every authoritative row against the configured current
  // investor-ledger secret before any migration can be planned.
  const authoritative = await readInvestorLedger(sheets, spreadsheetId);
  const shadow = (await pgQuery(SHADOW_QUERY)).rows;
  const plan = planCapitalEntryHmacMigration(authoritative, shadow);
  console.log(JSON.stringify({ preview: !commit, ...summarizeCapitalEntryHmacPlan(plan) }, null, 2));
  if (!plan.safeToApply) throw new Error("Capital-entry HMAC migration refused because ledger payloads do not match exactly.");
  if (!commit) process.exitCode = plan.updateCount > 0 ? 2 : 0;
  else {
    const result = await applyCapitalEntryHmacMigration(plan, { transaction: pgTransaction });
    const parity = await runDailyDbParityCheck();
    console.log(JSON.stringify({
      committed: true,
      attested: true,
      updated: result.updated,
      transactionalParity: parity.ok ? "MATCH" : "DIVERGENCE",
      matchedDomains: parity.matched,
      valuationStatus: parity.valuation?.status ?? null,
    }, null, 2));
  }
} finally {
  await closePool();
}
