import { Router } from "express";
import { prisma } from "../../db/prisma.js";
import { asyncHandler } from "../../http/helpers.js";

export const logsRouter = Router();

logsRouter.get(
  "/delivery-logs",
  asyncHandler(async (req, res) => {
    const channel = req.query.channel as string | undefined;
    const status = req.query.status as string | undefined;
    const logs = await prisma.deliveryLog.findMany({
      where: { ...(channel ? { channel: channel as never } : {}), ...(status ? { status: status as never } : {}) },
      orderBy: { createdAt: "desc" },
      take: 200,
      include: { draft: { select: { id: true, doubtId: true } } },
    });
    res.json({ logs });
  }),
);

logsRouter.get(
  "/audit",
  asyncHandler(async (req, res) => {
    const logs = await prisma.auditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 300,
      include: { actor: { select: { name: true, email: true, role: true } } },
    });
    res.json({ logs });
  }),
);
