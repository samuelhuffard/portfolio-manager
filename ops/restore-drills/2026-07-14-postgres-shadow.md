# Postgres shadow restore evidence — 2026-07-14

> **Superseded:** independent review reproduced numeric rounding in the v1
> JavaScript/JSON export path. This record is retained for audit history but does
> not close G0.7. A type-preserving v2 drill must be rerun against the final
> migration set before release proof is complete.

- **Scope:** the configured Jetson Postgres/Neon shadow source, read through
  `/home/sam/portfolio-manager/.env`; no source writes.
- **Source snapshot:** 2026-07-14T21:01:31.905Z in a `REPEATABLE READ READ ONLY`
  transaction.
- **Backup:** application logical format encrypted at rest with AES-256-GCM and
  an ephemeral in-memory key; the backup and restored database were deleted by
  the drill's `finally` cleanup.
- **Clean target:** disposable local PGlite PostgreSQL engine on the Jetson.
- **Schema:** all 6 applied migrations replayed into a clean database.
- **Coverage:** all 20 declared public application tables; coverage check found
  no missing or untracked public table. Five tables contained data, with 27 rows
  restored in total. No per-table production count or row content is recorded.
- **Verification:** PASS. Exact counts and SHA-256 content digests matched for
  every table, including every HMAC/signature column; foreign-key-ordered inserts
  and serial-sequence reset completed.
- **Measured RTO:** 5.494 seconds for export, encryption, clean migration,
  restore, and verification in this small shadow dataset.
- **Fixture proof:** `tests/pg-restore-drill.test.js` separately proves sequence
  reuse after restore, encrypted-content privacy, authenticated-ciphertext
  tamper rejection, and fail-closed coverage when a new table is unlisted.

The original conclusion that this closed the application-level rehearsal is
withdrawn because the v1 format could round exact numeric values. This record is
historical only. A type-preserving v2 live drill is required for G0.7, and Neon
PITR/`pg_dump` remains a separate pre-canonical-cutover gate.
