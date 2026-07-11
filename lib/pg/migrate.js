// Idempotent migration runner. Applies db/migrations/*.sql in filename order,
// each inside a transaction, tracking applied files in a _migrations table so a
// re-run is a no-op. `npm run db:migrate`.

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { getPool, pgConfigured, closePool } from "./client.js";

const migrationsDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../db/migrations");

async function ensureMigrationsTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      filename   TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

export async function runMigrations({ log = console.log } = {}) {
  if (!pgConfigured()) {
    throw new Error("DATABASE_URL is not configured — cannot run migrations.");
  }
  const pool = getPool();
  await ensureMigrationsTable(pool);

  const applied = new Set((await pool.query("SELECT filename FROM _migrations")).rows.map((r) => r.filename));
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();

  const ran = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(migrationsDir, file), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO _migrations (filename) VALUES ($1)", [file]);
      await client.query("COMMIT");
      log(`applied ${file}`);
      ran.push(file);
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw new Error(`migration ${file} failed (rolled back): ${err.message}`);
    } finally {
      client.release();
    }
  }
  if (ran.length === 0) log("no pending migrations — schema up to date.");
  return ran;
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  (await import("dotenv")).config();
  runMigrations()
    .then(() => closePool())
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err.message);
      process.exit(1);
    });
}
