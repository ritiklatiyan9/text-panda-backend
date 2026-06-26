// ---------------------------------------------------------------------------
// Postgres persistence for the in-memory working set.
//
// The app keeps a fast in-memory copy of every record (store/db.js) and uses
// this module to (a) load all rows on boot and (b) write through on every
// mutation. This gives durable storage that survives restarts without turning
// every read into async SQL. For a single-process gateway serving hundreds of
// tenants this working-set model is both simple and fast.
// ---------------------------------------------------------------------------
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getPool } from "../db/pool.js";
import { logger } from "../logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const camelToSnake = (s) => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
const snakeToCamel = (s) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());

// collection key -> { table, cols (camelCase), json (camelCase cols stored as JSONB) }
export const SPECS = {
  admins: { table: "admins", cols: ["id", "email", "name", "passwordHash", "createdAt"], json: [] },
  plans: {
    table: "plans",
    cols: ["id", "name", "slug", "priceCents", "monthlyQuota", "rateLimitPerMin", "maxSims", "features", "popular", "createdAt"],
    json: ["features"],
  },
  tenants: {
    table: "tenants",
    cols: ["id", "name", "company", "email", "passwordHash", "status", "planId", "subscriptionStatus", "razorpayCustomerId", "razorpaySubscriptionId", "whatsappPhoneId", "whatsappToken", "whatsappEnabled", "periodStart", "periodEnd", "createdAt"],
    json: [],
  },
  apiKeys: {
    table: "api_keys",
    cols: ["id", "tenantId", "name", "prefix", "last4", "keyHash", "revoked", "lastUsedAt", "createdAt"],
    json: [],
  },
  devices: {
    table: "devices",
    cols: ["id", "name", "model", "gatewayUrl", "username", "password", "dryRun", "status", "ownerTenantId", "lastSeenAt", "createdAt"],
    json: [],
  },
  sims: {
    table: "sims",
    cols: ["id", "deviceId", "slot", "phoneNumber", "carrier", "label", "status", "tenantId", "createdAt"],
    json: [],
  },
  messages: {
    table: "messages",
    cols: ["id", "tenantId", "simId", "deviceId", "gatewayId", "type", "recipients", "text", "state", "segments", "costCents", "dryRun", "error", "createdAt"],
    json: [],
  },
  transactions: {
    table: "transactions",
    cols: ["id", "tenantId", "planId", "planName", "amountCents", "currency", "status", "provider", "razorpayOrderId", "razorpayPaymentId", "description", "createdAt"],
    json: [],
  },
  otps: {
    table: "otp_codes",
    cols: ["id", "tenantId", "phoneNumber", "codeHash", "requestId", "attempts", "lastSentAt", "expiresAt"],
    json: [],
  },
  contactLists: {
    table: "contact_lists",
    cols: ["id", "tenantId", "name", "columns", "contactCount", "createdAt"],
    json: ["columns"],
  },
  campaigns: {
    table: "campaigns",
    cols: ["id", "tenantId", "name", "channel", "message", "waMode", "waTemplate", "waLanguage", "listId", "status", "total", "sent", "failed", "ratePerMin", "statusReason", "createdAt", "startedAt", "completedAt"],
    json: [],
  },
  hardwareRequests: {
    table: "hardware_requests",
    cols: ["id", "tenantId", "deviceName", "model", "gatewayUrl", "username", "password", "phoneNumber", "carrier", "status", "platformFeeCents", "statusReason", "deviceId", "simId", "createdAt", "reviewedAt"],
    json: [],
  },
  waTemplates: {
    table: "wa_templates",
    cols: ["id", "tenantId", "name", "category", "metaCategory", "language", "body", "variables", "status", "createdAt"],
    json: [],
  },
};

function toDbValue(spec, col, value) {
  if (spec.json.includes(col)) return JSON.stringify(value ?? null);
  if (value instanceof Date) return value.toISOString();
  return value === undefined ? null : value;
}

function fromDbRow(spec, row) {
  const out = {};
  for (const [snake, val] of Object.entries(row)) {
    const camel = snakeToCamel(snake);
    out[camel] = val instanceof Date ? val.toISOString() : val;
  }
  return out;
}

// Apply schema once. On first migration (no tenants table) drops the old
// single-tenant tables whose shape is incompatible with the new schema.
export async function applySchema() {
  const pool = getPool();
  const schema = await fs.readFile(path.join(__dirname, "..", "db", "schema.sql"), "utf8");
  const { rows } = await pool.query("select to_regclass('public.tenants') as t");
  if (!rows[0].t) {
    logger.warn("[persist] first migration — dropping old single-tenant tables (messages, otp_codes)");
    await pool.query("DROP TABLE IF EXISTS messages CASCADE; DROP TABLE IF EXISTS otp_codes CASCADE;");
  }
  await pool.query(schema);
}

export async function loadAll() {
  const pool = getPool();
  const data = {};
  for (const [key, spec] of Object.entries(SPECS)) {
    const { rows } = await pool.query(`SELECT * FROM ${spec.table}`);
    data[key] = rows.map((r) => fromDbRow(spec, r));
  }
  return data;
}

// Upsert a full row (used for both insert and update — the in-memory row is the
// source of truth and already merged).
export function upsert(key, row) {
  const spec = SPECS[key];
  if (!spec) return Promise.resolve();
  // Only persist columns that are actually set — omitted columns fall back to
  // their DB defaults on insert (and are left untouched on update).
  const cols = spec.cols.filter((c) => c === "id" || row[c] !== undefined);
  const snakeCols = cols.map(camelToSnake);
  const values = cols.map((c) => toDbValue(spec, c, row[c]));
  const placeholders = cols.map((_, i) => `$${i + 1}`);
  const updates = snakeCols.filter((c) => c !== "id").map((c) => `${c} = EXCLUDED.${c}`);
  const sql = `INSERT INTO ${spec.table} (${snakeCols.join(", ")}) VALUES (${placeholders.join(", ")})
    ON CONFLICT (id) DO UPDATE SET ${updates.join(", ")}`;
  return getPool()
    .query(sql, values)
    .catch((err) => logger.error(`[persist] upsert ${spec.table} failed: ${err.message}`));
}

export function del(key, id) {
  const spec = SPECS[key];
  if (!spec) return Promise.resolve();
  return getPool()
    .query(`DELETE FROM ${spec.table} WHERE id = $1`, [id])
    .catch((err) => logger.error(`[persist] delete ${spec.table} failed: ${err.message}`));
}
