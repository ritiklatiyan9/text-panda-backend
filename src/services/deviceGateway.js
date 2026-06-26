// Sends an SMS through a SPECIFIC device (phone). Each device carries its own
// SMS Gateway for Android connection (base URL + Basic auth), so the operator
// can fan out across many phones. Falls back to dry-run when the device has no
// credentials or is flagged dryRun — so the whole system runs with no hardware.
import { logger } from "../logger.js";

function authHeader(device) {
  const token = Buffer.from(`${device.username}:${device.password}`).toString("base64");
  return `Basic ${token}`;
}

export async function sendViaDevice(device, { text, phoneNumbers, simNumber }) {
  const dry = !device || device.dryRun || !device.username || !device.password;
  if (dry) {
    logger.warn(`[gateway:DRY] ${device?.name || "no-device"} → ${phoneNumbers.join(", ")}: "${text}"`);
    return { id: `dryrun-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, state: "Sent", dryRun: true };
  }

  const url = `${device.gatewayUrl.replace(/\/+$/, "")}/message`;
  const body = { textMessage: { text }, phoneNumbers };
  if (simNumber) body.simNumber = simNumber;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: authHeader(device) },
    body: JSON.stringify(body),
  });
  const responseText = await res.text();
  if (!res.ok) {
    const err = new Error(`Device "${device.name}" returned ${res.status}: ${responseText}`);
    err.status = 502;
    throw err;
  }
  return responseText ? JSON.parse(responseText) : {};
}
