// ---------------------------------------------------------------------------
// PostgreSQL (Neon) connection pool.
//
// Neon works with the standard `pg` driver over a connection string. The
// `?sslmode=require` in the Neon URL is enough, but we also set ssl options
// explicitly so it works regardless of how the URL is formatted.
//
// The pool is created lazily and only if DATABASE_URL is set, so the whole
// app runs fine with NO database at all (in-memory mode).
// ---------------------------------------------------------------------------
import pg from "pg";
import { config, hasDatabase } from "../config.js";
import { logger } from "../logger.js";

let pool = null;

export function getPool() {
  if (!hasDatabase) return null;
  if (pool) return pool;

  pool = new pg.Pool({
    connectionString: config.database.url,
    ssl: { rejectUnauthorized: false },
    max: 5,
    idleTimeoutMillis: 30_000,
  });

  pool.on("error", (err) => {
    logger.error("[db] unexpected pool error:", err.message);
  });

  return pool;
}

// Convenience query helper.
export async function query(text, params) {
  const p = getPool();
  if (!p) throw new Error("Database is not configured (DATABASE_URL is empty).");
  return p.query(text, params);
}

export async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
