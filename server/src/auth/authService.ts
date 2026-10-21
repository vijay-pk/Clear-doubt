import type { TokenPurpose } from "@prisma/client";
import { prisma } from "../db/prisma.js";
import { hashPassword, verifyPassword, generateToken, sha256 } from "../lib/crypto.js";
import { badRequest, conflict, unauthorized } from "../lib/errors.js";
import { writeAudit } from "../audit/audit.js";
import { normalizePhone } from "../lib/phone.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function validatePasswordStrength(pw: string): void {
  if (pw.length < 10) throw badRequest("Password must be at least 10 characters.", "weak_password");
  if (!/[a-zA-Z]/.test(pw) || !/[0-9]/.test(pw))
    throw badRequest("Password must include letters and numbers.", "weak_password");
}

const TOKEN_TTL: Record<TokenPurpose, number> = {
  EMAIL_VERIFY: 24 * 60 * 60 * 1000,
  PASSWORD_RESET: 60 * 60 * 1000,
};

export async function issueToken(userId: string, purpose: TokenPurpose) {
  const token = generateToken(32);
  await prisma.verificationToken.create({
    data: {
      userId,
      purpose,
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + TOKEN_TTL[purpose]),
    },
  });
  return token;
}

export async function consumeToken(token: string, purpose: TokenPurpose) {
  const row = await prisma.verificationToken.findUnique({ where: { tokenHash: sha256(token) } });
  if (!row || row.purpose !== purpose || row.usedAt || row.expiresAt.getTime() < Date.now()) {
    throw badRequest("Invalid or expired token.", "invalid_token");
  }
  await prisma.verificationToken.update({ where: { id: row.id }, data: { usedAt: new Date() } });
  return row.userId;
}

export async function registerStudent(input: { email: string; name: string; password: string; phone?: string }) {
  const email = normalizeEmail(input.email);
  if (!EMAIL_RE.test(email)) throw badRequest("Enter a valid email address.", "invalid_email");
  const name = input.name.trim();
  if (name.length < 2) throw badRequest("Please enter your name.", "invalid_name");
  validatePasswordStrength(input.password);
  const phone = input.phone?.trim() ? normalizePhone(input.phone) : null;
  if (input.phone?.trim() && !phone) throw badRequest("Enter a valid WhatsApp number with country code, e.g. +91 98765 43210.", "invalid_phone");

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw conflict("An account with this email already exists.", "email_taken");

  const user = await prisma.user.create({
    data: {
      email,
      name,
      passwordHash: await hashPassword(input.password),
      role: "STUDENT",
      phone,
      emailVerified: true, // email verification is not required
    },
  });
  await writeAudit({ actorId: user.id, action: "student.register", entityType: "User", entityId: user.id });
  return { user };
}

export async function authenticate(email: string, password: string) {
  const normalized = normalizeEmail(email);
  const user = await prisma.user.findUnique({ where: { email: normalized } });
  if (!user) {
    // Spend comparable argon2 time to blunt user-enumeration timing attacks.
    await hashPassword(password);
    throw unauthorized("Incorrect email or password.", "bad_credentials");
  }
  const ok = await verifyPassword(user.passwordHash, password);
  if (!ok) throw unauthorized("Incorrect email or password.", "bad_credentials");
  if (user.status === "SUSPENDED") throw unauthorized("This account is suspended.", "suspended");
  return user;
}

export async function changeOwnPassword(userId: string, currentPassword: string, newPassword: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const ok = await verifyPassword(user.passwordHash, currentPassword);
  if (!ok) throw unauthorized("Current password is incorrect.", "bad_credentials");
  validatePasswordStrength(newPassword);
  await prisma.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(newPassword) } });
  await writeAudit({ actorId: userId, action: "user.password_change", entityType: "User", entityId: userId });
}

export async function markEmailVerified(userId: string) {
  await prisma.user.update({ where: { id: userId }, data: { emailVerified: true } });
  await writeAudit({ actorId: userId, action: "student.email_verified", entityType: "User", entityId: userId });
}

export async function resetPasswordWithToken(userId: string, newPassword: string) {
  validatePasswordStrength(newPassword);
  await prisma.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(newPassword) } });
  // Reset invalidates other sessions.
  await prisma.session.deleteMany({ where: { userId } });
  await writeAudit({ actorId: userId, action: "user.password_reset", entityType: "User", entityId: userId });
}
