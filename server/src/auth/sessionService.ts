import type { Response } from "express";
import { prisma } from "../db/prisma.js";
import { env } from "../config/env.js";
import { generateToken, sha256 } from "../lib/crypto.js";

const TTL_MS = () => env.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;

export interface SessionCreateContext {
  ip?: string;
  userAgent?: string;
}

export async function createSession(userId: string, ctx: SessionCreateContext) {
  const token = generateToken(32);
  const csrfSecret = generateToken(24);
  const session = await prisma.session.create({
    data: {
      userId,
      tokenHash: sha256(token),
      csrfSecret,
      ip: ctx.ip,
      userAgent: ctx.userAgent?.slice(0, 500),
      expiresAt: new Date(Date.now() + TTL_MS()),
    },
  });
  return { token, csrfToken: csrfSecret, sessionId: session.id };
}

export async function loadSession(token: string) {
  const session = await prisma.session.findUnique({
    where: { tokenHash: sha256(token) },
    include: { user: true },
  });
  if (!session) return null;
  if (session.expiresAt.getTime() < Date.now()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }
  // Throttle lastSeenAt writes to at most once/5min.
  if (Date.now() - session.lastSeenAt.getTime() > 5 * 60 * 1000) {
    await prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } }).catch(() => {});
  }
  return session;
}

export async function destroySession(token: string) {
  await prisma.session.deleteMany({ where: { tokenHash: sha256(token) } });
}

export async function destroyAllForUser(userId: string) {
  await prisma.session.deleteMany({ where: { userId } });
}

export function setSessionCookie(res: Response, token: string, csrfToken: string) {
  const secure = env.COOKIE_SECURE;
  const maxAge = TTL_MS();
  res.cookie(env.SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    maxAge,
    path: "/",
  });
  // Readable by JS so the SPA can echo it back in the X-CSRF-Token header.
  res.cookie("adways_csrf", csrfToken, {
    httpOnly: false,
    secure,
    sameSite: "lax",
    maxAge,
    path: "/",
  });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(env.SESSION_COOKIE_NAME, { path: "/" });
  res.clearCookie("adways_csrf", { path: "/" });
}
