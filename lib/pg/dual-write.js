// Dual-write shadow layer (ADR 0001, migration step 2). While Sheets/Redis stay
// authoritative, these mirror money objects into Postgres so we can compare the
// two for 30 days before cutting canonical reads over.
//
// Two hard invariants:
//   1. OFF by default. Nothing writes to Postgres unless PG_DUAL_WRITE=true AND
//      DATABASE_URL is set. A machine without the flag behaves exactly as today.
//   2. A shadow write must NEVER throw into the money path. The authoritative
//      Sheets/Redis write is the source of truth; a Postgres hiccup logs and is
//      swallowed. (Parity checking, not the write, is what surfaces divergence.)
//
// Each object is validated against its shared contract before insert, so a
// malformed shadow row fails here (logged) instead of silently diverging. Inserts
// are idempotent (ON CONFLICT DO NOTHING) so a replay never double-writes.

import { getPool, pgConfigured } from "./client.js";
import { ProposalSchema } from "../../contracts/proposal.js";
import { StrategyLotSchema } from "../../contracts/lot.js";
import { InvestorLedgerEntrySchema } from "../../contracts/accounting.js";

export function dualWriteEnabled() {
  return pgConfigured() && process.env.PG_DUAL_WRITE?.trim() === "true";
}

// Wraps a shadow write: no-op when disabled, never throws, logs on failure.
async function shadow(label, fn) {
  if (!dualWriteEnabled()) return { ok: false, skipped: true };
  try {
    await fn(getPool());
    return { ok: true };
  } catch (err) {
    console.error(`[pg dual-write] ${label} shadow write failed (authoritative write unaffected): ${err.message}`);
    return { ok: false, error: err.message };
  }
}

// Bridge legacy Redis proposal rows to the canonical shape for the shadow copy.
// Old rows (created before these fields existed) carry `fulfilledTradeId` and
// lack `fulfilledOrderId`/`fulfilledShares`/`decisionHmac` — the exact
// cross-repo drift the contracts package exists to end. We normalize at the
// migration boundary (map tradeId->orderId, absent nullable fields -> null) so
// the canonical ProposalSchema stays strict rather than loosened to fit history.
function normalizeLegacyProposal(p) {
  return {
    ...p,
    fulfilledOrderId: p.fulfilledOrderId ?? p.fulfilledTradeId ?? null,
    fulfilledShares: p.fulfilledShares ?? null,
    decisionHmac: p.decisionHmac ?? null,
    decidedAt: p.decidedAt ?? null,
    decidedByUserId: p.decidedByUserId ?? null,
    decisionNote: p.decisionNote ?? null,
    createdByEmail: p.createdByEmail ?? null,
    fulfilledAt: p.fulfilledAt ?? null,
    // Legacy terminal (Rejected/Expired) rows predate expiresAt; it's meaningless
    // for a decided proposal, and the column is NOT NULL, so fall back to its last
    // timestamp for the shadow copy.
    expiresAt: p.expiresAt ?? p.updatedAt ?? p.createdAt,
  };
}

export async function shadowWriteProposal(proposal) {
  return shadow("proposal", async (pool) => {
    const p = ProposalSchema.parse(normalizeLegacyProposal(proposal));
    await pool.query(
      `INSERT INTO proposals
         (id, agent_id, ticker, side, amount_dollars, max_price, rationale, risk_summary,
          status, thesis, kill_criteria, horizon_days, created_by_user_id, created_by_email,
          decided_at, decided_by_user_id, decision_note, decision_hmac, created_at, updated_at, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
       ON CONFLICT (id) DO NOTHING`,
      [
        p.id, p.agentId, p.ticker, p.side, p.amountDollars, p.maxPrice, p.rationale, p.riskSummary,
        p.status, null, null, null, p.createdByUserId, p.createdByEmail,
        p.decidedAt, p.decidedByUserId, p.decisionNote, p.decisionHmac, p.createdAt, p.updatedAt, p.expiresAt,
      ]
    );
  });
}

export async function shadowWriteLot(lot) {
  return shadow("lot", async (pool) => {
    const l = StrategyLotSchema.parse(lot);
    const owner = l.agentId === "unattributed" ? null : l.agentId;
    await pool.query(
      `INSERT INTO lots
         (lot_id, ticker, owner_agent_id, open_date, cost_per_share, shares_original, shares_open, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (lot_id) DO NOTHING`,
      [l.lotId, l.ticker, owner, l.openDate, l.costPerShare, l.sharesOriginal, l.sharesOpen, l.status]
    );
  });
}

export async function shadowWriteCapitalEntry(entry) {
  return shadow("capital_entry", async (pool) => {
    const e = InvestorLedgerEntrySchema.parse(entry);
    // Investor must exist first (shadow only; FK is nullable-safe via upsert).
    await pool.query(
      `INSERT INTO investors (investor_id, email, name) VALUES ($1,$2,$3)
       ON CONFLICT (investor_id) DO NOTHING`,
      [e.investorId, e.email, e.name]
    );
    await pool.query(
      `INSERT INTO capital_entries
         (entry_id, investor_id, entry_date, type, amount, nav_per_unit, units, row_hmac)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (entry_id) DO NOTHING`,
      [e.entryId, e.investorId, e.date, e.type, e.amount, e.navPerUnit, e.units, e.rowHmac]
    );
  });
}
