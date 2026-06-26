// Authentication & authorization middleware.
//  • requireAuth   — verifies a dashboard JWT (admin or client) from the
//                    Authorization: Bearer header.
//  • requireRole   — gates a route to a role.
//  • requireApiKey — authenticates the public /api/v1 surface via X-API-Key.
import { verifyToken, hashApiKeyRaw } from "../auth/tokens.js";
import { db, idx, update, now } from "../store/db.js";

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  const payload = token && verifyToken(token);
  if (!payload) return res.status(401).json({ ok: false, error: "Unauthorized" });

  if (payload.role === "admin") {
    req.user = db.admins.find((a) => a.id === payload.sub);
  } else {
    req.user = idx.tenantById.get(payload.sub);
  }
  if (!req.user) return res.status(401).json({ ok: false, error: "Account not found" });
  req.role = payload.role;
  next();
}

export function requireRole(role) {
  return (req, res, next) => {
    if (req.role !== role) return res.status(403).json({ ok: false, error: "Forbidden" });
    next();
  };
}

export function requireApiKey(req, res, next) {
  const raw =
    req.headers["x-api-key"] ||
    (req.headers.authorization?.startsWith("Bearer sk_")
      ? req.headers.authorization.slice(7)
      : null);
  if (!raw) return res.status(401).json({ ok: false, error: "Missing API key (X-API-Key header)" });

  const key = idx.apiKeyByHash.get(hashApiKeyRaw(raw));
  if (!key || key.revoked) return res.status(401).json({ ok: false, error: "Invalid or revoked API key" });

  const tenant = idx.tenantById.get(key.tenantId);
  if (!tenant) return res.status(401).json({ ok: false, error: "Account not found" });
  if (tenant.status !== "active")
    return res.status(403).json({ ok: false, error: "Account suspended — contact your provider" });

  update("apiKeys", key.id, { lastUsedAt: now() });
  req.tenant = tenant;
  req.apiKey = key;
  next();
}
