import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import { asyncHandler } from "../http/helpers.js";
import { requireAuth } from "../middleware/authContext.js";
import { imageUpload, validateImage } from "../middleware/upload.js";
import { createDoubt, addMessage, listDoubts, getDoubtForStudent, type ImageInput } from "../doubts/doubtService.js";
import { getStorage } from "../storage/storage.js";
import { forbidden, notFound } from "../lib/errors.js";

export const doubtsRouter = Router();
doubtsRouter.use(requireAuth);

// Only students use the doubt portal; admins have the dashboard.
function studentOnly(req: Express.Request): string {
  if (!req.user || req.user.role !== "STUDENT") throw forbidden("Student account required.", "not_student");
  return req.user.id;
}

doubtsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const studentId = studentOnly(req);
    res.json({ doubts: await listDoubts(studentId) });
  }),
);

doubtsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const studentId = studentOnly(req);
    const doubt = await getDoubtForStudent(studentId, String(req.params.id));
    res.json({ doubt });
  }),
);

const createSchema = z.object({ title: z.string().max(120).optional(), body: z.string().max(4000).optional() });

doubtsRouter.post(
  "/",
  imageUpload.single("image"),
  asyncHandler(async (req, res) => {
    const studentId = studentOnly(req);
    const { title, body } = createSchema.parse(req.body);
    let image: ImageInput | undefined;
    if (req.file) {
      const { mime } = await validateImage(req.file.buffer);
      image = { bytes: req.file.buffer, mimeType: mime, originalName: req.file.originalname };
    }
    const doubt = await createDoubt(studentId, { title, body: body ?? "", image });
    res.status(201).json({ doubt });
  }),
);

doubtsRouter.post(
  "/:id/messages",
  imageUpload.single("image"),
  asyncHandler(async (req, res) => {
    const studentId = studentOnly(req);
    const { body } = z.object({ body: z.string().max(4000).optional() }).parse(req.body);
    let image: ImageInput | undefined;
    if (req.file) {
      const { mime } = await validateImage(req.file.buffer);
      image = { bytes: req.file.buffer, mimeType: mime, originalName: req.file.originalname };
    }
    const message = await addMessage(studentId, String(req.params.id), { body: body ?? "", image });
    res.status(201).json({ message });
  }),
);

// Private attachment download — authorized per request (owner or admin only).
doubtsRouter.get(
  "/attachments/:id",
  asyncHandler(async (req, res) => {
    const att = await prisma.attachment.findUnique({
      where: { id: String(req.params.id) },
      include: { doubtMessage: { include: { doubt: true } } },
    });
    if (!att) throw notFound("Attachment not found");
    const owner = att.doubtMessage.doubt.studentId;
    const isAdmin = req.user!.role !== "STUDENT";
    if (!isAdmin && owner !== req.user!.id) throw forbidden(); // block URL tampering
    const signed = await getStorage().createSignedUrl(att.storageKey, 120);
    if (signed) return res.redirect(signed);
    const bytes = await getStorage().getBytes(att.storageKey);
    res.setHeader("Content-Type", att.mimeType);
    res.setHeader("Content-Disposition", `inline; filename="${att.originalName.replace(/"/g, "")}"`);
    res.setHeader("Cache-Control", "private, no-store");
    res.send(bytes);
  }),
);
