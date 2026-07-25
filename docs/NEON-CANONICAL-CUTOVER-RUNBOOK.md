# Neon canonical cutover runbook

> This is a promotion gate, not an authorization to switch reads or writes.
> Sheets and Redis remain authoritative until every gate below is independently
> evidenced and Sam approves the exact release.

## Required evidence

1. **Delivery:** the latest `pm:proposal-shadow-reconcile:latest` receipt is
   `ok:true`, with zero failed records.
2. **Truth:** 30 consecutive calendar days of `db-parity` records are clean and
   valuation is `EXACT_MATCH`, not merely `NON_COMPARABLE`.
3. **Recovery:** a disposable Neon branch has a verified provider-native PITR or
   encrypted `pg_dump`/`pg_restore` proof. Verify migrations, row digests,
   ledger HMAC/signature bytes, foreign keys, and sequences. Record only the
   sanitized proof metadata in the private release record.
4. **Writer coverage:** proposals, decisions, fills, lots, capital entries,
   NAV snapshots, positions, broker reconciliation, corrections, and expired
   proposals each have an idempotent Neon write path plus a test.
5. **Rollback:** inject a Neon unavailable/write-timeout, Sheets export failure,
   and process restart. Each must preserve one broker order, one ledger event,
   and an explicit reconciliation finding; none may double-execute or silently
   drop an authoritative record.

## Staged cutover

1. Deploy readers that can read both current canonical state and Neon, with no
   behavior change. Keep current sources authoritative.
2. Canary only a read-only dashboard projection against Neon and compare it to
   the current source on every request. Do not point the executor at Neon.
3. Promote Neon writes transactionally for one bounded non-broker accounting
   path. Sheets becomes a post-commit reporting projection; failed projection
   delivery enters a durable retry/reconciliation record rather than rolling
   back a committed ledger event.
4. Promote each remaining writer only after its own replay, parity, and
   rollback evidence is clean. Broker execution stays on its signed,
   ref-idempotent path throughout.
5. Retire canonical Sheet writes only after an explicit final review. Preserve
   Sheets as read-only reporting/export and retain historical reconciliation.

## Immediate rollback

Set the reviewed reader/writer flags back to their prior source, stop new
canonical writes, and retain all Neon records for forensic comparison. Never
delete or hand-edit a ledger row. Investigate through broker receipt, signed
ledger verification, and the reconciliation queue; append a correcting event
only when the evidence requires it.

## Ownership

- Sam: approves each production stage and any rollback.
- Backend owner: runs migration, parity, recovery, and rollback proof.
- Dashboard/companion owner: verifies contract compatibility and read-only
  projection behavior.
- Independent reviewer: signs off on the evidence packet before each stage.

## Current external prerequisites — 2026-07-25

The Jetson has `DATABASE_URL` but no Neon management API credential and no
`pg_dump`/`pg_restore` client. Do not substitute the application-level PGlite
restore drill for provider recovery. Obtain a scoped Neon branch/PITR capability
or install the PostgreSQL client under an approved operations change, then run
the recovery proof above against a disposable branch.
