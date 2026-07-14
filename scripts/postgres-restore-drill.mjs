import "dotenv/config";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { PGlite } from "@electric-sql/pglite";
import {
  applyMigrations,
  decryptSnapshot,
  encryptSnapshot,
  exportLogicalSnapshot,
  privacySafeManifest,
  restoreLogicalSnapshot,
  verifyRestoredSnapshot,
} from "../lib/pg/restore-drill.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = join(root, "db/migrations");
const databaseUrl = process.env.DATABASE_URL?.trim();
const manifestPath = process.argv.find((arg) => arg.startsWith("--manifest="))?.slice("--manifest=".length);

if (!databaseUrl) {
  console.error("DATABASE_URL is required. The drill is read-only against its source and restores only into a disposable local database.");
  process.exit(2);
}

const startedAt = Date.now();
const workDir = await mkdtemp(join(tmpdir(), "portfolio-pg-restore-"));
const pool = new pg.Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 10_000 });
let sourceClient;
let target;

try {
  sourceClient = await pool.connect();
  await sourceClient.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
  const snapshot = await exportLogicalSnapshot(sourceClient);
  await sourceClient.query("COMMIT");
  sourceClient.release();
  sourceClient = null;

  const encrypted = encryptSnapshot(snapshot);
  const encryptedPath = join(workDir, "backup.enc");
  await writeFile(encryptedPath, encrypted.envelope, { mode: 0o600 });
  const decrypted = decryptSnapshot(await import("node:fs/promises").then(({ readFile }) => readFile(encryptedPath)), encrypted.key);

  target = new PGlite(join(workDir, "restored"));
  await applyMigrations(target, migrationsDir);
  await restoreLogicalSnapshot(target, decrypted);
  const verification = await verifyRestoredSnapshot(target, decrypted);
  if (!verification.ok) {
    const tables = verification.failures.map((failure) => failure.table).join(", ");
    throw new Error(`restore verification failed for ${verification.failures.length} table(s): ${tables}`);
  }

  const manifest = privacySafeManifest(
    snapshot,
    verification,
    { totalMs: Date.now() - startedAt },
    "configured-postgres-read-only"
  );
  if (manifestPath) await writeFile(resolve(manifestPath), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify(manifest));
} catch (error) {
  if (sourceClient) await sourceClient.query("ROLLBACK").catch(() => {});
  console.error(`restore drill failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  sourceClient?.release();
  await pool.end().catch(() => {});
  await target?.close().catch(() => {});
  await rm(workDir, { recursive: true, force: true });
}

if (process.exitCode) process.exit(process.exitCode);
