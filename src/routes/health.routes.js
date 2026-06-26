// Public liveness probe. No secrets — safe to expose.
import { Router } from "express";
import { db } from "../store/db.js";

export const healthRouter = Router();

healthRouter.get("/", (req, res) => {
  res.json({
    ok: true,
    status: "up",
    time: new Date().toISOString(),
    service: "sms-gateway-saas",
    billing: { mode: "manual" },
    counts: {
      plans: db.plans.length,
      clients: db.tenants.length,
      devices: db.devices.length,
      sims: db.sims.length,
    },
  });
});
