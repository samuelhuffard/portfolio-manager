// CANONICAL — edit here only. Mirrored to portfolio-dashboard/lib/contracts/ by
// `npm run contracts:sync`; the dashboard's contracts-drift test enforces equality.
//
// The approval decision signature: an HMAC over the trade-defining fields of a
// proposal, attached when a manager approves. Executors verify it before placing
// an order, so a bare Redis write cannot forge an "approved" proposal — approval
// authority stays with the dashboard (the only writer holding AUDIT_HMAC_SECRET
// at decision time).
//
// SECURITY BOUNDARY. The payload composition below is frozen at approval:
// changing which fields are included, their order, or their null-handling
// invalidates every outstanding approved proposal. This file is the single
// source for that composition; the three call sites (backend
// lib/proposal-signature.js, dashboard lib/proposals.ts, companion
// scripts/companion-core.mjs) all delegate here, and
// tests/companion-core.test.ts cross-checks that they agree.

import { createHmac } from "node:crypto";

/**
 * The trade-defining fields, in signature order. Fulfillment bookkeeping fields
 * are deliberately excluded — they change after approval without altering the
 * authorized trade.
 */
export const DECISION_SIGNATURE_FIELDS = [
  "id",
  "status",
  "agentId",
  "ticker",
  "side",
  "amountDollars",
  "maxPrice",
  "decidedAt",
  "decidedByUserId",
];

/**
 * Deterministic `|`-joined payload string. Every consumer must build the exact
 * same string, so this is the one place that composition lives.
 * @param {{ id: string, status: string, agentId: string, ticker: string, side: string, amountDollars: number, maxPrice: number | null, decidedAt: string | null, decidedByUserId: string | null }} p
 * @returns {string}
 */
export function buildDecisionSignaturePayload(p) {
  return [
    p.id,
    p.status,
    p.agentId,
    p.ticker,
    p.side,
    String(p.amountDollars),
    p.maxPrice == null ? "" : String(p.maxPrice),
    p.decidedAt ?? "",
    p.decidedByUserId ?? "",
  ].join("|");
}

/**
 * The canonical HMAC-SHA256 of the decision payload. Pure; the caller supplies
 * the secret (resolved per environment) and owns its own verify/assert wrapper.
 * @param {Parameters<typeof buildDecisionSignaturePayload>[0]} p
 * @param {string} secret
 * @returns {string}
 */
export function computeDecisionSignature(p, secret) {
  return createHmac("sha256", secret).update(buildDecisionSignaturePayload(p)).digest("hex");
}
