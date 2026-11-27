import { prisma } from "../../db/prisma.js";
import { getEmailProvider } from "../../email/emailService.js";
import { answerEmail, verificationEmail, passwordResetEmail, credentialEmail } from "../../email/templates.js";
import { getSettings } from "../../settings/settingsService.js";
import { finalText } from "../../responses/approvalService.js";

type Payload =
  | { type: "answer"; deliveryLogId: string }
  | { type: "verify"; userId: string; token: string }
  | { type: "reset"; userId: string; token: string }
  | { type: "credential"; userId: string };

const fmtDate = (d: Date | null) =>
  d ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(d) : "—";

export async function sendEmail(payloadRaw: unknown): Promise<void> {
  const payload = payloadRaw as Payload;

  if (payload.type === "verify" || payload.type === "reset") {
    const user = await prisma.user.findUnique({ where: { id: payload.userId } });
    if (!user) return;
    const msg =
      payload.type === "verify"
        ? verificationEmail(user.email, user.name, payload.token)
        : passwordResetEmail(user.email, user.name, payload.token);
    await getEmailProvider().send(msg);
    return;
  }

  // Student credential (welcome) email. The temp password is read from settings at
  // send time — never stored in the job payload or logged.
  if (payload.type === "credential") {
    const user = await prisma.user.findUnique({ where: { id: payload.userId } });
    if (!user || user.role !== "STUDENT") return;
    const { studentTempPassword } = await getSettings();
    try {
      const res = await getEmailProvider().send(
        credentialEmail(user.email, user.name, studentTempPassword, fmtDate(user.accessExpiresAt)),
      );
      await prisma.user.update({
        where: { id: user.id },
        data: { credentialEmailStatus: "SENT", credentialEmailSentAt: new Date(), credentialEmailMessageId: res.id ?? null },
      });
    } catch (err) {
      await prisma.user.update({ where: { id: user.id }, data: { credentialEmailStatus: "FAILED" } });
      throw err; // retry with backoff
    }
    return;
  }

  // Answer delivery via DeliveryLog (retry-safe, idempotent).
  const log = await prisma.deliveryLog.findUnique({ where: { id: payload.deliveryLogId } });
  if (!log || log.status === "SENT") return;

  const draft = await prisma.responseDraft.findUnique({
    where: { id: log.draftId },
    include: { doubt: { include: { student: true, messages: { where: { sender: "STUDENT" }, orderBy: { createdAt: "desc" }, take: 1 } } } },
  });
  if (!draft) return;
  const student = draft.doubt.student;
  const question = draft.doubt.messages[0]?.body ?? "your question";

  await prisma.deliveryLog.update({ where: { id: log.id }, data: { status: "SENDING", attempts: { increment: 1 } } });
  try {
    const res = await getEmailProvider().send(answerEmail(student.email, student.name, question, finalText(draft)));
    await prisma.deliveryLog.update({
      where: { id: log.id },
      data: { status: "SENT", sentAt: new Date(), providerMessageId: res.id ?? null, error: null },
    });
  } catch (err) {
    await prisma.deliveryLog.update({
      where: { id: log.id },
      data: { status: "FAILED", error: (err instanceof Error ? err.message : String(err)).slice(0, 500) },
    });
    throw err; // let the job queue retry with backoff
  }
}
