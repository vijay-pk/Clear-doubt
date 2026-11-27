import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import { asyncHandler, clientIp } from "../http/helpers.js";
import { authLimiter } from "../middleware/rateLimit.js";
import { requireAuth } from "../middleware/authContext.js";
import {
  updateOwnProfile,
  authenticate,
  normalizeEmail,
  issueToken,
  consumeToken,
  markEmailVerified,
  changeOwnPassword,
  resetPasswordWithToken,
} from "../auth/authService.js";
import { derivedState, remainingDays } from "../auth/accessPolicy.js";
import { getSettings } from "../settings/settingsService.js";
import { createSession, setSessionCookie, clearSessionCookie, destroySession } from "../auth/sessionService.js";
import { enqueue } from "../jobs/queue.js";
import { badRequest, forbidden, unauthorized } from "../lib/errors.js";
import { env } from "../config/env.js";
import { writeAudit } from "../audit/audit.js";
import { normalizePhone } from "../lib/phone.js";

export const authRouter = Router();
authRouter.use(authLimiter);

// Public self-registration is disabled: student accounts are created by an admin.
authRouter.post(
  "/register",
  asyncHandler(async (_req, res) => {
    throw forbidden(
      "Your account must be created by an administrator. Please contact your course administrator.",
      "registration_disabled",
    );
    void res;
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
    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } }).catch(() => {});
    await writeAudit({ actorId: user.id, action: "auth.login", entityType: "User", entityId: user.id, ip: clientIp(req) });
    // A student still on the temporary password must change it before anything else.
    const redirect =
      user.role === "STUDENT" ? (user.mustChangePassword ? "/change-password" : "/chat") : "/admin";
    res.json({
      user: { id: user.id, email: user.email, name: user.name, role: user.role, emailVerified: user.emailVerified, mustChangePassword: user.mustChangePassword },
      redirect,
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

// Authenticated self endpoint. Not behind requireAuth so a blocked (expired /
// suspended) session gets a specific 403 the SPA can route on, not a bare 401.
authRouter.get(
  "/me",
  asyncHandler(async (req, res) => {
    if (!req.user) {
      if (req.blockedReason === "expired")
        throw forbidden(
          "Your access period has expired. Please contact your administrator if you need additional access.",
          "account_expired",
        );
      if (req.blockedReason === "suspended") throw forbidden("This account is suspended.", "account_suspended");
      if (req.blockedReason === "deletion_pending")
        throw forbidden("This account is being closed.", "account_closing");
      throw unauthorized();
    }
    const row = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { phone: true, role: true, status: true, accessStartAt: true, accessExpiresAt: true },
    });
    const now = new Date();
    const cfg = await getSettings();
    const access = row
      ? {
          state: derivedState(row, now, cfg),
          accessStartAt: row.accessStartAt,
          accessExpiresAt: row.accessExpiresAt,
          remainingDays: remainingDays(row, now),
        }
      : null;
    res.json({ user: { ...req.user, phone: row?.phone ?? null, access }, csrfToken: req.csrfSecret });
    // req.user already carries mustChangePassword (from authContext), so the SPA
    // can force the change-password screen.
  }),
);

// Any signed-in user updates their own name / email.
authRouter.post(
  "/profile",
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = z
      .object({
        name: z.string().max(80).optional(),
        email: z.string().max(200).optional(),
        currentPassword: z.string().max(200).optional(),
      })
      .parse(req.body);
    const user = await updateOwnProfile(req.user!.id, input);
    res.json({ ok: true, user: { name: user.name, email: user.email } });
  }),
);

// Any signed-in user sets/updates their own WhatsApp number (used to deliver tutor answers).
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
