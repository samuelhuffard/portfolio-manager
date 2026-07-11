# ADR 0001 — Postgres as the canonical financial store

- **Status:** PROPOSED (draft — awaiting Sam's provider decision). Cutover is gated on Phase 1 completion; do not start the migration before then.
- **Date:** 2026-07-11
- **Context source:** roadmap Phase 2 ([[portfolio-manager-autonomy-roadmap]] / `docs/AUTONOMY-ROADMAP.md`).

## Context

Financial state today lives in Google Sheets, read/written through `lib/sheets.js`
with multi-call, non-transactional updates, plus Redis for proposals and caches.
The audit found the failure classes this creates: non-atomic writes race
(`/record-trade` → `syncHoldings` overlap), several money-facing reads trust
mutable rows before decision-time verification, and there is no point-in-time
reproducibility or backup/restore story. Roadmap rule #7: "Postgres becomes
canonical; Sheets becomes a one-way reporting export."

This ADR does **not** authorize the cutover. It records the provider choice and
the migration method so the work can start immediately once Phase 1 (the shared
contracts + ownership + one pipeline) is complete and Sam picks a provider.

## Decision to be made by Sam

**Provider: Neon vs Supabase.** Both are serverless Postgres with generous free
tiers and work from the Jetson (Node `pg`) and Vercel.

| | Neon | Supabase |
|---|---|---|
| Core | Pure serverless Postgres, branching | Postgres + auth + storage + realtime |
| Fit here | We only need Postgres; branching is genuinely useful for the shadow-read migration (spin a branch, replay, compare, drop) | We already have Clerk for auth and don't need the extra surface; more moving parts to secure |
| Scale-to-zero | Yes (cold-start latency on the Jetson's always-on process is a non-issue — the connection pools) | Yes |
| Backup/restore | PITR on paid; manual `pg_dump` on free | Daily backups; `pg_dump` on free |
| Lock-in risk | Low — it's plain Postgres | Low for the DB; higher if you adopt its auth/storage |

**Recommendation: Neon.** We need exactly one thing — transactional Postgres — and
Neon's branching directly serves the dual-write/shadow-read migration below.
Supabase's extra surface (its own auth) overlaps Clerk and adds attack surface a
money system shouldn't carry without reason. Either is defensible; this is Sam's call.

Also for Sam: the **always-on executor host** decision (Phase 4) is separate and
does not block this.

## Design (provider-agnostic)

- Schema is generated from the Phase 1 contracts package (`contracts/*.js`), so
  the DB types, the app types, and the wire types have one source. No hand-written
  duplicate of proposal/lot/order shapes.
- Tables: accounts, investors, capital_entries, positions, lots (with
  strategy-lot ownership — `agentId` is already modeled, see `contracts/lot.js`),
  proposals, approvals, orders, fills, snapshots, evidence, risk_snapshots,
  job_runs, audit_events.
- All order/fill/lot/capital mutations use transactions + unique constraints
  (the broker `refId`/`orderId` uniqueness is what kills the double-book class the
  crash-injection tests already exercise).
- Append-only double-entry event ledger for cash, units, trades, fees, corrections.
- Explicit order states: `Approved → Reserved → Submitted → BrokerAccepted →
  Partial → Filled/Cancelled/Rejected → Accounted → Reconciled`.

## Migration method (safe, reversible)

1. Import historical Sheet data with provenance + a verification report.
2. **Dual-write / shadow-read**: writes go to both Sheets (authoritative) and
   Postgres (shadow); reads still come from Sheets. Nothing user-facing changes.
3. Compare NAV, units, positions, lots, cash, realized P&L **daily** for ≥30 days.
4. Cut canonical reads to Postgres only after clean parity.
5. Make Sheets a generated read-only projection; retire its mutation paths.

Exit gate (from the roadmap): 30 calendar days with zero unexplained
broker/Postgres/Sheet differences; crash injection at every boundary produces no
duplicate order or partial book; point-in-time NAV/ownership/lots/realized gains
reproduce exactly; a clean-environment restore passes reconciliation.

## Consequences

- One typed source of financial truth; atomic money mutations; real backups.
- The dual-write period is extra write load and code, but it is the only safe way
  to move a live-money system without a flag-day cutover.
- Prerequisite: the contracts package must cover every migrated object first
  (in progress — proposal/lot/signature/pipeline done; accounting/investor shapes
  still to add).
