-- ---------------------------------------------------------------------------
-- Production PostgreSQL schema for the multi-tenant SMS SaaS.
--
-- The app currently runs on an in-memory store (server/src/store/db.js) that
-- mirrors these tables 1:1, so moving to Postgres is a drop-in repository swap.
-- Indexes are chosen for the hot paths (API-key auth, per-tenant queries,
-- message log scans) so the platform stays fast with hundreds of tenants.
-- Run with:  npm run db:init   (needs DATABASE_URL)
-- ---------------------------------------------------------------------------

-- Operators (you) ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS admins (
  id            TEXT PRIMARY KEY,
  email         TEXT UNIQUE NOT NULL,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Subscription plans -------------------------------------------------------
CREATE TABLE IF NOT EXISTS plans (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  slug              TEXT UNIQUE NOT NULL,
  price_cents       INTEGER NOT NULL DEFAULT 0,
  monthly_quota     INTEGER NOT NULL DEFAULT 0,
  rate_limit_per_min INTEGER NOT NULL DEFAULT 30,
  max_sims          INTEGER NOT NULL DEFAULT 1,
  features          JSONB NOT NULL DEFAULT '[]',
  popular           BOOLEAN NOT NULL DEFAULT false,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Client tenants -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS tenants (
  id                      TEXT PRIMARY KEY,
  name                    TEXT NOT NULL,
  company                 TEXT NOT NULL,
  email                   TEXT UNIQUE NOT NULL,
  password_hash           TEXT NOT NULL,
  status                  TEXT NOT NULL DEFAULT 'active',   -- active | suspended
  plan_id                 TEXT REFERENCES plans(id),
  subscription_status     TEXT NOT NULL DEFAULT 'active',   -- active | past_due | canceled | trialing
  razorpay_customer_id    TEXT,
  razorpay_subscription_id TEXT,
  period_start            TIMESTAMPTZ NOT NULL DEFAULT now(),
  period_end              TIMESTAMPTZ NOT NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tenants_status ON tenants (status);
CREATE INDEX IF NOT EXISTS idx_tenants_period_end ON tenants (period_end);

-- API keys (HMAC hash stored, never the raw key) ---------------------------
CREATE TABLE IF NOT EXISTS api_keys (
  id           TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  prefix       TEXT NOT NULL,
  last4        TEXT NOT NULL,
  key_hash     TEXT UNIQUE NOT NULL,
  revoked      BOOLEAN NOT NULL DEFAULT false,
  last_used_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys (key_hash);
CREATE INDEX IF NOT EXISTS idx_api_keys_tenant ON api_keys (tenant_id);

-- Devices (phones in the fleet) --------------------------------------------
CREATE TABLE IF NOT EXISTS devices (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  model        TEXT NOT NULL,
  gateway_url  TEXT NOT NULL,
  username     TEXT DEFAULT '',
  password     TEXT DEFAULT '',
  dry_run      BOOLEAN NOT NULL DEFAULT true,
  status       TEXT NOT NULL DEFAULT 'offline',   -- online | offline
  last_seen_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- SIMs (up to 2 per device; assignable to a tenant) ------------------------
CREATE TABLE IF NOT EXISTS sims (
  id           TEXT PRIMARY KEY,
  device_id    TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  slot         SMALLINT NOT NULL CHECK (slot IN (1, 2)),
  phone_number TEXT NOT NULL,
  carrier      TEXT,
  label        TEXT,
  status       TEXT NOT NULL DEFAULT 'active',     -- active | inactive
  tenant_id    TEXT REFERENCES tenants(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (device_id, slot)
);
CREATE INDEX IF NOT EXISTS idx_sims_tenant ON sims (tenant_id);

-- Message audit log --------------------------------------------------------
CREATE TABLE IF NOT EXISTS messages (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sim_id        TEXT REFERENCES sims(id) ON DELETE SET NULL,
  device_id     TEXT REFERENCES devices(id) ON DELETE SET NULL,
  gateway_id    TEXT,
  type          TEXT NOT NULL,                     -- sms | otp
  recipients    TEXT[] NOT NULL,
  text          TEXT NOT NULL,
  state         TEXT,                              -- Pending|Sent|Delivered|Failed|DryRun
  segments      INTEGER NOT NULL DEFAULT 1,
  cost_cents    INTEGER NOT NULL DEFAULT 0,
  dry_run       BOOLEAN NOT NULL DEFAULT false,
  error         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_messages_tenant_created ON messages (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_created ON messages (created_at DESC);

-- Payment transactions (Razorpay) -----------------------------------------
CREATE TABLE IF NOT EXISTS transactions (
  id                    TEXT PRIMARY KEY,
  tenant_id             TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  plan_id               TEXT REFERENCES plans(id),
  plan_name             TEXT,
  amount_cents          INTEGER NOT NULL,
  currency              TEXT NOT NULL DEFAULT 'INR',
  status                TEXT NOT NULL,                 -- created | paid | failed | refunded | simulated
  provider              TEXT NOT NULL DEFAULT 'razorpay',
  razorpay_order_id     TEXT,
  razorpay_payment_id   TEXT,
  description           TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_transactions_tenant_created ON transactions (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_created ON transactions (created_at DESC);

-- OTP codes (per tenant + phone; HMAC-hashed) ------------------------------
CREATE TABLE IF NOT EXISTS otp_codes (
  id           TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  phone_number TEXT NOT NULL,
  code_hash    TEXT NOT NULL,
  request_id   TEXT NOT NULL,
  attempts     INTEGER NOT NULL DEFAULT 0,
  last_sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL,
  UNIQUE (tenant_id, phone_number)
);
CREATE INDEX IF NOT EXISTS idx_otp_expires ON otp_codes (expires_at);

-- Per-tenant WhatsApp Business (Cloud API) configuration --------------------
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS whatsapp_phone_id TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS whatsapp_token TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS whatsapp_enabled BOOLEAN NOT NULL DEFAULT false;

-- Client-owned hardware (BYOD) ----------------------------------------------
ALTER TABLE devices ADD COLUMN IF NOT EXISTS owner_tenant_id TEXT;

CREATE TABLE IF NOT EXISTS hardware_requests (
  id                 TEXT PRIMARY KEY,
  tenant_id          TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  device_name        TEXT NOT NULL,
  model              TEXT,
  gateway_url        TEXT NOT NULL,
  username           TEXT NOT NULL,
  password           TEXT NOT NULL,
  phone_number       TEXT NOT NULL,
  carrier            TEXT,
  status             TEXT NOT NULL DEFAULT 'pending', -- pending|approved|rejected
  platform_fee_cents INTEGER NOT NULL DEFAULT 0,
  status_reason      TEXT,
  device_id          TEXT,
  sim_id             TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at        TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_hw_requests_tenant ON hardware_requests (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_hw_requests_status ON hardware_requests (status);

-- Client-adopted WhatsApp templates (for approval tracking) -----------------
CREATE TABLE IF NOT EXISTS wa_templates (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  category      TEXT,
  meta_category TEXT,
  language      TEXT NOT NULL DEFAULT 'en_US',
  body          TEXT NOT NULL,
  variables     INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'draft', -- draft|submitted|approved|rejected
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wa_templates_tenant ON wa_templates (tenant_id, created_at DESC);

-- ===========================================================================
-- Bulk messaging: contact lists + campaigns
-- ===========================================================================

-- Saved recipient lists (metadata; rows live in list_contacts) --------------
CREATE TABLE IF NOT EXISTS contact_lists (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  columns       JSONB NOT NULL DEFAULT '[]',   -- extra variable column names
  contact_count INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_contact_lists_tenant ON contact_lists (tenant_id, created_at DESC);

-- Individual contacts (high volume — Postgres only, never loaded to memory) --
CREATE TABLE IF NOT EXISTS list_contacts (
  id         BIGSERIAL PRIMARY KEY,
  list_id    TEXT NOT NULL REFERENCES contact_lists(id) ON DELETE CASCADE,
  tenant_id  TEXT NOT NULL,
  phone      TEXT NOT NULL,
  name       TEXT,
  vars       JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_list_contacts_list ON list_contacts (list_id);

-- Campaigns (metadata) ------------------------------------------------------
CREATE TABLE IF NOT EXISTS campaigns (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  channel       TEXT NOT NULL,                 -- sms | whatsapp
  message       TEXT NOT NULL,                 -- body, supports {{name}} / {{1}}
  wa_mode       TEXT,                          -- text | template (whatsapp)
  wa_template   TEXT,
  wa_language   TEXT DEFAULT 'en_US',
  list_id       TEXT,
  status        TEXT NOT NULL DEFAULT 'queued', -- queued|running|paused|completed|failed|canceled
  total         INTEGER NOT NULL DEFAULT 0,
  sent          INTEGER NOT NULL DEFAULT 0,
  failed        INTEGER NOT NULL DEFAULT 0,
  rate_per_min  INTEGER NOT NULL DEFAULT 30,
  status_reason TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at    TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_campaigns_tenant ON campaigns (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns (status);

-- Campaign recipients (high volume — Postgres only) -------------------------
CREATE TABLE IF NOT EXISTS campaign_recipients (
  id          BIGSERIAL PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  tenant_id   TEXT NOT NULL,
  phone       TEXT NOT NULL,
  name        TEXT,
  vars        JSONB NOT NULL DEFAULT '{}',
  status      TEXT NOT NULL DEFAULT 'pending', -- pending|sent|failed|skipped
  error       TEXT,
  sent_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_camp_recipients_pending ON campaign_recipients (campaign_id, status);
