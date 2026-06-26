// Client portal API (dashboard session, role=client).
import { Router } from "express";
import { z } from "zod";
import { validateBody, sendSmsSchema, sendOtpSchema, verifyOtpSchema } from "../middleware/validate.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { generateApiKey } from "../auth/tokens.js";
import { db, filter, insert, newId, now, update, remove } from "../store/db.js";
import { dailySeries, tenantSummary } from "../services/usage.js";
import { sendForTenant } from "../services/messaging.js";
import { sendOtp, verifyOtp } from "../services/otpService.js";
import { requestPlan } from "../services/billing.js";
import { createList, deleteList, createCampaign, controlCampaign } from "../services/bulk.js";
import { requestHardware, DEFAULT_PLATFORM_FEE_CENTS } from "../services/hardware.js";
import { WA_TEMPLATE_CATALOG, WA_CATEGORIES } from "../data/waTemplates.js";
import * as bulkRepo from "../store/bulkRepo.js";
import { publicTenant, publicKey, publicSim, publicMessage, publicPlan, publicTransaction, publicList, publicCampaign, publicHardware, publicWaTemplate } from "./serializers.js";
import { paginate } from "./pagination.js";

export const clientRouter = Router();
clientRouter.use(requireAuth, requireRole("client"));

// --- Overview / dashboard ---
clientRouter.get("/overview", (req, res) => {
  const t = req.user;
  const summary = tenantSummary(t);
  const msgs = filter("messages", (m) => m.tenantId === t.id);
  const delivered = msgs.filter((m) => m.state === "Delivered").length;
  res.json({
    ok: true,
    summary: publicTenant(t),
    stats: {
      totalMessages: msgs.length,
      delivered,
      deliveryRate: msgs.length ? Math.round((delivered / msgs.length) * 100) : 0,
      activeSims: summary.sims,
      apiKeys: filter("apiKeys", (k) => k.tenantId === t.id && !k.revoked).length,
    },
    series: dailySeries(t.id, 14),
    recent: msgs.slice(0, 6).map(publicMessage),
  });
});

// --- API keys ---
clientRouter.get("/api-keys", (req, res) => {
  res.json({ ok: true, keys: filter("apiKeys", (k) => k.tenantId === req.user.id).map(publicKey) });
});

clientRouter.post("/api-keys", validateBody(z.object({ name: z.string().trim().min(1).max(60) })), (req, res) => {
  const gen = generateApiKey();
  const key = insert("apiKeys", {
    id: newId("key"), tenantId: req.user.id, name: req.body.name,
    prefix: gen.prefix, last4: gen.last4, keyHash: gen.keyHash,
    createdAt: now(), lastUsedAt: null, revoked: false,
  });
  // Return the raw key ONCE.
  res.status(201).json({ ok: true, key: publicKey(key), secret: gen.raw });
});

clientRouter.delete("/api-keys/:id", (req, res) => {
  const key = db.apiKeys.find((k) => k.id === req.params.id && k.tenantId === req.user.id);
  if (!key) return res.status(404).json({ ok: false, error: "Key not found" });
  update("apiKeys", key.id, { revoked: true });
  res.json({ ok: true });
});

// --- SIMs assigned to this client ---
clientRouter.get("/sims", (req, res) => {
  res.json({ ok: true, sims: filter("sims", (s) => s.tenantId === req.user.id).map(publicSim) });
});

// --- Messages (paginated + filter) ---
clientRouter.get("/messages", (req, res) => {
  let rows = filter("messages", (m) => m.tenantId === req.user.id);
  const { type, q } = req.query;
  if (type && type !== "all") rows = rows.filter((m) => m.type === type);
  if (q) {
    const needle = String(q).toLowerCase();
    rows = rows.filter((m) => (m.recipients.join(" ") + m.text).toLowerCase().includes(needle));
  }
  res.json({ ok: true, ...paginate(rows, req.query, publicMessage) });
});

// --- Usage ---
clientRouter.get("/usage", (req, res) => {
  res.json({ ok: true, summary: publicTenant(req.user), series: dailySeries(req.user.id, 30) });
});

// --- Test console (send from the UI; counts against usage) ---
clientRouter.post("/test/sms", validateBody(sendSmsSchema), async (req, res, next) => {
  try {
    res.json({ ok: true, ...(await sendForTenant(req.user, { text: req.body.message, phoneNumbers: req.body.phoneNumbers, type: "sms" })) });
  } catch (err) { next(err); }
});
clientRouter.post("/test/otp/send", validateBody(sendOtpSchema), async (req, res, next) => {
  try {
    res.json({ ok: true, ...(await sendOtp(req.user, req.body.phoneNumber)) });
  } catch (err) { next(err); }
});
clientRouter.post("/test/otp/verify", validateBody(verifyOtpSchema), (req, res) => {
  res.json({ ok: true, ...verifyOtp(req.user, req.body.phoneNumber, req.body.code) });
});

