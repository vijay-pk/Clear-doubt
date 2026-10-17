import { randomUUID } from "node:crypto";
import { prisma } from "../../db/prisma.js";
import { getStorage } from "../../storage/storage.js";
import { extractText } from "../../transcripts/extract.js";
import { chunkText } from "../../transcripts/chunker.js";
import { getEmbedder } from "../../embeddings/embedder.js";
import { vectorLiteral } from "../../embeddings/vectorStore.js";
import { logger } from "../../lib/logger.js";

interface Payload {
  documentId: string;
}

export async function processDocument(payloadRaw: unknown): Promise<void> {
  const { documentId } = payloadRaw as Payload;
  const doc = await prisma.courseDocument.findUnique({ where: { id: documentId } });
  if (!doc) return;

  await prisma.courseDocument.update({ where: { id: documentId }, data: { status: "PROCESSING", error: null } });

  try {
    const bytes = await getStorage().getBytes(doc.storageKey);
    const text = await extractText(bytes, doc.mimeType, doc.originalName);
    const chunks = chunkText(text);
    if (chunks.length === 0) throw new Error("No extractable text in document");

    // Replace any prior chunks (reprocessing).
    await prisma.$executeRawUnsafe(`DELETE FROM "DocumentChunk" WHERE "documentId" = $1`, documentId);

    const embedder = getEmbedder();
    const embeddings = embedder.enabled ? await embedder.embed(chunks.map((c) => c.content)) : [];

    for (let i = 0; i < chunks.length; i++) {
      const c = chunks[i]!;
      const id = randomUUID();
      const emb = embeddings[i];
      if (emb) {
        await prisma.$executeRawUnsafe(
          `INSERT INTO "DocumentChunk" (id, "documentId", ordinal, content, "tokenCount", embedding)
           VALUES ($1,$2,$3,$4,$5, ${vectorLiteral(emb)})`,
          id,
          documentId,
          c.ordinal,
          c.content,
          c.tokenCount,
        );
      } else {
        await prisma.$executeRawUnsafe(
          `INSERT INTO "DocumentChunk" (id, "documentId", ordinal, content, "tokenCount")
           VALUES ($1,$2,$3,$4,$5)`,
          id,
          documentId,
          c.ordinal,
          c.content,
          c.tokenCount,
        );
      }
    }

    await prisma.courseDocument.update({ where: { id: documentId }, data: { status: "READY" } });
    logger.info({ documentId, chunks: chunks.length }, "document processed");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.courseDocument.update({ where: { id: documentId }, data: { status: "FAILED", error: message.slice(0, 500) } });
    throw err;
  }
}
