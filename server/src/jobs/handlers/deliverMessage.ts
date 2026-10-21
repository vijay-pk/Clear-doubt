import { prisma } from "../../db/prisma.js";
import { deliverDraft } from "../../responses/deliveryService.js";
import { finalText } from "../../responses/approvalService.js";
import { sendWhatsApp } from "../../messaging/whatsappSend.js";
import { NotOnWhatsAppError } from "../../messaging/whatsappWeb.js";
import { formatWhatsAppAnswer } from "../../messaging/whatsappFormat.js";
import { getSettings } from "../../settings/settingsService.js";

type Payload = { draftId: string } | { whatsappDeliveryLogId: string };

export async function deliverMessage(payloadRaw: unknown): Promise<void> {
  const payload = payloadRaw as Payload;

  if ("draftId" in payload) {
    await deliverDraft(payload.draftId);
    return;
  }

  // WhatsApp channel send for a specific DeliveryLog.
  const log = await prisma.deliveryLog.findUnique({ where: { id: payload.whatsappDeliveryLogId } });
  if (!log || log.status === "SENT") return;
  const draft = await prisma.responseDraft.findUnique({
    where: { id: log.draftId },
    include: { doubt: { include: { student: true } }, questionMessage: true },
  });
  if (!draft) return;
  const phone = draft.doubt.student.phone;
  if (!phone) {
    await prisma.deliveryLog.update({ where: { id: log.id }, data: { status: "SKIPPED", error: "no phone on file" } });
    return;
  }

  await prisma.deliveryLog.update({ where: { id: log.id }, data: { status: "SENDING", attempts: { increment: 1 } } });
  try {
    const settings = await getSettings();
    const text = formatWhatsAppAnswer({
      question: draft.questionMessage?.body || draft.doubt.title,
      answer: finalText(draft),
      isClarification: draft.isClarification,
    });
    const res = await sendWhatsApp(phone, text, settings);
    await prisma.deliveryLog.update({
      where: { id: log.id },
      data: { status: "SENT", sentAt: new Date(), providerMessageId: res.id, error: null },
    });
  } catch (err) {
    if (err instanceof NotOnWhatsAppError) {
      // Permanent: the student's number has no WhatsApp account. Don't retry.
      await prisma.deliveryLog.update({ where: { id: log.id }, data: { status: "SKIPPED", error: err.message } });
      return;
    }
    await prisma.deliveryLog.update({
      where: { id: log.id },
      data: { status: "FAILED", error: (err instanceof Error ? err.message : String(err)).slice(0, 500) },
    });
    throw err;
  }
}
