import "dotenv/config";
import { getServiceAccountClients, resolveSharedSpreadsheetId, readAllLots, readInvestorLedger, readPerformanceHistory, readTradeLedger } from "../lib/sheets.js";
import { getInvestorLedgerSecret } from "../lib/investor-ledger.js";
import { verifyInvestorLedger, verifyAuditRows, computeAuditRowHmac, verifyOperationalLedgerEntries } from "../lib/ledger-verify.js";
import { assertPerformanceSourceRequestEntries, getOperationalLedgerSecret } from "../lib/operational-ledger.js";
import { getRedis } from "../lib/redis.js";
import { sendMessage } from "../lib/telegram.js";

// Verify-on-read for the signed stores (report-only, never mutates):
//  1. Investors tab — recompute every rowHmac; a mismatch means a signed
//     append-only row was edited in place (or forged).
//  2. Redis audit log — recompute rowHmac on the last N days of pm:audit:{date}.
// Runs daily from scheduler.js; also safe to run by hand any time.

const AUDIT_DAYS = Number(process.env.LEDGER_VERIFY_AUDIT_DAYS ?? 7);

export async function verifyRecentAuditLog({ redis, auditSecret, days = AUDIT_DAYS, now = new Date() }) {
  const problems = [];
  let total = 0;
  let mismatched = 0;
  for (let i = 0; i < days; i++) {
    const date = new Date(now.getTime() - i * 86_400_000).toISOString().slice(0, 10);
    let raw;
    try {
      raw = await redis.lrange(`pm:audit:${date}`, 0, -1);
      if (!Array.isArray(raw)) throw new Error("response was not an array");
    } catch (error) {
      problems.push(`Audit log ${date}: Redis read failed (${error.message}).`);
      continue;
    }
    let rows;
    try {
      rows = raw.map((row) => (typeof row === "string" ? JSON.parse(row) : row));
    } catch (error) {
      problems.push(`Audit log ${date}: malformed JSON (${error.message}).`);
      continue;
    }
    if (!rows.length) continue;
    const result = verifyAuditRows(rows, auditSecret, { computeHmac: computeAuditRowHmac });
    total += result.total;
    mismatched += result.mismatched.length;
    for (const bad of result.mismatched) {
      problems.push(`Audit TAMPER on ${date}: ${bad?.action ?? "?"} ${bad?.route ?? "?"} at ${bad?.timestamp ?? "?"} fails its signature.`);
    }
  }
  return { problems, total, mismatched };
}

export async function runLedgerVerification() {
  const problems = [];
  const { sheets, drive } = getServiceAccountClients();
  const spreadsheetId = await resolveSharedSpreadsheetId(sheets, drive);

  // 1. Investor ledger
  const investorSecret = getInvestorLedgerSecret();
  if (!investorSecret) {
    problems.push("Investor ledger: no signing secret configured — cannot verify (ALLOW_UNSIGNED_INVESTOR_LEDGER mode).");
  } else {
    const ledger = await readInvestorLedger(sheets, spreadsheetId, { verify: false });
    const result = verifyInvestorLedger(ledger, investorSecret);
    console.log(`[Verify] Investors: ${result.verified}/${result.total} verified, ${result.unsigned.length} unsigned, ${result.mismatched.length} MISMATCHED.`);
    for (const bad of result.mismatched) {
      problems.push(`Investor ledger TAMPER: entry ${bad.entryId ?? "?"} (${bad.date} ${bad.type} $${bad.amount} ${bad.email}) fails its signature.`);
    }
    if (result.unsigned.length) {
      console.warn(`[Verify] Investors: ${result.unsigned.length} unsigned row(s) — pre-signing history or deliberate unsigned mode.`);
    }
  }

  // 2. Money-state ledgers. Reads here bypass the normal fail-closed assertion
  // only so this diagnostic can identify which store and rows need attention.
  try {
    const secret = getOperationalLedgerSecret();
    const ledgers = [
      ["Performance", "performance", await readPerformanceHistory(sheets, spreadsheetId, { verify: false })],
      ["Trade Ledger", "trade", await readTradeLedger(sheets, spreadsheetId, { verify: false })],
      ["Lots", "lot", await readAllLots(sheets, spreadsheetId, { verify: false })],
    ];
    for (const [label, kind, entries] of ledgers) {
      const result = verifyOperationalLedgerEntries(kind, entries, secret);
      if (kind === "performance") assertPerformanceSourceRequestEntries(entries, secret);
      console.log(`[Verify] ${label}: ${result.verified}/${result.total} verified, ${result.unsigned.length} unsigned, ${result.mismatched.length} MISMATCHED.`);
      if (result.unsigned.length) problems.push(`${label}: ${result.unsigned.length} unsigned row(s); run ledgers:backfill-operational before normal operation.`);
      if (result.mismatched.length) problems.push(`${label} TAMPER: ${result.mismatched.length} row(s) fail signature verification.`);
    }
  } catch (error) {
    problems.push(`Operational ledgers: ${error.message}`);
  }

  // 3. Audit log (last N days)
  const auditSecret = process.env.AUDIT_HMAC_SECRET?.trim();
  if (!auditSecret) {
    problems.push("Audit log: AUDIT_HMAC_SECRET not configured — cannot verify.");
  } else {
    const redis = getRedis();
    if (!redis) {
      problems.push("Audit log: Redis not configured — cannot verify.");
    } else {
      const result = await verifyRecentAuditLog({ redis, auditSecret });
      problems.push(...result.problems);
      console.log(`[Verify] Audit: checked ${result.total} row(s) over ${AUDIT_DAYS} day(s), ${result.mismatched} mismatched.`);
    }
  }

  if (problems.length) {
    const report = problems.join("\n");
    console.error(`[Verify] PROBLEMS:\n${report}`);
    try {
      await sendMessage(`🚨 Ledger verification:\n${report}`);
    } catch (err) {
      console.error(`[Verify] Telegram alert failed: ${err.message}`);
    }
    return false;
  }
  console.log("[Verify] All signed rows verified clean.");
  return true;
}

import { fileURLToPath } from "node:url";
if (fileURLToPath(import.meta.url) === process.argv[1]) {
  runLedgerVerification()
    .then((ok) => process.exit(ok ? 0 : 2))
    .catch((e) => {
      console.error("[Verify] error:", e.message);
      process.exit(1);
    });
}
