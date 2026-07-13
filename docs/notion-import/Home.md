# Portfolio Manager — Brain

> **Current phase:** Phase 0 — Stabilize the live supervised system

> **Authority:** Sam approves every live order. All four v3 mandates are trusted launch-candidate specifications. Agents 2 and 3 remain paper/propose-only and Agent 4 remains shadow-only until runtime-promotion gates are met. No Notion page can approve or execute a trade.

## Current status — 2026-07-12

- Jetson backend is live on `e4e173e`; the Mac companion is live on `6dc8a3f`.
- MCP read-sync replaced the unsupported unattended Robinhood login. The 2026-07-11 read-only smoke passed holdings and reconciliation.
- Ownership/contracts are live. Unattributed legacy lots are quarantined; `ENFORCE_OWNERSHIP=false` is the explicit emergency rollback.
- **Neon Postgres migration is active:** `PG_DUAL_WRITE=true`, migrations and financial backfill are in place, and daily fail-closed parity governs the shadow-read period. Sheets/Redis remain the authoritative operational path only until the explicit canonical-read cutover gate; the target state is Postgres canonical accounting with Sheets as a read-only reporting projection.
- The 10-trading-day Phase 0 observation window begins with the next clean trading day. It needs at least three genuine actionable proposals and one evaluator approval, not merely quiet uptime.

## This window’s proof targets

| Signal | Required evidence |
| --- | --- |
| Operational stability | 10 consecutive trading days without a missed critical job, ambiguous fill, manual ledger repair, hidden failure, or unsafe client exposure |
| Throughput | At least 3 genuine actionable proposals and 1 evaluator APPROVE |
| Monitoring | Every holding monitored even if quote sources fail |
| Truth agreement | Dashboard, health, logs, and reconciliation agree |

## Current blockers and decisions

- Rebuild the stale 2026-07-10 FIXLIST from fresh production evidence; it contains a large log-clustering echo, not 88 independent incidents.
- Confirm the dashboard’s Vercel production deployment is at `d56911e` before claiming the latest dashboard changes are live.
- Review and decide ADR-0002: scoped service identities vs. a shared bearer secret.
- Obtain final policy sign-off for the permanent unattributed-lot treatment: quarantine by default, signed assignment only when explicitly reconciled.
- Integrate the trusted v3 mandates into runtime configuration, deterministic scoring, evaluator coverage, and ownership tests. The inert peer/EDGAR scoring foundation must stay off until promotion gates are met; trusted mandate quality does not itself grant execution authority.

## Workspace rules

1. Notion is a planning surface, never an execution surface.
2. Repo documents and the vault are canonical; this page reports verified state.
3. Missing, stale, ambiguous, unsigned, or inconsistent state blocks action loudly.
4. Agents propose; Agent 4 only accepts/rejects exact specialist proposals in shadow mode; Sam retains approval authority.

## Navigation

- **Roadmap** — Phase 0–9 and exit gates
- **Architecture** — control flow, truth stores, and non-negotiable invariants
- **Decisions / ADR log** — choices requiring ownership and rationale
- **Journey / Timeline** — the build story and major milestones
- **Open items** — immediately actionable, deduplicated work
- **Mandates** — plain-language review pages for Agents 1–4
- **Knowledge graph** — graphify guide and report location
