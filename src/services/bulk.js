// Bulk messaging service: contact lists + campaign creation + personalization.
import { db, insert, newId, now, update, remove, save } from "../store/db.js";
import { planOf, periodUsage } from "./usage.js";
import { tenantWhatsAppReady } from "./whatsapp.js";
import * as repo from "../store/bulkRepo.js";
import { logger } from "../logger.js";

// E.164-ish normalisation + validation.
export function cleanContacts(rows) {
  const seen = new Set();
  const out = [];
  for (const r of rows || []) {
    let phone = String(r.phone || r.Phone || r.number || "").replace(/[^\d+]/g, "").trim();
    if (phone && !phone.startsWith("+")) phone = `+${phone}`;
    if (!/^\+[1-9]\d{6,14}$/.test(phone)) continue; // skip invalid
    if (seen.has(phone)) continue; // dedupe
    seen.add(phone);
    const { phone: _p, Phone, number, name, Name, ...rest } = r;
    out.push({ phone, name: r.name || r.Name || null, vars: rest });
  }
  return out;
}

// Replace {{name}}, {{key}} and {{1}}..{{n}} in a template per recipient.
export function personalize(template, recipient) {
  const vars = recipient.vars || {};
  const ordered = Object.values(vars);
  return String(template || "").replace(/\{\{\s*([\w]+)\s*\}\}/g, (_, key) => {
    if (key.toLowerCase() === "name") return recipient.name || "";
    if (/^\d+$/.test(key)) return ordered[Number(key) - 1] ?? "";
    return vars[key] ?? "";
  });
}

// --- Lists ------------------------------------------------------------------
export async function createList(tenant, name, rawContacts) {
  const contacts = cleanContacts(rawContacts);
  if (!contacts.length) {
    const e = new Error("No valid phone numbers found in the file.");
    e.status = 400;
    throw e;
  }
  const columns = [...new Set(contacts.flatMap((c) => Object.keys(c.vars || {})))].slice(0, 12);
  const list = insert("contactLists", {
    id: newId("list"), tenantId: tenant.id, name: name || "Untitled list",
    columns, contactCount: contacts.length, createdAt: now(),
  });
  await save("contactLists", list); // ensure parent committed before child rows
  await repo.insertContacts(list.id, tenant.id, contacts);
  logger.info(`[bulk] ${tenant.company} saved list "${list.name}" (${contacts.length} contacts)`);
  return list;
}

export async function deleteList(tenant, listId) {
  const list = db.contactLists.find((l) => l.id === listId && l.tenantId === tenant.id);
  if (!list) {
    const e = new Error("List not found");
    e.status = 404;
    throw e;
  }
  remove("contactLists", listId); // FK cascade removes list_contacts
  return true;
}

// --- Campaigns --------------------------------------------------------------
const MAX_RECIPIENTS = 50000;

export async function createCampaign(tenant, opts) {
  const { name, channel, message, listId, contacts: inlineContacts, ratePerMin } = opts;
  if (!["sms", "whatsapp"].includes(channel)) {
    const e = new Error("Invalid channel"); e.status = 400; throw e;
  }
  if (channel === "whatsapp" && !tenantWhatsAppReady(tenant) && opts.waMode !== "_allowDry") {
    // allowed — falls back to dry-run, but warn the client via reason
  }

  const plan = planOf(tenant);
  const rate = Math.min(Math.max(1, Number(ratePerMin) || plan?.rateLimitPerMin || 30), plan?.rateLimitPerMin || 30);

  // Build the campaign row first so recipients can reference it.
  const campaign = insert("campaigns", {
    id: newId("camp"), tenantId: tenant.id, name: name || "Untitled campaign",
    channel, message, waMode: opts.waMode || "text", waTemplate: opts.waTemplate || null,
    waLanguage: opts.waLanguage || "en_US", listId: listId || null,
    status: "queued", total: 0, sent: 0, failed: 0, ratePerMin: rate, statusReason: null,
    createdAt: now(), startedAt: null, completedAt: null,
  });
  await save("campaigns", campaign); // ensure parent committed before recipients

  // Populate recipients.
  let total = 0;
  if (listId) {
    const list = db.contactLists.find((l) => l.id === listId && l.tenantId === tenant.id);
    if (!list) { remove("campaigns", campaign.id); const e = new Error("List not found"); e.status = 404; throw e; }
    total = await repo.copyListToCampaign(campaign.id, listId);
  } else {
    const contacts = cleanContacts(inlineContacts);
    if (!contacts.length) { remove("campaigns", campaign.id); const e = new Error("No valid recipients."); e.status = 400; throw e; }
    await repo.insertRecipients(campaign.id, tenant.id, contacts);
    total = contacts.length;
  }

  if (total > MAX_RECIPIENTS) {
    remove("campaigns", campaign.id);
    const e = new Error(`Too many recipients (max ${MAX_RECIPIENTS}).`); e.status = 400; throw e;
  }

  // Quota guard: current usage + this campaign must fit the plan.
  const used = periodUsage(tenant).messages;
  const quota = plan?.monthlyQuota || 0;
  if (quota && used + total > quota) {
    remove("campaigns", campaign.id);
    const e = new Error(`This campaign (${total}) would exceed your monthly quota (${used}/${quota} used).`);
    e.status = 402;
    throw e;
  }

  update("campaigns", campaign.id, { total, status: "running", startedAt: now() });
  logger.info(`[bulk] ${tenant.company} launched ${channel} campaign "${campaign.name}" → ${total} recipients @ ${rate}/min`);
  return campaign;
}

export function controlCampaign(tenant, id, action) {
  const c = db.campaigns.find((x) => x.id === id && x.tenantId === tenant.id);
  if (!c) { const e = new Error("Campaign not found"); e.status = 404; throw e; }
  const map = {
    pause: { status: "paused", statusReason: "Paused by user" },
    resume: { status: "running", statusReason: null },
    cancel: { status: "canceled", completedAt: now() },
  };
  if (!map[action]) { const e = new Error("Invalid action"); e.status = 400; throw e; }
  if (c.status === "completed" || c.status === "canceled") {
    const e = new Error(`Campaign already ${c.status}`); e.status = 400; throw e;
  }
  update("campaigns", id, map[action]);
  return c;
}
