// ---------------------------------------------------------------------------
// One-shot DB initializer. Reads schema.sql and applies it.
// Usage:  npm run db:init   (from the server/ folder)
// Safe to run multiple times — every statement uses IF NOT EXISTS.
// ---------------------------------------------------------------------------
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hasDatabase } from "../config.js";
import { getPool, closePool } from "./pool.js";
import { logger } from "../logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  if (!hasDatabase) {
    logger.error("DATABASE_URL is not set. Add your Neon connection string to .env first.");
    process.exit(1);
  }

  const schema = await fs.readFile(path.join(__dirname, "schema.sql"), "utf8");
  const pool = getPool();

  logger.info("Applying schema.sql to the database…");
  await pool.query(schema);
  logger.info("✅ Database initialized (tables: otp_codes, messages).");

  await closePool();
}

main().catch(async (err) => {
  logger.error("DB init failed:", err.message);
  await closePool();
  process.exit(1);
});