// --- Billing (manual approval) ---
clientRouter.get("/plans", (req, res) => res.json({ ok: true, plans: db.plans.map(publicPlan) }));

// Request a plan change. Free activates instantly; paid plans await admin approval.
clientRouter.post("/billing/request", validateBody(z.object({ planSlug: z.string() })), (req, res, next) => {
  try {
    const result = requestPlan(req.user, req.body.planSlug);
    res.json({ ok: true, pending: result.pending, activated: result.activated, transaction: publicTransaction(result.transaction), user: publicTenant(req.user) });
  } catch (err) { next(err); }
});

// Transaction history for this client.
clientRouter.get("/transactions", (req, res) => {
  const rows = filter("transactions", (t) => t.tenantId === req.user.id)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  res.json({ ok: true, ...paginate(rows, req.query, publicTransaction) });
});

// --- Settings ---
clientRouter.patch("/profile", validateBody(z.object({
  name: z.string().trim().min(2).max(80).optional(),
  company: z.string().trim().min(2).max(80).optional(),
})), (req, res) => {
  update("tenants", req.user.id, req.body);
  res.json({ ok: true, user: publicTenant(req.user) });
});

// --- WhatsApp Business API config (per-tenant) -----------------------------
clientRouter.patch("/whatsapp", validateBody(z.object({
  phoneNumberId: z.string().trim().max(64).optional(),
  token: z.string().trim().max(512).optional(),
  enabled: z.boolean().optional(),
})), (req, res) => {
  const patch = {};
  if (req.body.phoneNumberId !== undefined) patch.whatsappPhoneId = req.body.phoneNumberId || null;
  if (req.body.token) patch.whatsappToken = req.body.token; // only overwrite when provided
  if (req.body.enabled !== undefined) patch.whatsappEnabled = req.body.enabled;
  update("tenants", req.user.id, patch);
  res.json({ ok: true, user: publicTenant(req.user) });
});

// --- Contact lists ----------------------------------------------------------
const contactsSchema = z.array(z.object({}).passthrough()).min(1).max(50000);

clientRouter.get("/lists", (req, res) => {
  const rows = filter("contactLists", (l) => l.tenantId === req.user.id)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  res.json({ ok: true, lists: rows.map(publicList) });
});

clientRouter.post("/lists", validateBody(z.object({
  name: z.string().trim().min(1).max(80),
  contacts: contactsSchema,
})), async (req, res, next) => {
  try {
    const list = await createList(req.user, req.body.name, req.body.contacts);
    res.status(201).json({ ok: true, list: publicList(list) });
  } catch (err) { next(err); }
});

clientRouter.get("/lists/:id/contacts", async (req, res, next) => {
  try {
    const list = db.contactLists.find((l) => l.id === req.params.id && l.tenantId === req.user.id);
    if (!list) return res.status(404).json({ ok: false, error: "List not found" });
    const contacts = await bulkRepo.getContacts(list.id, { limit: 50, offset: Number(req.query.offset) || 0 });
    res.json({ ok: true, list: publicList(list), contacts });
  } catch (err) { next(err); }
});

