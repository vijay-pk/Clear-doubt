import { prisma } from "../../db/prisma.js";
import { getStorage } from "../../storage/storage.js";
import { getAI } from "../../ai/getAI.js";
import { enqueue } from "../queue.js";
import { logger } from "../../lib/logger.js";

interface Payload {
  attachmentId: string;
}

// OCR + vision on an uploaded image doubt, then trigger answer generation.
export async function processImage(payloadRaw: unknown): Promise<void> {
  const { attachmentId } = payloadRaw as Payload;
  const att = await prisma.attachment.findUnique({ where: { id: attachmentId }, include: { doubtMessage: true } });
  if (!att) return;

  try {
    const bytes = await getStorage().getBytes(att.storageKey);
    const result = await getAI().readImage({ imageBase64: bytes.toString("base64"), mimeType: att.mimeType });

    await prisma.attachment.update({
      where: { id: attachmentId },
      data: {
        ocrText: result.text,
        visionText: result.description,
        status: result.readable ? "PROCESSED" : "UNREADABLE",
      },
    });
    logger.info({ attachmentId, readable: result.readable }, "image processed");
  } catch (err) {
    await prisma.attachment.update({
      where: { id: attachmentId },
      data: { status: "UNREADABLE", error: (err instanceof Error ? err.message : String(err)).slice(0, 300) },
    });
    // Still generate (will produce a clarification), don't dead-end the student.
  }

  await enqueue(
    "generateAnswer",
    { questionMessageId: att.doubtMessageId },
    { dedupeKey: `gen:${att.doubtMessageId}` },
  );
}
