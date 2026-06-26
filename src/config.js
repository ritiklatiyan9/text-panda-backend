// ---------------------------------------------------------------------------
// Central configuration. Reads from environment variables (loaded from .env).
// We look for a .env in the project root first, then in the server folder,
// so a single root .env can configure both the server and walkthrough.js.
// ---------------------------------------------------------------------------
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "../..");

// Root .env first (shared), then server/.env (overrides). `override: false`
// means the first file wins for any given key.
dotenv.config({ path: path.join(projectRoot, ".env") });
dotenv.config({ path: path.join(__dirname, "..", ".env") });

const bool = (v, fallback = false) =>
  v === undefined ? fallback : ["1", "true", "yes", "on"].includes(String(v).toLowerCase());

const int = (v, fallback) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
};

export const config = {
  port: int(process.env.PORT, 3001),
  corsOrigin: process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(",").map((origin) => origin.trim()).filter(Boolean)
    : ["http://localhost:5173", "https://text-panda-frontend.vercel.app"],

  auth: {
    // Used to sign dashboard session JWTs. Override in production via JWT_SECRET.
    jwtSecret: process.env.JWT_SECRET || "dev-only-change-me-jwt-secret-string",
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || "7d",
    // Secret used to HMAC API keys before storing them.
    apiKeySecret: process.env.API_KEY_SECRET || "dev-only-change-me-apikey-secret",
  },

  razorpay: {
    keyId: process.env.RAZORPAY_KEY_ID || "",
    keySecret: process.env.RAZORPAY_KEY_SECRET || "",
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET || "",
    currency: process.env.BILLING_CURRENCY || "INR",
  },

  gateway: {
    baseUrl: (process.env.SMS_GATEWAY_BASE_URL || "https://api.sms-gate.app/3rdparty/v1").replace(/\/+$/, ""),
    username: process.env.SMS_GATEWAY_USERNAME || "",
    password: process.env.SMS_GATEWAY_PASSWORD || "",
    // Dry-run = don't actually hit the gateway; log instead. Great for testing
    // without a phone. Defaults to ON unless real credentials are present.
    dryRun: bool(process.env.DRY_RUN, true),
  },

  otp: {
    length: int(process.env.OTP_LENGTH, 6),
    ttlSeconds: int(process.env.OTP_TTL_SECONDS, 300),
    maxAttempts: int(process.env.OTP_MAX_ATTEMPTS, 5),
    resendCooldownSeconds: int(process.env.OTP_RESEND_COOLDOWN_SECONDS, 60),
    hashSecret: process.env.OTP_HASH_SECRET || "change-me-to-a-long-random-string",
    store: (process.env.OTP_STORE || "memory").toLowerCase(), // memory | postgres
  },

  database: {
    url: process.env.DATABASE_URL || "",
  },
};

export const hasDatabase = Boolean(config.database.url);

// Helpful warnings on boot (non-fatal).
export function logConfigWarnings(log = console) {
  if (config.gateway.dryRun) {
    log.warn("[config] DRY_RUN is ON — SMS will NOT be sent; codes are logged to the console.");
  } else if (!config.gateway.username || !config.gateway.password) {
    log.warn("[config] DRY_RUN is OFF but SMS_GATEWAY_USERNAME/PASSWORD are missing — sends will fail.");
  }
  if (config.otp.store === "postgres" && !hasDatabase) {
    log.warn("[config] OTP_STORE=postgres but DATABASE_URL is empty — falling back to in-memory store.");
  }
  if (config.otp.hashSecret === "change-me-to-a-long-random-string") {
    log.warn("[config] OTP_HASH_SECRET is using the default value — set a random secret for production.");
  }
}
