// ---------------------------------------------------------------------------
// In-memory working set, persisted to PostgreSQL (see store/persist.js).
//
// Reads are synchronous against the in-memory copy; writes update memory AND
// write through to Postgres. On boot we load everything from the database, so
// data survives restarts. Bootstrap seeds ONLY the product catalog (plans) and
// a single operator account — never fake clients/devices/SIMs/messages.
// ---------------------------------------------------------------------------
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { applySchema, loadAll, upsert, del } from "./persist.js";

export const db = {
  admins: [],
  plans: [],
  tenants: [],
  apiKeys: [],
  devices: [],
  sims: [],
  messages: [],
  transactions: [],
  otps: [],
  contactLists: [],
  campaigns: [],
  hardwareRequests: [],
  waTemplates: [],
};

export const idx = {
  apiKeyByHash: new Map(),
  tenantById: new Map(),
};

export const newId = (prefix) => `${prefix}_${crypto.randomBytes(9).toString("hex")}`;
export const now = () => new Date().toISOString();

function reindex() {
  idx.apiKeyByHash.clear();
  idx.tenantById.clear();
  db.tenants.forEach((t) => idx.tenantById.set(t.id, t));
  db.apiKeys.forEach((k) => idx.apiKeyByHash.set(k.keyHash, k));
}

// --- Mutations (write-through to Postgres) ----------------------------------
export const insert = (coll, row) => {
  db[coll].push(row);
  if (coll === "tenants") idx.tenantById.set(row.id, row);
  if (coll === "apiKeys") idx.apiKeyByHash.set(row.keyHash, row);
  upsert(coll, row);
  return row;
};

export const find = (coll, pred) => db[coll].find(pred);
export const filter = (coll, pred) => db[coll].filter(pred);

export const update = (coll, id, patch) => {
  const row = db[coll].find((r) => r.id === id);
  if (!row) return null;
  Object.assign(row, patch);
  upsert(coll, row);
  return row;
};

export const remove = (coll, id) => {
  const i = db[coll].findIndex((r) => r.id === id);
  if (i === -1) return false;
  const [row] = db[coll].splice(i, 1);
  if (coll === "tenants") idx.tenantById.delete(id);
  if (coll === "apiKeys") idx.apiKeyByHash.delete(row.keyHash);
  del(coll, id);
  return true;
};

// Await persistence of a row — use before inserting FK-dependent child rows so
// the parent is committed first (write-through is otherwise fire-and-forget).
export const save = (coll, row) => upsert(coll, row);

// API key hashing lives here so seeds/middleware share one implementation.
export function hashApiKeyRaw(raw) {
  return crypto.createHmac("sha256", config.auth.apiKeySecret).update(raw).digest("hex");
}

// ---------------------------------------------------------------------------
// Bootstrap: apply schema, load data, ensure plans + operator account exist.
// ---------------------------------------------------------------------------
const DEFAULT_PLANS = [
  { name: "Free", slug: "free", priceCents: 0, monthlyQuota: 100, rateLimitPerMin: 5, maxSims: 1,
    features: ["1 SIM", "100 messages / mo", "OTP + SMS API", "Community support"] },
  { name: "Starter", slug: "starter", priceCents: 9900, monthlyQuota: 2000, rateLimitPerMin: 30, maxSims: 2,
    features: ["2 SIMs", "2,000 messages / mo", "Delivery reports", "Email support"] },
  { name: "Growth", slug: "growth", priceCents: 19900, monthlyQuota: 10000, rateLimitPerMin: 120, maxSims: 5,
    popular: true, features: ["5 SIMs", "10,000 messages / mo", "Webhooks", "Priority support", "99.9% SLA"] },
  { name: "Scale", slug: "scale", priceCents: 39900, monthlyQuota: 50000, rateLimitPerMin: 600, maxSims: 20,
    features: ["20 SIMs", "50,000 messages / mo", "Dedicated numbers", "24/7 support", "Custom SLA"] },
];

export async function bootstrap() {
  await applySchema();

  const data = await loadAll();
  for (const key of Object.keys(db)) db[key] = data[key] || [];
  db.messages.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  reindex();
  logger.info(
    `[store] loaded from Postgres — ${db.tenants.length} clients, ${db.devices.length} devices, ` +
      `${db.sims.length} SIMs, ${db.messages.length} messages`,
  );

  // Ensure the product catalog exists.
  if (db.plans.length === 0) {
    DEFAULT_PLANS.forEach((p) => insert("plans", { id: newId("plan"), createdAt: now(), popular: false, ...p }));
    logger.info("[store] seeded default plans");
  }

  // Ensure an operator account exists (configurable via env).
  if (db.admins.length === 0) {
    const email = (process.env.ADMIN_EMAIL || "admin@smsgateway.io").toLowerCase();
    const password = process.env.ADMIN_PASSWORD || "admin123";
    insert("admins", {
      id: newId("adm"), email, name: process.env.ADMIN_NAME || "Operator",
      passwordHash: bcrypt.hashSync(password, 10), createdAt: now(),
    });
    logger.info(`[store] created operator account: ${email}`);
  }
}
