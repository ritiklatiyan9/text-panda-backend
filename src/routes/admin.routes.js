// Operator (admin) console API — manage clients, devices, SIMs, plans.
import { Router } from "express";
import { z } from "zod";
import { validateBody } from "../middleware/validate.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { db, filter, insert, newId, now, remove, update } from "../store/db.js";
import { dailySeries, planOf, periodUsage } from "../services/usage.js";
import { approveRequest, rejectRequest } from "../services/billing.js";
import { approveHardware, rejectHardware } from "../services/hardware.js";
import { publicTenant, publicDevice, publicSim, publicPlan, publicMessage, publicKey, publicTransaction, publicHardware } from "./serializers.js";
import { paginate } from "./pagination.js";

export const adminRouter = Router();
adminRouter.use(requireAuth, requireRole("admin"));

// --- Dashboard stats ---
adminRouter.get("/overview", (req, res) => {
  const active = db.tenants.filter((t) => t.status === "active");
  const mrrCents = active.reduce((s, t) => s + (planOf(t)?.priceCents || 0), 0);
  const onlineDevices = db.devices.filter((d) => d.status === "online").length;
  const assignedSims = db.sims.filter((s) => s.tenantId).length;
  const today = new Date().toISOString().slice(0, 10);
  const msgsToday = db.messages.filter((m) => m.createdAt.slice(0, 10) === today).length;

  // Plan distribution for a pie/donut chart.
  const planDistribution = db.plans.map((p) => ({
    name: p.name,
    slug: p.slug,
    count: db.tenants.filter((t) => t.planId === p.id).length,
  }));

  // Revenue collected per day (last 14 days) from paid transactions.
  const revSeries = dailySeries(null, 14).map((b) => ({ date: b.date, revenueCents: 0 }));
  const revByDate = new Map(revSeries.map((b) => [b.date, b]));
  db.transactions.forEach((t) => {
    if (t.status !== "approved") return;
    const b = revByDate.get(t.createdAt.slice(0, 10));
    if (b) b.revenueCents += t.amountCents || 0;
  });

  const approvedTxns = db.transactions.filter((t) => t.status === "approved");
  const revenueTotalCents = approvedTxns.reduce((s, t) => s + (t.amountCents || 0), 0);
  const pendingRequests = db.transactions.filter((t) => t.status === "pending").length;

  res.json({
    ok: true,
    stats: {
      clients: db.tenants.length,
      activeClients: active.length,
      suspended: db.tenants.length - active.length,
      pastDue: db.tenants.filter((t) => t.subscriptionStatus === "past_due").length,
      pendingRequests,
      pendingHardware: db.hardwareRequests.filter((r) => r.status === "pending").length,
      mrrCents,
      revenueTotalCents,
      devices: db.devices.length,
      onlineDevices,
      sims: db.sims.length,
      assignedSims,
      apiKeys: db.apiKeys.filter((k) => !k.revoked).length,
      messagesTotal: db.messages.length,
      messagesToday: msgsToday,
    },
    series: dailySeries(null, 14),
    revenueSeries: revSeries,
    planDistribution,
    deviceStatus: { online: onlineDevices, offline: db.devices.length - onlineDevices },
    topClients: [...db.tenants]
      .map((t) => ({ ...publicTenant(t), monthMessages: periodUsage(t).messages }))
      .sort((a, b) => b.monthMessages - a.monthMessages)
      .slice(0, 5),
    recent: db.messages.slice(0, 8).map((m) => ({
      ...publicMessage(m),
      company: db.tenants.find((t) => t.id === m.tenantId)?.company || "—",
    })),
  });
});

// --- Clients (tenants) ---
adminRouter.get("/clients", (req, res) => {
  let rows = [...db.tenants];
  const { q, status } = req.query;
  if (status && status !== "all") rows = rows.filter((t) => t.status === status);
  if (q) {
    const n = String(q).toLowerCase();
    rows = rows.filter((t) => (t.company + t.email + t.name).toLowerCase().includes(n));
  }
  res.json({ ok: true, ...paginate(rows, req.query, publicTenant) });
});

adminRouter.get("/clients/:id", (req, res) => {
  const t = db.tenants.find((x) => x.id === req.params.id);
  if (!t) return res.status(404).json({ ok: false, error: "Client not found" });
  const msgs = filter("messages", (m) => m.tenantId === t.id);
  const txns = filter("transactions", (x) => x.tenantId === t.id);
  const delivered = msgs.filter((m) => m.state === "Delivered").length;
  res.json({
    ok: true,
    client: publicTenant(t),
    stats: {
      totalMessages: msgs.length,
      delivered,
      deliveryRate: msgs.length ? Math.round((delivered / msgs.length) * 100) : 0,
      revenueCents: txns.filter((x) => x.status === "paid").reduce((s, x) => s + (x.amountCents || 0), 0),
      transactions: txns.length,
    },
    series: dailySeries(t.id, 14),
    sims: filter("sims", (s) => s.tenantId === t.id).map(publicSim),
    keys: filter("apiKeys", (k) => k.tenantId === t.id).map(publicKey),
    transactions: txns.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).map(publicTransaction),
    recent: msgs.slice(0, 10).map(publicMessage),
  });
});

