import { prisma } from "../../db/prisma.js";
import { deliverDraft } from "../../responses/deliveryService.js";
import { finalText } from "../../responses/approvalService.js";
import { sendWhatsAppText } from "../../messaging/whatsappCloud.js";

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
    include: { doubt: { include: { student: true } } },
  });
  if (!draft) return;
  const phone = draft.doubt.student.phone;
  if (!phone) {
    await prisma.deliveryLog.update({ where: { id: log.id }, data: { status: "SKIPPED", error: "no phone on file" } });
    return;
  }

  await prisma.deliveryLog.update({ where: { id: log.id }, data: { status: "SENDING", attempts: { increment: 1 } } });
  try {
    const res = await sendWhatsAppText(phone, finalText(draft));
    await prisma.deliveryLog.update({
      where: { id: log.id },
      data: { status: "SENT", sentAt: new Date(), providerMessageId: res.id, error: null },
    });
  } catch (err) {
    await prisma.deliveryLog.update({
      where: { id: log.id },
      data: { status: "FAILED", error: (err instanceof Error ? err.message : String(err)).slice(0, 500) },
    });
    throw err;
  }
}