clientRouter.delete("/lists/:id", async (req, res, next) => {
  try {
    await deleteList(req.user, req.params.id);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// --- Campaigns --------------------------------------------------------------
clientRouter.get("/campaigns", (req, res) => {
  const rows = filter("campaigns", (c) => c.tenantId === req.user.id)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  res.json({ ok: true, ...paginate(rows, req.query, publicCampaign) });
});

clientRouter.post("/campaigns", validateBody(z.object({
  name: z.string().trim().min(1).max(80),
  channel: z.enum(["sms", "whatsapp"]),
  message: z.string().trim().min(1).max(2000),
  listId: z.string().optional(),
  contacts: contactsSchema.optional(),
  ratePerMin: z.coerce.number().int().min(1).max(1000).optional(),
  waMode: z.enum(["text", "template"]).optional(),
  waTemplate: z.string().trim().max(120).optional(),
  waLanguage: z.string().trim().max(12).optional(),
})), async (req, res, next) => {
  try {
    if (!req.body.listId && !req.body.contacts) {
      return res.status(400).json({ ok: false, error: "Provide a listId or contacts." });
    }
    const campaign = await createCampaign(req.user, req.body);
    res.status(201).json({ ok: true, campaign: publicCampaign(campaign) });
  } catch (err) { next(err); }
});

clientRouter.get("/campaigns/:id", async (req, res, next) => {
  try {
    const c = db.campaigns.find((x) => x.id === req.params.id && x.tenantId === req.user.id);
    if (!c) return res.status(404).json({ ok: false, error: "Campaign not found" });
    const [counts, sample] = await Promise.all([
      bulkRepo.recipientCounts(c.id),
      bulkRepo.recipientSample(c.id, 30),
    ]);
    res.json({ ok: true, campaign: publicCampaign(c), counts, sample });
  } catch (err) { next(err); }
});

clientRouter.post("/campaigns/:id/:action", (req, res, next) => {
  try {
    const c = controlCampaign(req.user, req.params.id, req.params.action);
    res.json({ ok: true, campaign: publicCampaign(c) });
  } catch (err) { next(err); }
});

// --- Request own hardware (BYOD) -------------------------------------------
clientRouter.get("/hardware", (req, res) => {
  const requests = filter("hardwareRequests", (r) => r.tenantId === req.user.id)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .map(publicHardware);
  // The client's own approved devices/SIMs.
  const ownSims = filter("sims", (s) => s.tenantId === req.user.id).map(publicSim);
  res.json({ ok: true, requests, sims: ownSims, platformFeeCents: DEFAULT_PLATFORM_FEE_CENTS });
});

clientRouter.post("/hardware", validateBody(z.object({
  deviceName: z.string().trim().min(1).max(80),
  model: z.string().trim().max(80).optional(),
  gatewayUrl: z.string().trim().url().optional(),
  username: z.string().trim().min(1).max(120),
  password: z.string().trim().min(1).max(200),
  phoneNumber: z.string().trim().min(5).max(20),
  carrier: z.string().trim().max(40).optional(),
})), (req, res, next) => {
  try {
    const reqRow = requestHardware(req.user, req.body);
    res.status(201).json({ ok: true, request: publicHardware(reqRow) });
  } catch (err) { next(err); }
});

// --- WhatsApp templates (catalog of 50 + client-adopted) -------------------
clientRouter.get("/wa-templates/catalog", (req, res) => {
  res.json({ ok: true, categories: WA_CATEGORIES, templates: WA_TEMPLATE_CATALOG });
});

clientRouter.get("/wa-templates", (req, res) => {
  const rows = filter("waTemplates", (t) => t.tenantId === req.user.id)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  res.json({ ok: true, templates: rows.map(publicWaTemplate) });
});

clientRouter.post("/wa-templates", validateBody(z.object({
  name: z.string().trim().regex(/^[a-z0-9_]{1,60}$/, "Use lowercase letters, numbers and underscores"),
  category: z.string().trim().max(40).optional(),
  metaCategory: z.enum(["MARKETING", "UTILITY", "AUTHENTICATION"]).optional(),
  language: z.string().trim().max(12).optional(),
  body: z.string().trim().min(1).max(1024),
})), (req, res, next) => {
  try {
    if (db.waTemplates.some((t) => t.tenantId === req.user.id && t.name === req.body.name)) {
      return res.status(409).json({ ok: false, error: "You already have a template with that name." });
    }
    const variables = (req.body.body.match(/\{\{\d+\}\}/g) || []).length;
    const t = insert("waTemplates", {
      id: newId("wat"), tenantId: req.user.id, name: req.body.name,
      category: req.body.category || "Custom", metaCategory: req.body.metaCategory || "MARKETING",
      language: req.body.language || "en_US", body: req.body.body, variables,
      status: "draft", createdAt: now(),
    });
    res.status(201).json({ ok: true, template: publicWaTemplate(t) });
  } catch (err) { next(err); }
});

clientRouter.patch("/wa-templates/:id", validateBody(z.object({
  status: z.enum(["draft", "submitted", "approved", "rejected"]),
})), (req, res) => {
  const t = db.waTemplates.find((x) => x.id === req.params.id && x.tenantId === req.user.id);
  if (!t) return res.status(404).json({ ok: false, error: "Template not found" });
  update("waTemplates", t.id, { status: req.body.status });
  res.json({ ok: true, template: publicWaTemplate(t) });
});

clientRouter.delete("/wa-templates/:id", (req, res) => {
  const t = db.waTemplates.find((x) => x.id === req.params.id && x.tenantId === req.user.id);
  if (!t) return res.status(404).json({ ok: false, error: "Template not found" });
  remove("waTemplates", t.id);
  res.json({ ok: true });
});
