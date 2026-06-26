// Auth: client self-service signup + login for both clients and the operator.
import { Router } from "express";
import { z } from "zod";
import { validateBody } from "../middleware/validate.js";
import { requireAuth } from "../middleware/auth.js";
import { signToken, hashPassword, checkPassword } from "../auth/tokens.js";
import { db, idx, insert, newId, now, save } from "../store/db.js";
import { publicTenant, publicPlan } from "./serializers.js";

export const authRouter = Router();

const registerSchema = z.object({
  name: z.string().trim().min(2).max(80),
  company: z.string().trim().min(2).max(80),
  email: z.string().trim().email().toLowerCase(),
  password: z.string().min(8, "Password must be at least 8 characters").max(128),
  planSlug: z.string().optional(),
});

const loginSchema = z.object({
  email: z.string().trim().email().toLowerCase(),
  password: z.string().min(1),
});

// POST /api/auth/register — create a client account.
authRouter.post("/register", validateBody(registerSchema), async (req, res) => {
  const { name, company, email, password, planSlug } = req.body;
  if (db.tenants.some((t) => t.email === email) || db.admins.some((a) => a.email === email)) {
    return res.status(409).json({ ok: false, error: "An account with that email already exists." });
  }
  const plan = db.plans.find((p) => p.slug === (planSlug || "free")) || db.plans[0];
  const tenant = insert("tenants", {
    id: newId("ten"), name, company, email,
    passwordHash: await hashPassword(password),
    role: "client", status: "active", planId: plan.id,
    subscriptionStatus: "active", whatsappEnabled: false,
    periodStart: now(), periodEnd: new Date(Date.now() + 30 * 86400000).toISOString(),
    createdAt: now(),
  });
  await save("tenants", tenant); // commit before any FK-dependent writes
  const token = signToken({ sub: tenant.id, role: "client" });
  res.status(201).json({ ok: true, token, role: "client", user: publicTenant(tenant) });
});

// POST /api/auth/login — works for clients and the operator (admin).
authRouter.post("/login", validateBody(loginSchema), async (req, res) => {
  const { email, password } = req.body;

  const admin = db.admins.find((a) => a.email === email);
  if (admin && (await checkPassword(password, admin.passwordHash))) {
    const token = signToken({ sub: admin.id, role: "admin" });
    return res.json({
      ok: true, token, role: "admin",
      user: { id: admin.id, name: admin.name, email: admin.email, role: "admin" },
    });
  }

  const tenant = db.tenants.find((t) => t.email === email);
  if (tenant && (await checkPassword(password, tenant.passwordHash))) {
    if (tenant.status === "suspended")
      return res.status(403).json({ ok: false, error: "Account suspended. Contact support." });
    const token = signToken({ sub: tenant.id, role: "client" });
    return res.json({ ok: true, token, role: "client", user: publicTenant(tenant) });
  }

  res.status(401).json({ ok: false, error: "Invalid email or password." });
});

// GET /api/auth/me — current session.
authRouter.get("/me", requireAuth, (req, res) => {
  if (req.role === "admin") {
    return res.json({ ok: true, role: "admin", user: { id: req.user.id, name: req.user.name, email: req.user.email, role: "admin" } });
  }
  res.json({ ok: true, role: "client", user: publicTenant(req.user) });
});

// GET /api/auth/plans — public pricing (for marketing + signup).
authRouter.get("/plans", (req, res) => {
  res.json({ ok: true, plans: db.plans.map(publicPlan) });
});
