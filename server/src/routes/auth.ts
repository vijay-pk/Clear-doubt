import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import { asyncHandler, clientIp } from "../http/helpers.js";
import { authLimiter } from "../middleware/rateLimit.js";
import { requireAuth } from "../middleware/authContext.js";
import {
  registerStudent,
  authenticate,
  normalizeEmail,
  issueToken,
  consumeToken,
  markEmailVerified,
  changeOwnPassword,
  resetPasswordWithToken,
} from "../auth/authService.js";
import { createSession, setSessionCookie, clearSessionCookie, destroySession } from "../auth/sessionService.js";
import { enqueue } from "../jobs/queue.js";
import { badRequest } from "../lib/errors.js";
import { env } from "../config/env.js";
import { writeAudit } from "../audit/audit.js";
import { normalizePhone } from "../lib/phone.js";

export const authRouter = Router();
authRouter.use(authLimiter);

const registerSchema = z.object({
  email: z.string().email(),
  name: z.string().min(2).max(80),
  password: z.string().min(10).max(200),
  phone: z.string().max(30).optional(),
});

authRouter.post(
  "/register",
  asyncHandler(async (req, res) => {
    const input = registerSchema.parse(req.body);
    await registerStudent(input);
    res.status(201).json({ ok: true, message: "Account created. You can sign in now." });
  }),
);

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

authRouter.post(
  "/login",
  asyncHandler(async (req, res) => {
    const { email, password } = loginSchema.parse(req.body);
    const user = await authenticate(email, password);
    const { token, csrfToken } = await createSession(user.id, {
      ip: clientIp(req),
      userAgent: req.get("user-agent") ?? undefined,
    });
    setSessionCookie(res, token, csrfToken);
    await writeAudit({ actorId: user.id, action: "auth.login", entityType: "User", entityId: user.id, ip: clientIp(req) });
    res.json({
      user: { id: user.id, email: user.email, name: user.name, role: user.role, emailVerified: user.emailVerified },
      // where the SPA should route this user
      redirect: user.role === "STUDENT" ? "/chat" : "/admin",
    });
  }),
);

authRouter.post(
  "/logout",
  asyncHandler(async (req, res) => {
    const token = req.cookies?.[env.SESSION_COOKIE_NAME];
    if (token) await destroySession(token);
    clearSessionCookie(res);
    res.json({ ok: true });
  }),
);

authRouter.post(
  "/verify-email",
  asyncHandler(async (req, res) => {
    const { token } = z.object({ token: z.string().min(10) }).parse(req.body);
    const userId = await consumeToken(token, "EMAIL_VERIFY");
    await markEmailVerified(userId);
    res.json({ ok: true, message: "Email verified. You can now sign in." });
  }),
);

authRouter.post(
  "/resend-verification",
  asyncHandler(async (req, res) => {
    const { email } = z.object({ email: z.string().email() }).parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: normalizeEmail(email) } });
    if (user && !user.emailVerified && user.role === "STUDENT") {
      const token = await issueToken(user.id, "EMAIL_VERIFY");
      await enqueue("sendEmail", { type: "verify", userId: user.id, token });
    }
    // Always 200 to avoid user enumeration.
    res.json({ ok: true, message: "If that account needs verification, we've sent a new link." });
  }),
);

authRouter.post(
  "/forgot-password",
  asyncHandler(async (req, res) => {
    const { email } = z.object({ email: z.string().email() }).parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: normalizeEmail(email) } });
    // Admins change passwords from the dashboard; still allow reset for students.
    if (user && user.role === "STUDENT") {
      const token = await issueToken(user.id, "PASSWORD_RESET");
      await enqueue("sendEmail", { type: "reset", userId: user.id, token });
    }
    res.json({ ok: true, message: "If an account exists, a reset link is on its way." });
  }),
);

authRouter.post(
  "/reset-password",
  asyncHandler(async (req, res) => {
    const { token, password } = z.object({ token: z.string().min(10), password: z.string().min(10).max(200) }).parse(req.body);
    const userId = await consumeToken(token, "PASSWORD_RESET");
    await resetPasswordWithToken(userId, password);
    res.json({ ok: true, message: "Password updated. Please sign in." });
  }),
);

// Authenticated self endpoints
authRouter.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const row = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { phone: true } });
    res.json({ user: { ...req.user, phone: row?.phone ?? null }, csrfToken: req.csrfSecret });
  }),
);

// Student sets/updates their own WhatsApp number (used to deliver tutor answers).
authRouter.post(
  "/phone",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { phone: raw } = z.object({ phone: z.string().max(30) }).parse(req.body);
    const phone = normalizePhone(raw);
    if (!phone) throw badRequest("Enter a valid WhatsApp number with country code, e.g. +91 98765 43210.", "invalid_phone");
    await prisma.user.update({ where: { id: req.user!.id }, data: { phone } });
    await writeAudit({ actorId: req.user!.id, action: "user.phone_update", entityType: "User", entityId: req.user!.id });
    res.json({ ok: true, phone });
  }),
);

authRouter.post(
  "/change-password",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = z
      .object({ currentPassword: z.string().min(1), newPassword: z.string().min(10).max(200) })
      .parse(req.body);
    if (!req.user) throw badRequest("Not authenticated");
    await changeOwnPassword(req.user.id, currentPassword, newPassword);
    res.json({ ok: true, message: "Password changed." });
  }),
);
