import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db/prisma.js";
import { asyncHandler } from "../../http/helpers.js";
import { approveDraft, rejectDraft, regenerateDraft } from "../../responses/approvalService.js";
import { promoteDraft } from "../../responses/approvedAnswerService.js";
import { notFound } from "../../lib/errors.js";

export const draftsRouter = Router();

// Pending approval queue (the core admin workflow).
draftsRouter.get(
  "/queue",
  asyncHandler(async (req, res) => {
    const status = (req.query.status as string) || "PENDING_APPROVAL";
    const drafts = await prisma.responseDraft.findMany({
      where: { status: status as never },
      orderBy: { createdAt: "asc" },
      include: {
        doubt: { include: { student: { select: { id: true, name: true, email: true } } } },
        questionMessage: { include: { attachments: { select: { id: true, mimeType: true, status: true } } } },
        _count: { select: { citations: true } },
      },
    });
    res.json({ drafts });
  }),
);

draftsRouter.get(
  "/drafts/:id",
  asyncHandler(async (req, res) => {
    const draft = await prisma.responseDraft.findUnique({
      where: { id: String(req.params.id) },
      include: {
        doubt: {
          include: {
            student: { select: { id: true, name: true, email: true } },
            messages: { orderBy: { createdAt: "asc" }, include: { attachments: { select: { id: true, mimeType: true, originalName: true, status: true, ocrText: true } } } },
          },
        },
        questionMessage: { include: { attachments: true } },
        citations: true,
      },
    });
    if (!draft) throw notFound("Draft not found");
    res.json({ draft });
  }),
);

draftsRouter.post(
  "/drafts/:id/approve",
  asyncHandler(async (req, res) => {
    const { editedText } = z.object({ editedText: z.string().max(8000).optional() }).parse(req.body ?? {});
    await approveDraft(String(req.params.id), req.user!.id, editedText);
    res.json({ ok: true });
  }),
);

draftsRouter.post(
  "/drafts/:id/reject",
  asyncHandler(async (req, res) => {
    const { reason } = z.object({ reason: z.string().max(500).optional() }).parse(req.body ?? {});
    await rejectDraft(String(req.params.id), req.user!.id, reason);
    res.json({ ok: true });
  }),
);

draftsRouter.post(
  "/drafts/:id/regenerate",
  asyncHandler(async (req, res) => {
    await regenerateDraft(String(req.params.id), req.user!.id);
    res.json({ ok: true });
  }),
);

// Promote a sent/approved answer into Approved Answer Memory.
draftsRouter.post(
  "/drafts/:id/promote",
  asyncHandler(async (req, res) => {
    const row = await promoteDraft(String(req.params.id), req.user!.id);
    res.status(201).json({ approvedAnswer: { id: row.id } });
  }),
);