// Per-client usage detail (for the usage drill-down).
adminRouter.get("/clients/:id/usage", (req, res) => {
  const t = db.tenants.find((x) => x.id === req.params.id);
  if (!t) return res.status(404).json({ ok: false, error: "Client not found" });
  res.json({ ok: true, client: publicTenant(t), series: dailySeries(t.id, 30) });
});

adminRouter.patch("/clients/:id", validateBody(z.object({
  status: z.enum(["active", "suspended"]).optional(),
  planSlug: z.string().optional(),
})), (req, res) => {
  const t = db.tenants.find((x) => x.id === req.params.id);
  if (!t) return res.status(404).json({ ok: false, error: "Client not found" });
  const patch = {};
  if (req.body.status) patch.status = req.body.status;
  if (req.body.planSlug) {
    const plan = db.plans.find((p) => p.slug === req.body.planSlug);
    if (plan) patch.planId = plan.id;
  }
  update("tenants", t.id, patch);
  res.json({ ok: true, client: publicTenant(t) });
});

// --- Devices (phones) ---
const deviceSchema = z.object({
  name: z.string().trim().min(2).max(80),
  model: z.string().trim().min(2).max(80),
  gatewayUrl: z.string().trim().url().optional(),
  username: z.string().optional(),
  password: z.string().optional(),
  dryRun: z.boolean().optional(),
});

adminRouter.get("/devices", (req, res) => {
  res.json({ ok: true, devices: db.devices.map(publicDevice) });
});

adminRouter.post("/devices", validateBody(deviceSchema), (req, res) => {
  const d = insert("devices", {
    id: newId("dev"), name: req.body.name, model: req.body.model,
    gatewayUrl: req.body.gatewayUrl || "https://api.sms-gate.app/3rdparty/v1",
    username: req.body.username || "", password: req.body.password || "",
    dryRun: req.body.dryRun ?? true, status: "offline", lastSeenAt: null, createdAt: now(),
  });
  res.status(201).json({ ok: true, device: publicDevice(d) });
});

adminRouter.patch("/devices/:id", validateBody(deviceSchema.partial().extend({
  status: z.enum(["online", "offline"]).optional(),
})), (req, res) => {
  const d = db.devices.find((x) => x.id === req.params.id);
  if (!d) return res.status(404).json({ ok: false, error: "Device not found" });
  update("devices", d.id, req.body);
  res.json({ ok: true, device: publicDevice(d) });
});

adminRouter.delete("/devices/:id", (req, res) => {
  const sims = db.sims.filter((s) => s.deviceId === req.params.id);
  sims.forEach((s) => remove("sims", s.id));
  remove("devices", req.params.id);
  res.json({ ok: true });
});

// --- SIMs ---
const simSchema = z.object({
  deviceId: z.string(),
  slot: z.coerce.number().int().min(1).max(2),
  phoneNumber: z.string().trim().min(5).max(20),
  carrier: z.string().trim().min(1).max(40),
  label: z.string().trim().max(60).optional(),
});

adminRouter.get("/sims", (req, res) => {
  let rows = [...db.sims];
  if (req.query.unassigned === "true") rows = rows.filter((s) => !s.tenantId);
  res.json({ ok: true, sims: rows.map(publicSim) });
});

adminRouter.post("/sims", validateBody(simSchema), (req, res) => {
  const device = db.devices.find((d) => d.id === req.body.deviceId);
  if (!device) return res.status(404).json({ ok: false, error: "Device not found" });
  const taken = db.sims.some((s) => s.deviceId === device.id && s.slot === req.body.slot);
  if (taken) return res.status(409).json({ ok: false, error: `Slot ${req.body.slot} on this device is already in use.` });
  const sim = insert("sims", {
    id: newId("sim"), deviceId: device.id, slot: req.body.slot,
    phoneNumber: req.body.phoneNumber, carrier: req.body.carrier,
    label: req.body.label || `${device.model} SIM ${req.body.slot}`,
    status: "active", tenantId: null, createdAt: now(),
  });
  res.status(201).json({ ok: true, sim: publicSim(sim) });
});

