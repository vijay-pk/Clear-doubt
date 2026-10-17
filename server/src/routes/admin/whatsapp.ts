import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../http/helpers.js";
import { requireRole } from "../../middleware/authContext.js";
import { getSettings, updateSettings } from "../../settings/settingsService.js";
import { whatsappConfigured } from "../../messaging/whatsappCloud.js";
import { whatsappWeb } from "../../messaging/whatsappWeb.js";
import { badRequest } from "../../lib/errors.js";

export const whatsappRouter = Router();

// Status (any admin). Never exposes tokens/keys — only state flags and the QR image.
whatsappRouter.get(
  "/whatsapp/status",
  asyncHandler(async (_req, res) => {
    const settings = await getSettings();
    const web = await whatsappWeb.status();
    res.json({
      provider: settings.whatsappProvider,
      whatsappWebRiskAck: settings.whatsappWebRiskAck,
      cloudConfigured: whatsappConfigured(),
      web, // { state, detail, qr (data URL or null), botId }
    });
  }),
);

// Choose the sending backend (super admin).
whatsappRouter.post(
  "/whatsapp/provider",
  requireRole("SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    const { provider } = z.object({ provider: z.enum(["none", "cloud", "web"]) }).parse(req.body);
    const settings = await updateSettings({ whatsappProvider: provider }, req.user!.id);
    res.json({ provider: settings.whatsappProvider });
  }),
);

// Acknowledge the unofficial-automation ban risk (required before WhatsApp Web).
whatsappRouter.post(
  "/whatsapp/ack-risk",
  requireRole("SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    const { ack } = z.object({ ack: z.boolean() }).parse(req.body);
    const settings = await updateSettings({ whatsappWebRiskAck: ack }, req.user!.id);
    res.json({ whatsappWebRiskAck: settings.whatsappWebRiskAck });
  }),
);

// Start WhatsApp Web and surface a QR to scan (super admin).
whatsappRouter.post(
  "/whatsapp/web/connect",
  requireRole("SUPER_ADMIN"),
  asyncHandler(async (_req, res) => {
    const settings = await getSettings();
    if (!settings.whatsappWebRiskAck) throw badRequest("Acknowledge the WhatsApp Web risk first.", "risk_not_ack");
    await whatsappWeb.connect();
    res.json({ web: await whatsappWeb.status() });
  }),
);

whatsappRouter.post(
  "/whatsapp/web/logout",
  requireRole("SUPER_ADMIN"),
  asyncHandler(async (_req, res) => {
    await whatsappWeb.logout();
    res.json({ web: await whatsappWeb.status() });
  }),
);
