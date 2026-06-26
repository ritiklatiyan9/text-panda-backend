// "Request own Hardware" (BYOD) flow. A client runs the SMS Gateway for Android
// app on their own phone, enters its API id/password here, and — once an
// operator APPROVES the request — their own SIM becomes their sending hardware.
// A platform fee is recorded on approval.
import { db, insert, newId, now, update, save } from "../store/db.js";
import { logger } from "../logger.js";

export const DEFAULT_PLATFORM_FEE_CENTS = Number(process.env.PLATFORM_FEE_CENTS || 49900); // ₹499

export function requestHardware(tenant, opts) {
  const { deviceName, model, gatewayUrl, username, password, phoneNumber, carrier } = opts;
  if (db.hardwareRequests.some((r) => r.tenantId === tenant.id && r.status === "pending")) {
    const e = new Error("You already have a hardware request awaiting approval.");
    e.status = 409;
    throw e;
  }
  const req = insert("hardwareRequests", {
    id: newId("hw"), tenantId: tenant.id,
    deviceName: deviceName || "My phone", model: model || "Android device",
    gatewayUrl: gatewayUrl || "https://api.sms-gate.app/3rdparty/v1",
    username, password, phoneNumber, carrier: carrier || "Unknown",
    status: "pending", platformFeeCents: DEFAULT_PLATFORM_FEE_CENTS, statusReason: null,
    deviceId: null, simId: null, createdAt: now(), reviewedAt: null,
  });
  logger.info(`[hardware] ${tenant.company} requested own hardware (${phoneNumber})`);
  return req;
}

export async function approveHardware(requestId) {
  const req = db.hardwareRequests.find((r) => r.id === requestId);
  if (!req) { const e = new Error("Request not found"); e.status = 404; throw e; }
  if (req.status !== "pending") { const e = new Error("Request is not pending"); e.status = 400; throw e; }
  const tenant = db.tenants.find((t) => t.id === req.tenantId);
  if (!tenant) { const e = new Error("Client not found"); e.status = 404; throw e; }

  // Create the client-owned device with their gateway credentials.
  const device = insert("devices", {
    id: newId("dev"), name: req.deviceName, model: req.model,
    gatewayUrl: req.gatewayUrl, username: req.username, password: req.password,
    dryRun: false, status: "online", ownerTenantId: tenant.id,
    lastSeenAt: now(), createdAt: now(),
  });
  await save("devices", device); // commit before SIM (FK device_id)

  // Create the SIM, assigned to the client.
  const sim = insert("sims", {
    id: newId("sim"), deviceId: device.id, slot: 1,
    phoneNumber: req.phoneNumber, carrier: req.carrier,
    label: `${req.deviceName} (own)`, status: "active", tenantId: tenant.id, createdAt: now(),
  });

  // Record the platform fee.
  if (req.platformFeeCents > 0) {
    insert("transactions", {
      id: newId("txn"), tenantId: tenant.id, planId: tenant.planId, planName: "Platform fee",
      amountCents: req.platformFeeCents, currency: "INR", status: "approved", provider: "platform",
      razorpayOrderId: null, razorpayPaymentId: null,
      description: `Own-hardware platform fee — ${req.phoneNumber}`, createdAt: now(),
    });
  }

  update("hardwareRequests", req.id, { status: "approved", deviceId: device.id, simId: sim.id, reviewedAt: now() });
  logger.info(`[hardware] approved ${tenant.company} → device ${device.id}, sim ${sim.phoneNumber}`);
  return { request: req, device, sim };
}

export function rejectHardware(requestId, reason) {
  const req = db.hardwareRequests.find((r) => r.id === requestId);
  if (!req) { const e = new Error("Request not found"); e.status = 404; throw e; }
  if (req.status !== "pending") { const e = new Error("Request is not pending"); e.status = 400; throw e; }
  update("hardwareRequests", req.id, { status: "rejected", statusReason: reason || "Rejected by operator", reviewedAt: now() });
  return { request: req };
}
