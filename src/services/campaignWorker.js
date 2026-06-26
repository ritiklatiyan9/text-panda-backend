// ---------------------------------------------------------------------------
// Campaign worker — the throttled delivery engine. Runs on an interval and,
// for each running campaign, sends a small budget of messages per tick with
// randomized jitter between each. This is what keeps bulk sending SAFE:
//
//   • Throttle   — never exceed the campaign's rate (capped by the plan).
//   • Jitter     — randomized gaps between sends avoid robotic, ban-prone cadence.
//   • Batching   — bounded work per tick; recipients streamed from Postgres.
//   • Quota      — pauses a campaign when the tenant's monthly quota is hit.
//   • Isolation  — per-tenant rate/quota so one client can't affect others.
// ---------------------------------------------------------------------------
import { db, idx, update, now } from "../store/db.js";
import { planOf, periodUsage } from "./usage.js";
import { deliverSms } from "./messaging.js";
import { sendWhatsApp } from "./whatsapp.js";
import { personalize } from "./bulk.js";
import * as repo from "../store/bulkRepo.js";
import { logger } from "../logger.js";

const TICK_MS = 8000; // 7.5 ticks / minute
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = (min, max) => min + Math.floor(Math.random() * (max - min));

let busy = false;

async function processCampaign(c) {
  const tenant = idx.tenantById.get(c.tenantId);
  if (!tenant || tenant.status !== "active") {
    update("campaigns", c.id, { status: "paused", statusReason: "Account inactive" });
    return;
  }

  const plan = planOf(tenant);
  const quota = plan?.monthlyQuota || 0;
  const used = periodUsage(tenant).messages;
  if (quota && used >= quota) {
    update("campaigns", c.id, { status: "paused", statusReason: "Monthly quota reached" });
    return;
  }

  // How many to send this tick — throttle by rate, clamp to remaining quota.
  const perMin = Math.min(c.ratePerMin || 30, plan?.rateLimitPerMin || 30);
  let budget = Math.max(1, Math.round(perMin / (60000 / TICK_MS)));
  if (quota) budget = Math.min(budget, quota - used);
  if (budget <= 0) return;

  const batch = await repo.fetchPending(c.id, budget);
  if (batch.length === 0) {
    update("campaigns", c.id, { status: "completed", completedAt: now(), statusReason: null });
    return;
  }

  let sent = c.sent || 0;
  let failed = c.failed || 0;
  for (const r of batch) {
    if (c.status !== "running") break; // paused/canceled mid-tick
    const text = personalize(c.message, r);
    try {
      if (c.channel === "whatsapp") {
        await sendWhatsApp(
          tenant,
          c.waMode === "template"
            ? { to: r.phone, template: c.waTemplate, language: c.waLanguage, params: [r.name || ""] }
            : { to: r.phone, text },
        );
      } else {
        const res = await deliverSms(tenant, text, r.phone);
        if (!res.ok) throw new Error(res.error || "Send failed");
      }
      await repo.markRecipient(r.id, "sent");
      sent++;
    } catch (err) {
      await repo.markRecipient(r.id, "failed", err.message);
      failed++;
    }
    await sleep(jitter(150, 650)); // anti-ban desync
  }

  update("campaigns", c.id, { sent, failed });
  const pending = await repo.countPending(c.id);
  if (pending === 0 && c.status === "running") {
    update("campaigns", c.id, { status: "completed", completedAt: now(), statusReason: null });
  }
}

async function tick() {
  if (busy) return;
  busy = true;
  try {
    const running = db.campaigns.filter((c) => c.status === "running");
    for (const c of running) {
      await processCampaign(c).catch((err) => logger.error(`[worker] campaign ${c.id}: ${err.message}`));
    }
  } finally {
    busy = false;
  }
}

export function startCampaignWorker() {
  setInterval(() => tick().catch((e) => logger.error(`[worker] ${e.message}`)), TICK_MS);
  logger.info(`[worker] campaign delivery worker started (tick ${TICK_MS}ms)`);
}
