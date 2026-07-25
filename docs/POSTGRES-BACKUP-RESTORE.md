# Postgres backup and restore drill

This runbook owns only the backup/restore evidence for the Postgres shadow store.
The promotion sequence and current status remain authoritative in
`docs/roadmaps/portfolio-master-plan.md`.

## What is proved now

`npm test -- tests/pg-restore-drill.test.js` creates two disposable local
Postgres databases using PGlite's real PostgreSQL engine. It applies every SQL
migration to the source, writes representative financial, proposal, signed-row,
position, and job data, encrypts a transaction-consistent logical snapshot with
AES-256-GCM, applies the migrations to a clean target, restores every covered
table in foreign-key order, resets serial sequences, and compares exact row
counts and SHA-256 content digests. The test also proves that tampered ciphertext
is rejected and that an unlisted new public table makes backup coverage fail.
Every cell is exported as PostgreSQL text alongside ordered column type metadata;
`NUMERIC` values never pass through JavaScript binary floating point, and restore
fails closed if the target column types differ from the backup.

This is a credible clean-environment application restore rehearsal. It is not a
claim that Neon's provider-native point-in-time recovery or a `pg_dump` artifact
has been restored. Those require either a disposable Neon branch credential or
PostgreSQL client/server tooling, neither of which is configured on the Mac or
Jetson today.

The same v2 path passed against the configured production shadow source after all
seven live migrations on 2026-07-14. The privacy-safe evidence is
[Postgres shadow restore evidence v2](../ops/restore-drills/2026-07-14-postgres-shadow-v2.md).
The first live attempt usefully failed closed because Neon and PGlite rendered
identical `TIMESTAMPTZ` instants in different session timezones; both dedicated
digest sessions now canonicalize to UTC, with a regression test covering the
production topology.

## Read-only drill against the configured database

Run only from a trusted host whose `DATABASE_URL` points to the intended source:

```sh
npm run db:restore-drill
```

The source transaction is `REPEATABLE READ READ ONLY`. The target is a disposable
local PGlite database under the OS temporary directory. The backup is encrypted
at rest with an ephemeral in-memory key, never prints row contents, and the
temporary encrypted backup and restored database are deleted in `finally`.
The command prints a privacy-safe proof containing only aggregate counts, RPO,
RTO, and pass/fail. Use `--manifest=/trusted/private/path/proof.json` only when a
restricted local evidence file is required; it is created mode `0600`.

Exit code `0` means all migrations, covered table counts, row digests, HMAC/signature
bytes, foreign keys, and sequences survived the restore. Any schema coverage gap,
read error, migration mismatch, decryption error, insert error, or digest mismatch
fails closed with a nonzero exit.

## Provider-native gate

Before Postgres can become canonical, separately prove one of these in a disposable
Neon branch:

1. restore a provider snapshot/PITR point and run the same count/digest verification; or
2. produce an encrypted custom-format `pg_dump`, restore it with `pg_restore`, then
   run parity and ledger-signature verification.

Record the private proof with source snapshot time (RPO), restore duration (RTO),
Neon branch ID, migration revision, and verification result. Never commit the
database URL, backup, encryption key, investor data, holdings, proposal rationale,
or per-table production counts.
