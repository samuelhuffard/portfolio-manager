# Neon/Sheets proposal-parity repair readiness

## Current finding — 2026-07-25

A production read-only parity check found matching transactional accounting,
capital entries, lots, and position inventory. Proposal inventory diverged even
though both stores retained 15 records. A redacted, canonical field comparison
reduced the genuine difference to one proposal whose approval lifecycle fields
were current in authoritative Redis and stale in the Neon shadow.

This is a shadow-data repair finding, not permission to change canonical reads.
Sheets and Redis remain authoritative.

## Durable lifecycle delivery

The dashboard's immediate lifecycle callback remains best-effort so it can never
roll back an authoritative approval. The Jetson now has a bounded reconciliation
job before nightly parity: it replays the current authoritative proposal set into
Neon, retains an aggregate-only receipt at
`pm:proposal-shadow-reconcile:latest`, and fails loudly if any mirror write
fails. This is the retry path; parity remains the independent proof that it
actually converged.

## Comparable valuation

The MCP Holdings writer previously persisted broker prices without a complete,
timestamped provider quote set, so it could not safely claim valuation parity.
It now uses one held-ticker provider quote set to value the Holdings projection
and saves that content-bound identity with both the Sheet and Neon projections.
If a held quote or provider timestamp is absent, the broker projection still
writes but valuation remains explicitly non-comparable; no synthetic freshness
marker is invented.

## Repair procedure (after a separately approved repair window)

1. Run `npm run db:repair-proposals` on the Jetson. It is preview-only, prints
   counts and changed field names only, and exits nonzero without writing.
2. Review the preview. A nonzero result is evidence; do not suppress it.
3. Run `npm run db:repair-proposals -- --apply` only with `PG_DUAL_WRITE=true`.
   It rewrites Neon from the current authoritative Redis proposal objects and
   cannot write Redis, Google Sheets, broker state, or orders.
4. Require the final full `db:parity` report to be `MATCH`. A proposal repair
   does not override unrelated accounting or valuation evidence.
5. Record the repair and restart the zero-unexplained-difference window. Any
   future lifecycle divergence is a new incident, not a reason to auto-heal
   silently.

## Canonical-read readiness remains blocked on

- 30 calendar days of zero unexplained broker/Sheets/Neon differences;
- comparable valuation state with a shared quote snapshot version, source, and
  timestamp;
- a provider-native Neon recovery proof in a disposable branch (PITR or
  encrypted `pg_dump`/`pg_restore` plus parity and ledger verification);
- reviewed reader cutover, rollback, and cross-runtime contract proof.

The complete staged release, failure-injection, and rollback procedure is in
[NEON-CANONICAL-CUTOVER-RUNBOOK.md](NEON-CANONICAL-CUTOVER-RUNBOOK.md).
