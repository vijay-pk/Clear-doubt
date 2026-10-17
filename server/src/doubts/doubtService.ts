import { randomUUID, createHash } from "node:crypto";
import { prisma } from "../db/prisma.js";
import { env } from "../config/env.js";
import { getStorage } from "../storage/storage.js";
import { enqueue } from "../jobs/queue.js";
import { writeAudit } from "../audit/audit.js";
import { badRequest, forbidden, notFound, tooMany } from "../lib/errors.js";

export interface ImageInput {
  bytes: Buffer;
  mimeType: string;
  originalName: string;
}

async function enforceRateLimit(studentId: string) {
  const since = new Date(Date.now() - 60 * 60 * 1000);
  const count = await prisma.doubtMessage.count({
    where: { sender: "STUDENT", createdAt: { gte: since }, doubt: { studentId } },
  });
  if (count >= env.STUDENT_RATE_PER_HOUR) {
    throw tooMany("You've asked a lot of questions this hour. Please try again later.", "rate_limited");
  }
}

async function storeImage(studentId: string, image: ImageInput, doubtMessageId: string) {
  const ext = image.mimeType.split("/")[1]?.replace("jpeg", "jpg") ?? "bin";
  const key = `doubts/${studentId}/${randomUUID()}.${ext}`;
  await getStorage().put(key, image.bytes, image.mimeType);
  return prisma.attachment.create({
    data: {
      doubtMessageId,
      storageKey: key,
      originalName: image.originalName.slice(0, 200),
      mimeType: image.mimeType,
      sizeBytes: image.bytes.length,
      sha256: createHash("sha256").update(image.bytes).digest("hex"),
      status: "PENDING",
    },
  });
}

export async function createDoubt(
  studentId: string,
  input: { title?: string; body: string; image?: ImageInput },
) {
  const body = input.body.trim();
  if (!body && !input.image) throw badRequest("Type your question or attach a photo.", "empty_doubt");
  await enforceRateLimit(studentId);

  const title = (input.title?.trim() || body || "Photo question").slice(0, 120);

  const doubt = await prisma.doubt.create({
    data: {
      studentId,
      title,
      status: "OPEN",
      messages: {
        create: { sender: "STUDENT", kind: input.image ? "IMAGE" : "TEXT", body: body || "(photo question)" },
      },
    },
    include: { messages: true },
  });
  const message = doubt.messages[0]!;

  if (input.image) {
    const att = await storeImage(studentId, input.image, message.id);
    await enqueue("processImage", { attachmentId: att.id }, { dedupeKey: `img:${message.id}` });
  } else {
    await enqueue("generateAnswer", { questionMessageId: message.id }, { dedupeKey: `gen:${message.id}` });
  }

  await writeAudit({ actorId: studentId, action: "doubt.create", entityType: "Doubt", entityId: doubt.id });
  return doubt;
}

export async function addMessage(
  studentId: string,
  doubtId: string,
  input: { body: string; image?: ImageInput },
) {
  const doubt = await prisma.doubt.findUnique({ where: { id: doubtId } });
  if (!doubt) throw notFound("Doubt not found");
  if (doubt.studentId !== studentId) throw forbidden();
  const body = input.body.trim();
  if (!body && !input.image) throw badRequest("Type a message or attach a photo.", "empty_message");
  await enforceRateLimit(studentId);

  const message = await prisma.doubtMessage.create({
    data: { doubtId, sender: "STUDENT", kind: input.image ? "IMAGE" : "TEXT", body: body || "(photo question)" },
  });
  await prisma.doubt.update({ where: { id: doubtId }, data: { status: "OPEN" } });

  if (input.image) {
    const att = await storeImage(studentId, input.image, message.id);
    await enqueue("processImage", { attachmentId: att.id }, { dedupeKey: `img:${message.id}` });
  } else {
    await enqueue("generateAnswer", { questionMessageId: message.id }, { dedupeKey: `gen:${message.id}` });
  }
  await writeAudit({ actorId: studentId, action: "doubt.message", entityType: "Doubt", entityId: doubtId });
  return message;
}

// ---- Scoped reads (a student only ever sees their own data) ----

export async function listDoubts(studentId: string) {
  return prisma.doubt.findMany({
    where: { studentId },
    orderBy: { updatedAt: "desc" },
    select: { id: true, title: true, status: true, createdAt: true, updatedAt: true },
  });
}

export async function getDoubtForStudent(studentId: string, doubtId: string) {
  const doubt = await prisma.doubt.findUnique({
    where: { id: doubtId },
    include: {
      messages: { orderBy: { createdAt: "asc" }, include: { attachments: { select: { id: true, mimeType: true, originalName: true, status: true } } } },
    },
  });
  if (!doubt) throw notFound("Doubt not found");
  if (doubt.studentId !== studentId) throw forbidden(); // no cross-student access via id
  return doubt;
}
