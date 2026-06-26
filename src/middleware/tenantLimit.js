// Per-tenant rate limiting (sliding window, in-memory) + monthly quota
// enforcement. Both read limits from the tenant's plan, so each client is
// isolated — one noisy client can't starve the others. Scales to hundreds of
// tenants since state is a tiny per-tenant array of timestamps.
import { planOf, periodUsage } from "../services/usage.js";

const windows = new Map(); // tenantId -> number[] (timestamps, ms)

export function rateLimit(req, res, next) {
  const tenant = req.tenant;
  const plan = planOf(tenant);
  const limit = plan?.rateLimitPerMin || 30;
  const nowMs = Date.now();
  const cutoff = nowMs - 60_000;

  const hits = (windows.get(tenant.id) || []).filter((t) => t > cutoff);
  if (hits.length >= limit) {
    res.set("Retry-After", "60");
    return res.status(429).json({
      ok: false,
      error: `Rate limit exceeded (${limit}/min for the ${plan?.name} plan).`,
    });
  }
  hits.push(nowMs);
  windows.set(tenant.id, hits);

  res.set("X-RateLimit-Limit", String(limit));
  res.set("X-RateLimit-Remaining", String(Math.max(0, limit - hits.length)));
  next();
}

export function enforceQuota(req, res, next) {
  const tenant = req.tenant;
  const plan = planOf(tenant);
  const quota = plan?.monthlyQuota || 0;
  const used = periodUsage(tenant).messages;
  if (quota && used >= quota) {
    return res.status(402).json({
      ok: false,
      error: `Monthly quota reached (${quota} messages on the ${plan?.name} plan). Upgrade to continue.`,
    });
  }
  next();
}
