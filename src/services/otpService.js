// Multi-tenant OTP: codes are scoped per (tenant, phone). Same security model
// as before — CSPRNG codes, HMAC-hashed at rest, timing-safe compare, TTL,
// single-use, attempt cap, resend cooldown.
import crypto from "node:crypto";
import { config } from "../config.js";
import { db, insert, newId, now, remove, update } from "../store/db.js";
import { sendForTenant } from "./messaging.js";

const genCode = (len) => Array.from({ length: len }, () => crypto.randomInt(0, 10)).join("");
const hash = (tenantId, phone, code) =>
  crypto.createHmac("sha256", config.otp.hashSecret).update(`${tenantId}:${phone}:${code}`).digest("hex");
const safeEq = (a, b) => {
  const ba = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
};
const findOtp = (tenantId, phone) =>
  db.otps.find((o) => o.tenantId === tenantId && o.phoneNumber === phone);

export async function sendOtp(tenant, phoneNumber) {
  const existing = findOtp(tenant.id, phoneNumber);
  if (existing) {
    const wait = config.otp.resendCooldownSeconds - (Date.now() - new Date(existing.lastSentAt).getTime()) / 1000;
    if (wait > 0) {
      const err = new Error(`Please wait ${Math.ceil(wait)}s before requesting another code.`);
      err.status = 429;
      throw err;
    }
    remove("otps", existing.id);
  }

  const code = genCode(config.otp.length);
  const requestId = crypto.randomUUID();
  insert("otps", {
    id: newId("otp"), tenantId: tenant.id, phoneNumber,
    codeHash: hash(tenant.id, phoneNumber, code), requestId, attempts: 0,
    lastSentAt: now(), expiresAt: new Date(Date.now() + config.otp.ttlSeconds * 1000).toISOString(),
  });

  const text = `Your ${tenant.company} verification code is ${code}. It expires in ${Math.round(config.otp.ttlSeconds / 60)} minutes.`;
  let gateway;
  try {
    gateway = await sendForTenant(tenant, { text, phoneNumbers: [phoneNumber], type: "otp" });
  } catch (err) {
    const o = findOtp(tenant.id, phoneNumber);
    if (o) remove("otps", o.id);
    throw err;
  }

  return {
    requestId,
    phoneNumber,
    expiresInSeconds: config.otp.ttlSeconds,
    gateway: { id: gateway.id, state: gateway.state },
    ...(gateway.dryRun ? { devCode: code } : {}),
  };
}

export function verifyOtp(tenant, phoneNumber, code) {
  const rec = findOtp(tenant.id, phoneNumber);
  if (!rec) return { verified: false, reason: "no_active_code", message: "No active code. Request a new one." };

  if (new Date(rec.expiresAt).getTime() < Date.now()) {
    remove("otps", rec.id);
    return { verified: false, reason: "expired", message: "Code expired. Request a new one." };
  }
  if (rec.attempts >= config.otp.maxAttempts) {
    remove("otps", rec.id);
    return { verified: false, reason: "too_many_attempts", message: "Too many attempts. Request a new code." };
  }
  if (!safeEq(rec.codeHash, hash(tenant.id, phoneNumber, code))) {
    update("otps", rec.id, { attempts: rec.attempts + 1 });
    return {
      verified: false, reason: "invalid_code", message: "Incorrect code.",
      remainingAttempts: Math.max(0, config.otp.maxAttempts - (rec.attempts + 1)),
    };
  }
  remove("otps", rec.id);
  return { verified: true, requestId: rec.requestId };
}
