// Shape internal records into safe API payloads (never leak hashes/passwords).
import { db } from "../store/db.js";
import { planOf, tenantSummary } from "../services/usage.js";

export const publicPlan = (p) => p && ({
  id: p.id, name: p.name, slug: p.slug, priceCents: p.priceCents,
  monthlyQuota: p.monthlyQuota, rateLimitPerMin: p.rateLimitPerMin,
  maxSims: p.maxSims, features: p.features || [], popular: Boolean(p.popular),
});

export const publicTenant = (t) => {
  if (!t) return null;
  const s = tenantSummary(t);
  const pending = db.transactions.find((x) => x.tenantId === t.id && x.status === "pending");
  return {
    id: t.id, name: t.name, company: t.company, email: t.email,
    status: t.status, role: t.role, createdAt: t.createdAt,
    subscriptionStatus: t.subscriptionStatus || "active",
    periodStart: t.periodStart, periodEnd: t.periodEnd,
    plan: publicPlan(s.plan),
    usage: s.usage, quota: s.quota, quotaUsedPct: s.quotaUsedPct, remaining: s.remaining,
    sims: s.sims,
    whatsapp: {
      enabled: Boolean(t.whatsappEnabled),
      configured: Boolean(t.whatsappPhoneId && t.whatsappToken),
      phoneNumberId: t.whatsappPhoneId || null,
    },
    pendingRequest: pending ? { id: pending.id, planName: pending.planName, amountCents: pending.amountCents, createdAt: pending.createdAt } : null,
  };
};

export const publicHardware = (r) => {
  if (!r) return null;
  const tenant = db.tenants.find((t) => t.id === r.tenantId);
  return {
    id: r.id, tenantId: r.tenantId, company: tenant?.company || "—",
    deviceName: r.deviceName, model: r.model, gatewayUrl: r.gatewayUrl,
    username: r.username, phoneNumber: r.phoneNumber, carrier: r.carrier,
    status: r.status, platformFeeCents: r.platformFeeCents, statusReason: r.statusReason || null,
    hasCredentials: Boolean(r.username && r.password),
    deviceId: r.deviceId, simId: r.simId, createdAt: r.createdAt, reviewedAt: r.reviewedAt,
  };
};

export const publicWaTemplate = (t) => t && ({
  id: t.id, name: t.name, category: t.category, metaCategory: t.metaCategory,
  language: t.language, body: t.body, variables: t.variables, status: t.status, createdAt: t.createdAt,
});

export const publicList = (l) => l && ({
  id: l.id, name: l.name, columns: l.columns || [], contactCount: l.contactCount, createdAt: l.createdAt,
});

export const publicCampaign = (c) => {
  if (!c) return null;
  const total = c.total || 0;
  const done = (c.sent || 0) + (c.failed || 0);
  return {
    id: c.id, name: c.name, channel: c.channel, message: c.message,
    waMode: c.waMode, waTemplate: c.waTemplate, waLanguage: c.waLanguage, listId: c.listId,
    status: c.status, statusReason: c.statusReason || null,
    total, sent: c.sent || 0, failed: c.failed || 0, ratePerMin: c.ratePerMin,
    progress: total ? Math.round((done / total) * 100) : 0,
    createdAt: c.createdAt, startedAt: c.startedAt, completedAt: c.completedAt,
  };
};

export const publicKey = (k) => k && ({
  id: k.id, name: k.name, prefix: k.prefix, last4: k.last4,
  createdAt: k.createdAt, lastUsedAt: k.lastUsedAt, revoked: k.revoked,
  masked: `${k.prefix}_••••••••••${k.last4}`,
});

export const publicDevice = (d) => {
  if (!d) return null;
  const sims = db.sims.filter((s) => s.deviceId === d.id);
  return {
    id: d.id, name: d.name, model: d.model, gatewayUrl: d.gatewayUrl,
    status: d.status, dryRun: d.dryRun, lastSeenAt: d.lastSeenAt, createdAt: d.createdAt,
    simCount: sims.length, hasCredentials: Boolean(d.username && d.password),
  };
};

export const publicSim = (s) => {
  if (!s) return null;
  const device = db.devices.find((d) => d.id === s.deviceId);
  const tenant = s.tenantId ? db.tenants.find((t) => t.id === s.tenantId) : null;
  return {
    id: s.id, deviceId: s.deviceId, deviceName: device?.name || null,
    slot: s.slot, phoneNumber: s.phoneNumber, carrier: s.carrier, label: s.label,
    status: s.status, tenantId: s.tenantId,
    tenantCompany: tenant?.company || null, createdAt: s.createdAt,
  };
};

export const publicTransaction = (t) => {
  if (!t) return null;
  const tenant = db.tenants.find((x) => x.id === t.tenantId);
  return {
    id: t.id, tenantId: t.tenantId, company: tenant?.company || "—",
    planId: t.planId, planName: t.planName, amountCents: t.amountCents, currency: t.currency,
    status: t.status, provider: t.provider, razorpayOrderId: t.razorpayOrderId,
    razorpayPaymentId: t.razorpayPaymentId, description: t.description, createdAt: t.createdAt,
  };
};

export const publicMessage = (m) => m && ({
  id: m.id, type: m.type, recipients: m.recipients, text: m.text,
  state: m.state, segments: m.segments, costCents: m.costCents,
  dryRun: m.dryRun, error: m.error, createdAt: m.createdAt,
  simId: m.simId, deviceId: m.deviceId, gatewayId: m.gatewayId || null,
  tenantId: m.tenantId,
});
