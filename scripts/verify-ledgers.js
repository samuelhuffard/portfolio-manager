import "dotenv/config";
import { getServiceAccountClients, resolveSharedSpreadsheetId, readInvestorLedger } from "../lib/sheets.js";
import { getInvestorLedgerSecret } from "../lib/investor-ledger.js";
import { verifyInvestorLedger, verifyAuditRows, computeAuditRowHmac } from "../lib/ledger-verify.js";
import { getRedis } from "../lib/redis.js";
import { sendMessage } from "../lib/telegram.js";

// Verify-on-read for the signed stores (report-only, never mutates):
//  1. Investors tab — recompute every rowHmac; a mismatch means a signed
//     append-only row was edited in place (or forged).
//  2. Redis audit log — recompute rowHmac on the last N days of pm:audit:{date}.
// Runs daily from scheduler.js; also safe to run by hand any time.

const AUDIT_DAYS = Number(process.env.LEDGER_VERIFY_AUDIT_DAYS ?? 7);

export async function runLedgerVerification() {
  const problems = [];

  // 1. Investor ledger
  const investorSecret = getInvestorLedgerSecret();
  if (!investorSecret) {
    problems.push("Investor ledger: no signing secret configured — cannot verify (ALLOW_UNSIGNED_INVESTOR_LEDGER mode).");
  } else {
    const { sheets, drive } = getServiceAccountClients();
    const spreadsheetId = await resolveSharedSpreadsheetId(sheets, drive);
    const ledger = await readInvestorLedger(sheets, spreadsheetId);
    const result = verifyInvestorLedger(ledger, investorSecret);
    console.log(`[Verify] Investors: ${result.verified}/${result.total} verified, ${result.unsigned.length} unsigned, ${result.mismatched.length} MISMATCHED.`);
    for (const bad of result.mismatched) {
      problems.push(`Investor ledger TAMPER: entry ${bad.entryId ?? "?"} (${bad.date} ${bad.type} $${bad.amount} ${bad.email}) fails its signature.`);
    }
    if (result.unsigned.length) {
      console.warn(`[Verify] Investors: ${result.unsigned.length} unsigned row(s) — pre-signing history or deliberate unsigned mode.`);
    }
  }

  // 2. Audit log (last N days)
  const auditSecret = process.env.AUDIT_HMAC_SECRET?.trim();
  if (!auditSecret) {
    problems.push("Audit log: AUDIT_HMAC_SECRET not configured — cannot verify.");
  } else {
    const redis = getRedis();
    if (!redis) {
      problems.push("Audit log: Redis not configured — cannot verify.");
    } else {
      let total = 0;
      let mismatched = 0;
      for (let i = 0; i < AUDIT_DAYS; i++) {
        const date = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
        const raw = await redis.lrange(`pm:audit:${date}`, 0, -1).catch(() => []);
        const rows = raw.map((r) => (typeof r === "string" ? JSON.parse(r) : r));
        if (!rows.length) continue;
        const result = verifyAuditRows(rows, auditSecret, { computeHmac: computeAuditRowHmac });
        total += result.total;
        mismatched += result.mismatched.length;
        for (const bad of result.mismatched) {
          problems.push(`Audit TAMPER on ${date}: ${bad?.action ?? "?"} ${bad?.route ?? "?"} at ${bad?.timestamp ?? "?"} fails its signature.`);
        }
      }
      console.log(`[Verify] Audit: checked ${total} row(s) over ${AUDIT_DAYS} day(s), ${mismatched} mismatched.`);
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
