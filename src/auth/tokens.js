// JWT signing/verification for dashboard sessions, plus API-key generation.
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { config } from "../config.js";
import { hashApiKeyRaw } from "../store/db.js";

export function signToken(payload) {
  return jwt.sign(payload, config.auth.jwtSecret, { expiresIn: config.auth.jwtExpiresIn });
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, config.auth.jwtSecret);
  } catch {
    return null;
  }
}

export const hashPassword = (pw) => bcrypt.hash(pw, 10);
export const checkPassword = (pw, hash) => bcrypt.compare(pw, hash);

// Generate a fresh API key. The raw value is shown to the user exactly once;
// we persist only its HMAC hash (+ a last-4 hint).
export function generateApiKey() {
  const prefix = "sk_live";
  const raw = `${prefix}_${crypto.randomBytes(20).toString("hex")}`;
  return { raw, prefix, last4: raw.slice(-4), keyHash: hashApiKeyRaw(raw) };
}

export { hashApiKeyRaw };
