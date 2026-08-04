# ADR 0001 — Postgres as the canonical financial store

- **Status:** ACCEPTED — provider = **Neon** (Sam, 2026-07-11). A non-authoritative dual-write/shadow foundation now exists, but canonical-read cutover remains prohibited until the master plan's contract, 30-day parity, restore, and crash gates pass.
- **Date:** 2026-07-11
- **Decision rationale:** we need exactly one thing — transactional Postgres. Auth stays with Clerk (dedicated auth beats a bundled one; RLS remains available on Neon if per-user row isolation is ever needed). Neon's branching directly serves the shadow-read migration. Auth and DB decisions are independent and were kept so.
- **Context source:** roadmap Phase 2 ([[portfolio-manager-autonomy-roadmap]] / `docs/roadmaps/AUTONOMY-ROADMAP.md`).

## Context

Financial state today lives in Google Sheets, read/written through `lib/sheets.js`
with multi-call, non-transactional updates, plus Redis for proposals and caches.
The audit found the failure classes this creates: non-atomic writes race
(`/record-trade` → `syncHoldings` overlap), several money-facing reads trust
mutable rows before decision-time verification, and there is no point-in-time
reproducibility or backup/restore story. Roadmap rule #7: "Postgres becomes
canonical; Sheets becomes a one-way reporting export."

This ADR does **not** authorize the cutover. It records the provider choice and
migration method. The implemented shadow foundation remains replaceable and
non-authoritative until the master plan's later gates pass.

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
3. Compare NAV, units, transactional positions, lots, cash, and realized P&L
   **daily** for ≥30 days. Transactional position truth is ticker/name/shares/
   average cost/cost basis at the schema's canonical precision. Report
   quote-derived market value separately; compare it exactly only when both
   stores identify the same versioned quote snapshot, source, and source
   timestamp. Otherwise classify it as non-comparable or a provenance/freshness
   mismatch without claiming an accounting divergence.
   The gate-closing shadow implementation mirrors the latest signed Performance
   projection plus current Holdings cash into `nav_snapshots` and compares that
   snapshot exactly; this is still shadow evidence, not canonical-read authority.
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
- Prerequisite: the contracts package must cover every migrated object first.
  Proposal, lot, pipeline, accounting, investor, position, and NAV snapshot
  shapes now exist; remaining objects still require contracts before migration.
