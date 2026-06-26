// Usage + analytics helpers derived from the message log.
import { db } from "../store/db.js";

export const planOf = (tenant) => db.plans.find((p) => p.id === tenant.planId) || null;

// Messages a tenant has sent during its current billing period. Includes both
// transactional sends (messages log) and bulk campaign sends (campaign.sent
// counters — bulk recipients live in Postgres, not the in-memory message log).
export function periodUsage(tenant) {
  const start = new Date(tenant.periodStart).getTime();
  const msgs = db.messages.filter(
    (m) => m.tenantId === tenant.id && new Date(m.createdAt).getTime() >= start,
  );
  const segments = msgs.reduce((s, m) => s + (m.segments || 1), 0);
  const bulkSent = db.campaigns
    .filter((c) => c.tenantId === tenant.id && new Date(c.createdAt).getTime() >= start)
    .reduce((s, c) => s + (c.sent || 0), 0);
  return {
    messages: msgs.length + bulkSent,
    segments: segments + bulkSent,
    costCents: msgs.reduce((s, m) => s + (m.costCents || 0), 0) + bulkSent,
  };
}

export function tenantSummary(tenant) {
  const plan = planOf(tenant);
  const usage = periodUsage(tenant);
  const quota = plan?.monthlyQuota || 0;
  const sims = db.sims.filter((s) => s.tenantId === tenant.id);
  return {
    usage,
    quota,
    quotaUsedPct: quota ? Math.min(100, Math.round((usage.messages / quota) * 100)) : 0,
    remaining: Math.max(0, quota - usage.messages),
    sims: sims.length,
    plan,
  };
}

// Last-N-days message counts for a tenant (or all when tenantId is null).
export function dailySeries(tenantId, days = 14) {
  const buckets = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(Date.now() - i * 86400000);
    const key = day.toISOString().slice(0, 10);
    buckets.push({ date: key, sms: 0, otp: 0, total: 0 });
  }
  const byKey = new Map(buckets.map((b) => [b.date, b]));
  db.messages.forEach((m) => {
    if (tenantId && m.tenantId !== tenantId) return;
    const key = m.createdAt.slice(0, 10);
    const b = byKey.get(key);
    if (!b) return;
    b[m.type] = (b[m.type] || 0) + 1;
    b.total += 1;
  });
  return buckets;
}
