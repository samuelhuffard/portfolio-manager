// Postgres (Neon) client. Phase 2 scaffold — canonical store per ADR 0001.
// Gracefully absent when DATABASE_URL is unset (mirrors getRedis), so importing
// this never forces a DB on an environment that doesn't have one. Nothing in the
// money path reads from Postgres yet; this exists for the dual-write/shadow-read
// migration, which is gated on Phase 1 and OFF by default.

import pg from "pg";

let _pool = null;

export function getPool() {
  if (_pool) return _pool;
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) return null; // no DB configured here — skip gracefully
  _pool = new pg.Pool({
    connectionString,
    max: 4,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
  _pool.on("error", (err) => console.error("[pg] idle client error:", err.message));
  return _pool;
}

/** True when a Postgres connection is configured in this environment. */
export function pgConfigured() {
  return Boolean(process.env.DATABASE_URL?.trim());
}

export async function pgQuery(text, params = []) {
  const pool = getPool();
  if (!pool) throw new Error("DATABASE_URL is not configured — cannot query Postgres.");
  return pool.query(text, params);
}

/** Run `fn(client)` inside a transaction; commits on success, rolls back on throw. */
export async function pgTransaction(fn) {
  const pool = getPool();
  if (!pool) throw new Error("DATABASE_URL is not configured — cannot open a transaction.");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function closePool() {
  if (_pool) {
    await _pool.end();
    _pool = null;
  }
}
