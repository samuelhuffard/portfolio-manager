/**
 * Verify-on-read for the signed ledgers (RISK_REGISTER #2). Until this ran on
 * a schedule, the row HMACs on the Investors tab and the Redis audit log were
 * write-only — "tamper-evident" in name only. Pure functions; the I/O lives in
 * scripts/verify-ledgers.js.
 */

import { timingSafeEqual } from "node:crypto";
import { computeInvestorLedgerHmac } from "./investor-ledger.js";

function hmacsEqual(expectedHex, providedHex) {
  const expected = Buffer.from(String(expectedHex), "hex");
  const provided = Buffer.from(String(providedHex), "hex");
  return provided.length === expected.length && provided.length > 0 && timingSafeEqual(provided, expected);
}

/**
 * entries: parsed Investors rows (lib/sheets.js readInvestorLedger).
 * Returns { total, verified, unsigned, mismatched } where mismatched entries
 * indicate in-place edits to signed rows (the append-only invariant broken).
 * Unsigned rows are reported, not failed — pre-signing history and deliberate
 * ALLOW_UNSIGNED_INVESTOR_LEDGER usage both produce them; the operator decides.
 */
export function verifyInvestorLedger(entries, secret) {
  if (!secret) throw new Error("A signing secret is required to verify the investor ledger.");
  const unsigned = [];
  const mismatched = [];
  let verified = 0;

  for (const entry of entries) {
    if (!entry.rowHmac) {
      unsigned.push(entry);
      continue;
    }
    const expected = computeInvestorLedgerHmac(entry, secret);
    if (hmacsEqual(expected, entry.rowHmac)) verified += 1;
    else mismatched.push(entry);
  }

  return { total: entries.length, verified, unsigned, mismatched };
}

/**
 * rows: audit events from Redis `pm:audit:{date}` lists, as written by
 * portfolio-dashboard/lib/audit.ts. The canonical payload here MUST mirror
 * that file's computeRowHmac exactly:
 *   JSON.stringify([timestamp, userId, role, action, route, sortedJson(metadata)])
 */
export function verifyAuditRows(rows, secret, { computeHmac }) {
  if (!secret) throw new Error("AUDIT_HMAC_SECRET is required to verify audit rows.");
  const unsigned = [];
  const mismatched = [];
  let verified = 0;

  for (const row of rows) {
    if (!row || typeof row !== "object") {
      mismatched.push(row);
      continue;
    }
    if (!row.rowHmac) {
      unsigned.push(row);
      continue;
    }
    const expected = computeHmac(row, secret);
    if (hmacsEqual(expected, row.rowHmac)) verified += 1;
    else mismatched.push(row);
  }

  return { total: rows.length, verified, unsigned, mismatched };
}

// Mirror of portfolio-dashboard/lib/audit.ts sortedJson + computeRowHmac —
// keep in sync (tests/ledger-verify.test.js pins the round-trip).
import { createHmac } from "node:crypto";

function sortedJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => sortedJson(item)).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${sortedJson(value[key])}`)
    .join(",")}}`;
}

export function computeAuditRowHmac(event, secret) {
  const canonical = JSON.stringify([
    event.timestamp,
    event.userId ?? null,
    event.role ?? null,
    event.action,
    event.route,
    sortedJson(event.metadata ?? {}),
  ]);
  return createHmac("sha256", secret).update(canonical).digest("hex");
}
