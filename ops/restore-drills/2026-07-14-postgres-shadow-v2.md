# Postgres shadow restore evidence v2 — 2026-07-14

- **Release:** backend code commit `df9b9ef` on production branch `mandate-v3`.
- **Scope:** configured Neon/Postgres shadow source through a dedicated
  `REPEATABLE READ READ ONLY` transaction; no source writes.
- **Source snapshot:** `2026-07-14T23:14:15.596Z`.
- **Clean target:** disposable local PGlite PostgreSQL engine on the Jetson.
- **Schema:** all 7 migrations replayed; all 20 declared public application
  tables covered, with no missing or untracked public table.
- **Backup:** application logical format v2, exact PostgreSQL text plus ordered
  column-type metadata, encrypted at rest with AES-256-GCM and an ephemeral
  in-memory key. Temporary encrypted and restored files were deleted in
  `finally`.
- **Verification:** **PASS**. All 20 table counts and SHA-256 content digests
  matched; every column and signature/HMAC byte, foreign-key-ordered insert, and
  serial sequence verified. Six tables contained data and 28 aggregate rows were
  restored; no per-table production counts or row contents are recorded.
- **Measured RTO:** 6.101 seconds for export, encryption, clean migration,
  restore, and exact verification. RPO is the transaction-consistent snapshot at
  drill start.

The first live v2 attempt at code commit `7e91cc3` failed closed on five table
digests. Investigation showed Neon rendered `TIMESTAMPTZ::text` in GMT while the
PGlite target inherited the Jetson's host timezone; the stored instants were the
same, but their display strings differed. Commit `df9b9ef` canonicalizes both
dedicated digest sessions to UTC. An independent review found the fix clean, the
focused restore suite passed 3/3, the full backend suite passed 713/713, and the
production rerun above passed.

This closes G0.7's application-level logical restore rehearsal. It does not prove
provider-native Neon point-in-time recovery or `pg_dump`/`pg_restore`; that
separate proof remains required before Postgres canonical-read cutover.
