import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";

const GRAPH = "https://graph.facebook.com/v21.0";

export function whatsappConfigured(): boolean {
  return Boolean(env.WHATSAPP_ENABLED && env.WHATSAPP_CLOUD_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID);
}

// Send a free-form text message. Only valid inside the 24h customer-service
// window; outside it, WhatsApp requires an approved template (sendTemplate).
export async function sendWhatsAppText(to: string, body: string): Promise<{ id: string }> {
  if (!whatsappConfigured()) throw new Error("WhatsApp Cloud API is not configured");
  const res = await fetch(`${GRAPH}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.WHATSAPP_CLOUD_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "text",
      text: { body: body.slice(0, 4096), preview_url: false },
    }),
  });
  if (!res.ok) throw new Error(`WhatsApp send failed (${res.status}): ${await res.text()}`);
  const data = (await res.json()) as { messages?: Array<{ id: string }> };
  const id = data.messages?.[0]?.id;
  if (!id) throw new Error("WhatsApp send returned no message id");
  return { id };
}

// Verify the X-Hub-Signature-256 header against the raw request body.
export function verifyWebhookSignature(rawBody: Buffer, signatureHeader: string | undefined): boolean {
  if (!env.WHATSAPP_APP_SECRET || !signatureHeader) return false;
  const expected = "sha256=" + createHmac("sha256", env.WHATSAPP_APP_SECRET).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader);
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// GET webhook verification handshake (Meta sends hub.challenge).
export function verifyWebhookChallenge(mode: string, token: string): boolean {
  const ok = mode === "subscribe" && token === env.WHATSAPP_VERIFY_TOKEN && Boolean(env.WHATSAPP_VERIFY_TOKEN);
  if (!ok) logger.warn("whatsapp webhook verify failed");
  return ok;
}
