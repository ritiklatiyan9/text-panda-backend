// WhatsApp Business Cloud API sender. Each tenant configures their OWN
// credentials (phone number id + access token) in their panel. If a tenant
// hasn't configured WhatsApp, sends fall back to dry-run (logged) so the whole
// flow works without real credentials.
import { logger } from "../logger.js";

const GRAPH = "https://graph.facebook.com/v21.0";

export const tenantWhatsAppReady = (t) => Boolean(t?.whatsappEnabled && t?.whatsappPhoneId && t?.whatsappToken);

/**
 * Send a WhatsApp message for a tenant.
 * @param {object} tenant
 * @param {object} opts { to, text?, template?, language?, params? }
 *   - text mode: { to, text }
 *   - template mode: { to, template, language, params: string[] }
 */
export async function sendWhatsApp(tenant, { to, text, template, language = "en_US", params = [] }) {
  if (!tenantWhatsAppReady(tenant)) {
    logger.warn(`[whatsapp:DRY] ${tenant.company} → ${to}: "${text || template}"`);
    return { id: `wa-dry-${Date.now()}`, dryRun: true };
  }

  const body = template
    ? {
        messaging_product: "whatsapp",
        to,
        type: "template",
        template: {
          name: template,
          language: { code: language },
          ...(params.length
            ? { components: [{ type: "body", parameters: params.map((t) => ({ type: "text", text: t })) }] }
            : {}),
        },
      }
    : { messaging_product: "whatsapp", to, type: "text", text: { body: text } };

  const res = await fetch(`${GRAPH}/${tenant.whatsappPhoneId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${tenant.whatsappToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || `WhatsApp API ${res.status}`;
    const err = new Error(msg);
    err.status = 502;
    throw err;
  }
  return { id: data?.messages?.[0]?.id || null, dryRun: false };
}
