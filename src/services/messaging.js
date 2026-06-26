// Core routing: turn a tenant's send request into an actual SMS via one of
// THEIR assigned SIMs.
//   • deliverSms()    — low-level: route + send, NO audit row (used by bulk).
//   • sendForTenant() — transactional API: deliver + write a messages row.
import { db, insert, newId, now, update } from "../store/db.js";
import { sendViaDevice } from "./deviceGateway.js";
import { logger } from "../logger.js";

const segmentsFor = (text) => Math.max(1, Math.ceil((text || "").length / 160));

// Round-robin SIM selection per tenant (spreads load across their numbers).
const rr = new Map();
export function pickSimForTenant(tenant) {
  const sims = db.sims.filter((s) => s.tenantId === tenant.id && s.status === "active");
  if (!sims.length) return null;
  const i = ((rr.get(tenant.id) ?? -1) + 1) % sims.length;
  rr.set(tenant.id, i);
  return sims[i];
}

// Low-level single-recipient delivery. Never throws; returns a result object.
export async function deliverSms(tenant, text, phoneNumber) {
  const sim = pickSimForTenant(tenant);
  const device = sim ? db.devices.find((d) => d.id === sim.deviceId) : null;
  try {
    const res = sim
      ? await sendViaDevice(device, { text, phoneNumbers: [phoneNumber], simNumber: sim.slot })
      : { id: `nosim-${Date.now()}`, state: "Sent", dryRun: true };
    if (device) update("devices", device.id, { lastSeenAt: now() });
    return { ok: true, id: res.id, state: res.state || "Sent", dryRun: Boolean(res.dryRun), simId: sim?.id || null, deviceId: device?.id || null };
  } catch (err) {
    return { ok: false, id: null, state: "Failed", error: err.message, simId: sim?.id || null, deviceId: device?.id || null };
  }
}

/**
 * Transactional send (OTP / single SMS API). Delivers + writes an audit row.
 */
export async function sendForTenant(tenant, { text, phoneNumbers, type = "sms" }) {
  const segments = segmentsFor(text) * phoneNumbers.length;
  // Deliver to each recipient; summarise.
  const results = await Promise.all(phoneNumbers.map((p) => deliverSms(tenant, text, p)));
  const failed = results.find((r) => !r.ok);
  const first = results[0] || {};

  const msg = insert("messages", {
    id: newId("msg"), tenantId: tenant.id, simId: first.simId || null, deviceId: first.deviceId || null,
    gatewayId: first.id || null, type, recipients: phoneNumbers, text,
    state: failed ? "Failed" : first.state || "Sent", segments, costCents: segments,
    dryRun: Boolean(first.dryRun), error: failed?.error || null, createdAt: now(),
  });

  logger.info(`[send] tenant=${tenant.company} type=${type} n=${phoneNumbers.length} state=${msg.state}`);
  if (failed) {
    const e = new Error(failed.error || "Send failed");
    e.status = 502;
    throw e;
  }
  return { id: msg.id, gatewayId: first.id, state: msg.state, segments, simId: first.simId || null, dryRun: msg.dryRun };
}
