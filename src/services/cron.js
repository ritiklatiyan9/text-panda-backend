// Scheduled jobs: subscription lifecycle + OTP cleanup.
import cron from "node-cron";
import { db, remove, update, now } from "../store/db.js";
import { logger } from "../logger.js";

const GRACE_DAYS = 7;
const freePlan = () => db.plans.find((p) => p.slug === "free");
const ms = (iso) => new Date(iso).getTime();

// Check every tenant's billing period and transition state accordingly.
export function runSubscriptionCheck() {
  const t0 = Date.now();
  let pastDue = 0, downgraded = 0, renewed = 0;
  const free = freePlan();

  for (const tenant of db.tenants) {
    const plan = db.plans.find((p) => p.id === tenant.planId);
    if (!plan) continue;
    const ended = ms(tenant.periodEnd) < Date.now();
    if (!ended) continue;

    if (plan.priceCents === 0) {
      // Free auto-renews each period.
      update("tenants", tenant.id, { periodStart: now(), periodEnd: new Date(Date.now() + 30 * 86400000).toISOString(), subscriptionStatus: "active" });
      renewed++;
    } else if (tenant.subscriptionStatus === "active") {
      // Paid plan lapsed — enter grace period.
      update("tenants", tenant.id, { subscriptionStatus: "past_due" });
      pastDue++;
    } else if (tenant.subscriptionStatus === "past_due" && ms(tenant.periodEnd) + GRACE_DAYS * 86400000 < Date.now()) {
      // Grace expired — downgrade to free.
      if (free) {
        update("tenants", tenant.id, {
          planId: free.id, subscriptionStatus: "active",
          periodStart: now(), periodEnd: new Date(Date.now() + 30 * 86400000).toISOString(),
        });
        downgraded++;
      }
    }
  }
  if (pastDue || downgraded || renewed) {
    logger.info(`[cron] subscriptions — pastDue:${pastDue} downgraded:${downgraded} renewed:${renewed} (${Date.now() - t0}ms)`);
  }
  return { pastDue, downgraded, renewed };
}

export function runOtpCleanup() {
  const expired = db.otps.filter((o) => ms(o.expiresAt) < Date.now());
  expired.forEach((o) => remove("otps", o.id));
  if (expired.length) logger.info(`[cron] cleaned ${expired.length} expired OTP(s)`);
}

export function startCron() {
  // Daily at 02:00 — subscription lifecycle.
  cron.schedule("0 2 * * *", runSubscriptionCheck);
  // Every 15 minutes — OTP cleanup.
  cron.schedule("*/15 * * * *", runOtpCleanup);
  // Run once on boot so lapsed states are corrected immediately.
  runSubscriptionCheck();
  runOtpCleanup();
  logger.info("[cron] scheduled: subscription check (daily 02:00), OTP cleanup (every 15m)");
}
