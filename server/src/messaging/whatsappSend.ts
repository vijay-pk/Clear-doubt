import type { PlatformSettings } from "../settings/settingsService.js";
import { sendWhatsAppText, whatsappConfigured } from "./whatsappCloud.js";
import { whatsappWeb } from "./whatsappWeb.js";

// Is a WhatsApp backend ready to send under the current settings?
export function whatsappReady(settings: PlatformSettings): boolean {
  if (settings.whatsappProvider === "cloud") return whatsappConfigured();
  if (settings.whatsappProvider === "web") return settings.whatsappWebRiskAck && whatsappWeb.isConnected();
  return false;
}

// Send via the configured provider. Throws if none is ready (caller logs/ retries).
export async function sendWhatsApp(
  phoneE164: string,
  text: string,
  settings: PlatformSettings,
): Promise<{ id: string }> {
  if (settings.whatsappProvider === "cloud") return sendWhatsAppText(phoneE164, text);
  if (settings.whatsappProvider === "web") return whatsappWeb.sendText(phoneE164, text);
  throw new Error("No WhatsApp provider configured");
}
