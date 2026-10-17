import express, { Router } from "express";
import { verifyWebhookChallenge, verifyWebhookSignature } from "../messaging/whatsappCloud.js";
import { logger } from "../lib/logger.js";

// Mounted BEFORE the JSON body parser: the signature is computed over the raw body.
export const webhookRouter = Router();

// Meta verification handshake.
webhookRouter.get("/whatsapp", (req, res) => {
  const mode = String(req.query["hub.mode"] ?? "");
  const token = String(req.query["hub.verify_token"] ?? "");
  const challenge = String(req.query["hub.challenge"] ?? "");
  if (verifyWebhookChallenge(mode, token)) return res.status(200).send(challenge);
  res.sendStatus(403);
});

// Inbound events. We verify X-Hub-Signature-256 against the raw body.
webhookRouter.post("/whatsapp", express.raw({ type: "*/*", limit: "1mb" }), (req, res) => {
  const raw = req.body as Buffer;
  const sig = req.get("x-hub-signature-256");
  if (!verifyWebhookSignature(raw, sig)) {
    logger.warn("whatsapp webhook: bad signature");
    return res.sendStatus(401);
  }
  // Acknowledge fast; this platform is outbound-first (students use the portal).
  // Inbound WhatsApp handling can be wired here later if two-way chat is enabled.
  res.sendStatus(200);
});
