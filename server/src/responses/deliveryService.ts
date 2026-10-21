import type { DeliveryChannel } from "@prisma/client";
import { prisma } from "../db/prisma.js";
import { getSettings } from "../settings/settingsService.js";
import { enqueue } from "../jobs/queue.js";
import { writeAudit } from "../audit/audit.js";
import { logger } from "../lib/logger.js";
import { finalText } from "./approvalService.js";
import { whatsappEnabled } from "../messaging/whatsappSend.js";

// Deliver an APPROVED draft across the configured channels. Idempotent: the
// APPROVED->SENDING claim runs once; each channel has its own DeliveryLog keyed
// by (draftId, channel) so one channel failing never duplicates another's send.
export async function deliverDraft(draftId: string): Promise<void> {
  const draft = await prisma.responseDraft.findUnique({
    where: { id: draftId },
    include: { doubt: { include: { student: true } } },
  });
  if (!draft) return;

  // Only APPROVED drafts deliver. (A re-run on an already-SENT draft is harmless:
  // every channel's DeliveryLog has a unique (draftId, channel) key and is upserted,
  // so nothing is sent twice.) Anything else is skipped.
  if (draft.status !== "APPROVED" && draft.status !== "SENT") {
    logger.debug({ draftId, status: draft.status }, "deliver: not approved, skipping");
    return;
  }

  // Emergency pause only blocks AUTO sends (no human decided). Human approvals send.
  const settings = await getSettings();
  if (draft.decidedById === null && settings.autoReplyPaused) {
    await prisma.responseDraft.update({ where: { id: draftId }, data: { status: "PENDING_APPROVAL", autoEligible: false } });
    await writeAudit({ action: "draft.auto_aborted_paused", entityType: "ResponseDraft", entityId: draftId });
    return;
  }

  const text = finalText(draft);
  const student = draft.doubt.student;

  // Determine channels.
  const channels = new Set<DeliveryChannel>(["WEBSITE"]); // portal always
  for (const ch of settings.defaultDeliveryChannels) {
    if (ch === "EMAIL" && student.email) channels.add("EMAIL");
    if (ch === "WHATSAPP" && whatsappEnabled(settings) && student.phone) channels.add("WHATSAPP");
  }

  // Website: post the tutor message into the thread (inline, synchronous).
  if (channels.has("WEBSITE")) {
    await deliverWebsite(draftId, draft.doubtId, text, draft.isClarification);
  }

  // Email / WhatsApp: create a DeliveryLog and enqueue a per-channel job.
  for (const ch of channels) {
    if (ch === "WEBSITE") continue;
    const idempotencyKey = `${draftId}:${ch}`;
    const log = await prisma.deliveryLog.upsert({
      where: { idempotencyKey },
      create: { draftId, channel: ch, status: "PENDING", idempotencyKey },
      update: {}, // keep existing — never create a second log for the same channel
    });
    if (log.status === "PENDING") {
      if (ch === "EMAIL") await enqueue("sendEmail", { deliveryLogId: log.id }, { dedupeKey: `email:${log.id}` });
      // WhatsApp delivered via deliverMessage-style job (see whatsapp handler wiring)
      // Generous retries (backoff caps at 60s ≈ 30 min total) so a WhatsApp Web
      // reconnect or server restart delays the message instead of losing it.
      if (ch === "WHATSAPP") await enqueue("deliverMessage", { whatsappDeliveryLogId: log.id }, { dedupeKey: `wa:${log.id}`, maxAttempts: 30 });
    }
  }

  await prisma.responseDraft.update({ where: { id: draftId }, data: { status: "SENT" } });
  await writeAudit({ action: "draft.sent", entityType: "ResponseDraft", entityId: draftId, meta: { channels: [...channels] } });
}

async function deliverWebsite(draftId: string, doubtId: string, text: string, isClarification: boolean) {
  const idempotencyKey = `${draftId}:WEBSITE`;
  const existing = await prisma.deliveryLog.findUnique({ where: { idempotencyKey } });
  if (existing && existing.status === "SENT") return;

  await prisma.$transaction(async (tx) => {
    await tx.doubtMessage.create({
      data: { doubtId, sender: "TUTOR", kind: "TEXT", body: text },
    });
    // A clarification request leaves the doubt waiting on the student's reply.
    await tx.doubt.update({ where: { id: doubtId }, data: { status: isClarification ? "AWAITING_STUDENT" : "ANSWERED" } });
    await tx.deliveryLog.upsert({
      where: { idempotencyKey },
      create: { draftId, channel: "WEBSITE", status: "SENT", idempotencyKey, sentAt: new Date() },
      update: { status: "SENT", sentAt: new Date() },
    });
  });
}
