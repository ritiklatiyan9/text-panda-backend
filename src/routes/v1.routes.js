// Public API surface — what clients integrate with using their API key.
//   Auth:   X-API-Key: sk_live_...   (or Authorization: Bearer sk_live_...)
//   Limits: per-tenant rate limit + monthly quota, both from the plan.
import { Router } from "express";
import { validateBody, sendSmsSchema, sendOtpSchema, verifyOtpSchema } from "../middleware/validate.js";
import { requireApiKey } from "../middleware/auth.js";
import { rateLimit, enforceQuota } from "../middleware/tenantLimit.js";
import { sendForTenant } from "../services/messaging.js";
import { sendOtp, verifyOtp } from "../services/otpService.js";
import { db } from "../store/db.js";
import { publicMessage } from "./serializers.js";

export const v1Router = Router();

v1Router.use(requireApiKey);

// POST /api/v1/sms/send  { phoneNumbers: [...], message }
v1Router.post("/sms/send", rateLimit, enforceQuota, validateBody(sendSmsSchema), async (req, res, next) => {
  try {
    const result = await sendForTenant(req.tenant, {
      text: req.body.message, phoneNumbers: req.body.phoneNumbers, type: "sms",
    });
    res.status(201).json({ ok: true, ...result });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/otp/send  { phoneNumber }
v1Router.post("/otp/send", rateLimit, enforceQuota, validateBody(sendOtpSchema), async (req, res, next) => {
  try {
    res.status(201).json({ ok: true, ...(await sendOtp(req.tenant, req.body.phoneNumber)) });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/otp/verify  { phoneNumber, code }
v1Router.post("/otp/verify", rateLimit, validateBody(verifyOtpSchema), (req, res) => {
  res.json({ ok: true, ...verifyOtp(req.tenant, req.body.phoneNumber, req.body.code) });
});

// GET /api/v1/messages/:id  — fetch a message you sent.
v1Router.get("/messages/:id", (req, res) => {
  const msg = db.messages.find((m) => m.id === req.params.id && m.tenantId === req.tenant.id);
  if (!msg) return res.status(404).json({ ok: false, error: "Message not found" });
  res.json({ ok: true, message: publicMessage(msg) });
});
