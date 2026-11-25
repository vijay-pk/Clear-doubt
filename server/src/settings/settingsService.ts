import { prisma } from "../db/prisma.js";
import { writeAudit } from "../audit/audit.js";

export type ReplyMode = "A" | "B" | "C"; // A=Manual, B=Supervised, C=Controlled Auto-Reply

export type WhatsAppProvider = "none" | "cloud" | "web";

export interface PlatformSettings {
  replyMode: ReplyMode;
  autoReplyPaused: boolean; // emergency global pause for mode C
  autoReplyMinConfidence: number; // 0..1 eligibility threshold
  autoReplyRequireEvidence: boolean; // require sufficient course evidence
  autoReplyImagesAllowed: boolean; // image doubts eligible for auto-reply?
  dataAiTrainingAllowed: boolean; // compliance lock — always false
  defaultDeliveryChannels: Array<"WEBSITE" | "EMAIL" | "WHATSAPP">;
  // WhatsApp sending backend: official Cloud API, or Baileys WhatsApp Web (QR).
  whatsappProvider: WhatsAppProvider;
  // WhatsApp Web is unofficial automation; a super admin must acknowledge the ban risk.
  whatsappWebRiskAck: boolean;
  // Student access lifecycle (all times UTC).
  studentExpiringSoonDays: number; // show "expiring soon" within this many days of expiry
  studentAccessGraceDays: number; // days after expiry before data is auto-deleted
}

const DEFAULTS: PlatformSettings = {
  replyMode: "A",
  autoReplyPaused: false,
  autoReplyMinConfidence: 0.75,
  autoReplyRequireEvidence: true,
  autoReplyImagesAllowed: false,
  dataAiTrainingAllowed: false,
  defaultDeliveryChannels: ["WEBSITE", "EMAIL"],
  whatsappProvider: "none",
  whatsappWebRiskAck: false,
  studentExpiringSoonDays: 3,
  studentAccessGraceDays: 7,
};

const KEY = "platform";

let cache: { value: PlatformSettings; at: number } | null = null;
const TTL = 5000;

export async function getSettings(): Promise<PlatformSettings> {
  if (cache && Date.now() - cache.at < TTL) return cache.value;
  const row = await prisma.setting.findUnique({ where: { key: KEY } });
  const stored = (row?.value as Partial<PlatformSettings> | undefined) ?? {};
  const value: PlatformSettings = {
    ...DEFAULTS,
    ...stored,
    // Compliance lock: training on platform data is never allowed, whatever is stored.
    dataAiTrainingAllowed: false,
  };
  cache = { value, at: Date.now() };
  return value;
}

export async function updateSettings(
  patch: Partial<PlatformSettings>,
  actorId: string,
): Promise<PlatformSettings> {
  const current = await getSettings();
  const next: PlatformSettings = {
    ...current,
    ...patch,
    dataAiTrainingAllowed: false, // locked
  };
  await prisma.setting.upsert({
    where: { key: KEY },
    create: { key: KEY, value: next as object, updatedById: actorId },
    update: { value: next as object, updatedById: actorId },
  });
  cache = null;
  await writeAudit({ actorId, action: "settings.update", entityType: "Setting", entityId: KEY, meta: patch });
  return next;
}

export function invalidateSettingsCache() {
  cache = null;
}