adminRouter.post("/sims/:id/assign", validateBody(z.object({ tenantId: z.string().nullable() })), (req, res) => {
  const sim = db.sims.find((s) => s.id === req.params.id);
  if (!sim) return res.status(404).json({ ok: false, error: "SIM not found" });
  if (req.body.tenantId) {
    const tenant = db.tenants.find((t) => t.id === req.body.tenantId);
    if (!tenant) return res.status(404).json({ ok: false, error: "Client not found" });
    const plan = planOf(tenant);
    const current = db.sims.filter((s) => s.tenantId === tenant.id).length;
    if (current >= (plan?.maxSims || 0))
      return res.status(409).json({ ok: false, error: `Client is at their plan SIM limit (${plan?.maxSims}).` });
  }
  update("sims", sim.id, { tenantId: req.body.tenantId || null });
  res.json({ ok: true, sim: publicSim(sim) });
});

adminRouter.patch("/sims/:id", validateBody(z.object({
  status: z.enum(["active", "inactive"]).optional(),
  label: z.string().trim().max(60).optional(),
  carrier: z.string().trim().max(40).optional(),
})), (req, res) => {
  const sim = db.sims.find((s) => s.id === req.params.id);
  if (!sim) return res.status(404).json({ ok: false, error: "SIM not found" });
  update("sims", sim.id, req.body);
  res.json({ ok: true, sim: publicSim(sim) });
});

adminRouter.delete("/sims/:id", (req, res) => {
  remove("sims", req.params.id);
  res.json({ ok: true });
});

// --- Hardware requests (BYOD approvals) ---
adminRouter.get("/hardware", (req, res) => {
  let rows = [...db.hardwareRequests].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  if (req.query.status && req.query.status !== "all") rows = rows.filter((r) => r.status === req.query.status);
  res.json({
    ok: true,
    pendingCount: db.hardwareRequests.filter((r) => r.status === "pending").length,
    requests: rows.map(publicHardware),
  });
});

adminRouter.post("/hardware/:id/approve", async (req, res, next) => {
  try {
    const { request } = await approveHardware(req.params.id);
    res.json({ ok: true, request: publicHardware(request) });
  } catch (err) { next(err); }
});

adminRouter.post("/hardware/:id/reject", validateBody(z.object({ reason: z.string().max(200).optional() })), (req, res, next) => {
  try {
    const { request } = rejectHardware(req.params.id, req.body.reason);
    res.json({ ok: true, request: publicHardware(request) });
  } catch (err) { next(err); }
});

// --- Plans ---
adminRouter.get("/plans", (req, res) => res.json({ ok: true, plans: db.plans.map(publicPlan) }));

// --- Transactions (platform-wide, paginated) ---
adminRouter.get("/transactions", (req, res) => {
  let rows = [...db.transactions].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const { status, q } = req.query;
  if (status && status !== "all") rows = rows.filter((t) => t.status === status);
  if (q) {
    const n = String(q).toLowerCase();
    rows = rows.filter((t) => {
      const company = db.tenants.find((x) => x.id === t.tenantId)?.company || "";
      return (company + t.planName + t.razorpayPaymentId + t.razorpayOrderId).toLowerCase().includes(n);
    });
  }
  const approved = db.transactions.filter((t) => t.status === "approved");
  const pending = db.transactions.filter((t) => t.status === "pending");
  res.json({
    ok: true,
    summary: {
      totalCents: approved.reduce((s, t) => s + (t.amountCents || 0), 0),
      count: db.transactions.length,
      paidCount: approved.length,
      pendingCount: pending.length,
    },
    ...paginate(rows, req.query, publicTransaction),
  });
});

// Approve / reject a pending plan request.
adminRouter.post("/transactions/:id/approve", (req, res, next) => {
  try {
    const { transaction } = approveRequest(req.params.id);
    res.json({ ok: true, transaction: publicTransaction(transaction) });
  } catch (err) { next(err); }
});
adminRouter.post("/transactions/:id/reject", (req, res, next) => {
  try {
    const { transaction } = rejectRequest(req.params.id);
    res.json({ ok: true, transaction: publicTransaction(transaction) });
  } catch (err) { next(err); }
});

// --- All messages (paginated) ---
adminRouter.get("/messages", (req, res) => {
  let rows = [...db.messages];
  const { type, q } = req.query;
  if (type && type !== "all") rows = rows.filter((m) => m.type === type);
  if (q) {
    const n = String(q).toLowerCase();
    rows = rows.filter((m) => (m.recipients.join(" ") + m.text).toLowerCase().includes(n));
  }
  res.json({
    ok: true,
    ...paginate(rows, req.query, (m) => ({
      ...publicMessage(m),
      company: db.tenants.find((t) => t.id === m.tenantId)?.company || "—",
    })),
  });
});
