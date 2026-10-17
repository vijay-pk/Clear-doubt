import { randomUUID, createHash } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db/prisma.js";
import { asyncHandler } from "../../http/helpers.js";
import { documentUpload, validateDocument } from "../../middleware/upload.js";
import { getStorage } from "../../storage/storage.js";
import { enqueue } from "../../jobs/queue.js";
import { createApprovedAnswer } from "../../responses/approvedAnswerService.js";
import { writeAudit } from "../../audit/audit.js";
import { badRequest, notFound } from "../../lib/errors.js";

export const knowledgeRouter = Router();

// ---- Course documents ----
knowledgeRouter.get(
  "/documents",
  asyncHandler(async (_req, res) => {
    const documents = await prisma.courseDocument.findMany({
      orderBy: { createdAt: "desc" },
      include: { uploadedBy: { select: { name: true } } },
    });
    res.json({ documents });
  }),
);

knowledgeRouter.post(
  "/documents",
  documentUpload.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) throw badRequest("Attach a file.", "no_file");
    const { mime } = await validateDocument(req.file.buffer, req.file.originalname);
    const title = z.object({ title: z.string().max(200).optional() }).parse(req.body).title || req.file.originalname;

    const key = `documents/${randomUUID()}-${req.file.originalname.replace(/[^\w.-]/g, "_")}`;
    await getStorage().put(key, req.file.buffer, mime);

    const doc = await prisma.courseDocument.create({
      data: {
        title: title.slice(0, 200),
        originalName: req.file.originalname.slice(0, 200),
        storageKey: key,
        mimeType: mime,
        sizeBytes: req.file.size,
        sha256: createHash("sha256").update(req.file.buffer).digest("hex"),
        status: "UPLOADED",
        uploadedById: req.user!.id,
      },
    });
    await enqueue("processDocument", { documentId: doc.id }, { dedupeKey: `doc:${doc.id}` });
    await writeAudit({ actorId: req.user!.id, action: "document.upload", entityType: "CourseDocument", entityId: doc.id });
    res.status(201).json({ document: doc });
  }),
);

knowledgeRouter.post(
  "/documents/:id/reprocess",
  asyncHandler(async (req, res) => {
    const doc = await prisma.courseDocument.findUnique({ where: { id: String(req.params.id) } });
    if (!doc) throw notFound("Document not found");
    await enqueue("processDocument", { documentId: doc.id }, { dedupeKey: `doc:${doc.id}` });
    res.json({ ok: true });
  }),
);

knowledgeRouter.delete(
  "/documents/:id",
  asyncHandler(async (req, res) => {
    const doc = await prisma.courseDocument.findUnique({ where: { id: String(req.params.id) } });
    if (!doc) throw notFound("Document not found");
    await getStorage().remove(doc.storageKey).catch(() => {});
    await prisma.courseDocument.delete({ where: { id: doc.id } }); // cascades chunks
    await writeAudit({ actorId: req.user!.id, action: "document.delete", entityType: "CourseDocument", entityId: doc.id });
    res.json({ ok: true });
  }),
);

// ---- Approved Answer Memory ----
knowledgeRouter.get(
  "/approved-answers",
  asyncHandler(async (_req, res) => {
    const answers = await prisma.approvedAnswer.findMany({ orderBy: { createdAt: "desc" }, take: 200 });
    res.json({ answers });
  }),
);

knowledgeRouter.post(
  "/approved-answers",
  asyncHandler(async (req, res) => {
    const input = z
      .object({ question: z.string().min(3).max(2000), answer: z.string().min(1).max(8000), tags: z.array(z.string().max(40)).max(10).optional() })
      .parse(req.body);
    const row = await createApprovedAnswer({ ...input, createdById: req.user!.id });
    res.status(201).json({ approvedAnswer: row });
  }),
);

knowledgeRouter.patch(
  "/approved-answers/:id",
  asyncHandler(async (req, res) => {
    const { active } = z.object({ active: z.boolean() }).parse(req.body);
    const row = await prisma.approvedAnswer.update({ where: { id: String(req.params.id) }, data: { active } });
    await writeAudit({ actorId: req.user!.id, action: "approved_answer.toggle", entityType: "ApprovedAnswer", entityId: row.id, meta: { active } });
    res.json({ approvedAnswer: row });
  }),
);
