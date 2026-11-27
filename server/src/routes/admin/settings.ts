import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db/prisma.js";
import { asyncHandler } from "../../http/helpers.js";
import { getSettings, updateSettings } from "../../settings/settingsService.js";
import { getTodayCost } from "../../ai/budget.js";
import { env } from "../../config/env.js";
import { whatsappEnabled } from "../../messaging/whatsappSend.js";

export const settingsRouter = Router();

// Never expose the shared temporary student password in any API response.
function publicSettings(s: Awaited<ReturnType<typeof getSettings>>) {
  const { studentTempPassword: _tmp, ...rest } = s;
  void _tmp;
  return rest;
}

settingsRouter.get(
  "/settings",
  asyncHandler(async (_req, res) => {
    const settings = await getSettings();
    // Expose config FLAGS only — never saved secrets (tokens/keys stay server-side).
    res.json({
      settings: publicSettings(settings),
      integrations: {
        aiProvider: env.AI_PROVIDER,
        embeddingProvider: env.EMBEDDING_PROVIDER,
        emailProvider: env.EMAIL_PROVIDER,
        emailConfigured: env.EMAIL_PROVIDER !== "console",
        whatsappEnabled: env.WHATSAPP_ENABLED,
        whatsappConfigured: Boolean(env.WHATSAPP_CLOUD_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID),
        // WhatsApp delivery can be switched on with either backend (Cloud API or WhatsApp Web).
        whatsappChannelAvailable: whatsappEnabled(settings),
        storageProvider: env.STORAGE_PROVIDER,
      },
    });
  }),
);

const patchSchema = z.object({
  replyMode: z.enum(["A", "B", "C"]).optional(),
  autoReplyPaused: z.boolean().optional(),
  autoReplyMinConfidence: z.number().min(0).max(1).optional(),
  autoReplyRequireEvidence: z.boolean().optional(),
  autoReplyImagesAllowed: z.boolean().optional(),
  defaultDeliveryChannels: z.array(z.enum(["WEBSITE", "EMAIL", "WHATSAPP"])).optional(),
});

settingsRouter.put(
  "/settings",
  asyncHandler(async (req, res) => {
    const patch = patchSchema.parse(req.body);
    const settings = await updateSettings(patch, req.user!.id);
    res.json({ settings: publicSettings(settings) });
  }),
);

// Emergency global pause — stops all auto-replies instantly.
settingsRouter.post(
  "/settings/pause",
  asyncHandler(async (req, res) => {
    const { paused } = z.object({ paused: z.boolean() }).parse(req.body);
    const settings = await updateSettings({ autoReplyPaused: paused }, req.user!.id);
    res.json({ settings: publicSettings(settings) });
  }),
);

settingsRouter.get(
  "/stats",
  asyncHandler(async (_req, res) => {
    const [pending, answeredToday, students, documents, approved, aiCost] = await Promise.all([
      prisma.responseDraft.count({ where: { status: "PENDING_APPROVAL" } }),
      prisma.responseDraft.count({ where: { status: "SENT", decidedAt: { gte: startOfToday() } } }),
      prisma.user.count({ where: { role: "STUDENT" } }),
      prisma.courseDocument.count({ where: { status: "READY" } }),
      prisma.approvedAnswer.count({ where: { active: true } }),
      getTodayCost(),
    ]);
    res.json({ stats: { pending, answeredToday, students, documents, approved, aiCostToday: aiCost, aiBudget: env.AI_DAILY_BUDGET_USD } });
  }),
);

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
