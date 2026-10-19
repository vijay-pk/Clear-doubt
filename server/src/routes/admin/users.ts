import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db/prisma.js";
import { asyncHandler } from "../../http/helpers.js";
import { requireRole } from "../../middleware/authContext.js";
import { hashPassword } from "../../lib/crypto.js";
import { normalizeEmail, validatePasswordStrength } from "../../auth/authService.js";
import { destroyAllForUser } from "../../auth/sessionService.js";
import { writeAudit } from "../../audit/audit.js";
import { conflict, notFound, badRequest } from "../../lib/errors.js";

export const usersRouter = Router();

usersRouter.get(
  "/users",
  asyncHandler(async (req, res) => {
    const role = req.query.role as string | undefined;
    const users = await prisma.user.findMany({
      where: role ? { role: role as never } : undefined,
      orderBy: { createdAt: "desc" },
      select: { id: true, email: true, name: true, role: true, status: true, emailVerified: true, createdAt: true },
      take: 500,
    });
    res.json({ users });
  }),
);

// Create an admin — SUPER_ADMIN only. Admins are NEVER self-registered.
usersRouter.post(
  "/users",
  requireRole("SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    const input = z
      .object({
        email: z.string().email(),
        name: z.string().min(2).max(80),
        password: z.string().min(10).max(200),
        role: z.enum(["ADMIN", "SUPER_ADMIN"]),
      })
      .parse(req.body);
    validatePasswordStrength(input.password);
    const email = normalizeEmail(input.email);
    if (await prisma.user.findUnique({ where: { email } })) throw conflict("Email already in use.", "email_taken");
    const user = await prisma.user.create({
      data: { email, name: input.name.trim(), role: input.role, passwordHash: await hashPassword(input.password), emailVerified: true },
    });
    await writeAudit({ actorId: req.user!.id, action: "admin.create", entityType: "User", entityId: user.id, meta: { role: input.role } });
    res.status(201).json({ user: { id: user.id, email: user.email, name: user.name, role: user.role } });
  }),
);

usersRouter.post(
  "/users/:id/suspend",
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: String(req.params.id) } });
    if (!user) throw notFound("User not found");
    if (user.role === "SUPER_ADMIN") throw badRequest("Cannot suspend a super admin.", "protected");
    await prisma.user.update({ where: { id: user.id }, data: { status: "SUSPENDED" } });
    await destroyAllForUser(user.id);
    await writeAudit({ actorId: req.user!.id, action: "user.suspend", entityType: "User", entityId: user.id });
    res.json({ ok: true });
  }),
);

usersRouter.post(
  "/users/:id/unsuspend",
  asyncHandler(async (req, res) => {
    await prisma.user.update({ where: { id: String(req.params.id) }, data: { status: "ACTIVE" } });
    await writeAudit({ actorId: req.user!.id, action: "user.unsuspend", entityType: "User", entityId: String(req.params.id) });
    res.json({ ok: true });
  }),
);

// Permanently delete a user (super admin only). Cascades their doubts, messages,
// attachments and sessions. Cannot delete a super admin or yourself.
usersRouter.delete(
  "/users/:id",
  requireRole("SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    if (id === req.user!.id) throw badRequest("You can't delete your own account.", "self_delete");
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) throw notFound("User not found");
    if (user.role === "SUPER_ADMIN") throw badRequest("Cannot delete a super admin.", "protected");
    try {
      await prisma.user.delete({ where: { id } });
    } catch {
      throw badRequest("Can't delete this user — they may own course documents or approved answers.", "has_dependencies");
    }
    await writeAudit({ actorId: req.user!.id, action: "user.delete", entityType: "User", entityId: id, meta: { email: user.email, role: user.role } });
    res.json({ ok: true });
  }),
);

// Reset another user's password — SUPER_ADMIN only (admin credentials are
// changed from the dashboard, never self-service by students for admins).
usersRouter.post(
  "/users/:id/reset-password",
  requireRole("SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    const { password } = z.object({ password: z.string().min(10).max(200) }).parse(req.body);
    validatePasswordStrength(password);
    const user = await prisma.user.findUnique({ where: { id: String(req.params.id) } });
    if (!user) throw notFound("User not found");
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(password) } });
    await destroyAllForUser(user.id);
    await writeAudit({ actorId: req.user!.id, action: "user.admin_reset_password", entityType: "User", entityId: user.id });
    res.json({ ok: true });
  }),
);
