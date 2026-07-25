# Neon/Sheets proposal-parity repair readiness

## Current finding — 2026-07-25

A production read-only parity check found matching transactional accounting,
capital entries, lots, and position inventory. Proposal inventory diverged even
though both stores retained 15 records. A redacted, canonical field comparison
reduced the genuine difference to one proposal whose approval lifecycle fields
were current in authoritative Redis and stale in the Neon shadow.

This is a shadow-data repair finding, not permission to change canonical reads.
Sheets and Redis remain authoritative.

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
