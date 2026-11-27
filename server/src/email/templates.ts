import { env } from "../config/env.js";
import type { EmailMessage } from "./emailService.js";

const BRAND = "Adways Academy";

function layout(title: string, bodyHtml: string): string {
  return `<!doctype html><html><body style="margin:0;background:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:520px;margin:0 auto;padding:32px 16px;">
    <div style="background:#fff;border-radius:18px;padding:32px;box-shadow:0 1px 3px rgba(0,0,0,.06);">
      <h1 style="font-size:20px;margin:0 0 16px;color:#1d1d1f;">${title}</h1>
      <div style="font-size:15px;line-height:1.6;color:#1d1d1f;">${bodyHtml}</div>
    </div>
    <p style="text-align:center;color:#86868b;font-size:12px;margin-top:20px;">${BRAND}</p>
  </div></body></html>`;
}

function button(href: string, label: string): string {
  return `<a href="${href}" style="display:inline-block;background:#0071e3;color:#fff;text-decoration:none;padding:12px 22px;border-radius:980px;font-weight:500;margin:12px 0;">${label}</a>`;
}

export function verificationEmail(to: string, name: string, token: string): EmailMessage {
  const link = `${env.APP_URL}/verify-email?token=${encodeURIComponent(token)}`;
  return {
    to,
    subject: `Verify your ${BRAND} account`,
    html: layout(
      "Confirm your email",
      `<p>Hi ${escapeHtml(name)},</p><p>Confirm your email to start asking doubts.</p>${button(link, "Verify email")}<p style="color:#86868b;font-size:13px;">This link expires in 24 hours. If you did not sign up, ignore this email.</p>`,
    ),
    text: `Hi ${name},\nVerify your email: ${link}\nThis link expires in 24 hours.`,
  };
}

export function passwordResetEmail(to: string, name: string, token: string): EmailMessage {
  const link = `${env.APP_URL}/reset-password?token=${encodeURIComponent(token)}`;
  return {
    to,
    subject: `Reset your ${BRAND} password`,
    html: layout(
      "Reset your password",
      `<p>Hi ${escapeHtml(name)},</p><p>Use the button below to set a new password.</p>${button(link, "Reset password")}<p style="color:#86868b;font-size:13px;">This link expires in 1 hour. If you did not request this, ignore this email.</p>`,
    ),
    text: `Hi ${name},\nReset your password: ${link}\nThis link expires in 1 hour.`,
  };
}

export function credentialEmail(
  to: string,
  name: string,
  tempPassword: string,
  expiryDate: string,
): EmailMessage {
  const loginUrl = env.APP_LOGIN_URL ?? `${env.APP_URL}/login`;
  const rows = [
    ["Email", escapeHtml(to)],
    ["Temporary password", escapeHtml(tempPassword)],
    ["Access expires on", escapeHtml(expiryDate)],
  ]
    .map(
      ([k, v]) =>
        `<tr><td style="padding:6px 0;color:#86868b;">${k}</td><td style="padding:6px 0;text-align:right;font-weight:600;">${v}</td></tr>`,
    )
    .join("");
  return {
    to,
    subject: `Your ${BRAND} Student Account Is Ready`,
    html: layout(
      "Your student account is ready",
      `<p>Hello ${escapeHtml(name)},</p>
       <p>Your account for ${BRAND}'s Doubt Clearing Platform has been created. Here are your login details:</p>
       <table style="width:100%;border-collapse:collapse;margin:12px 0;font-size:15px;">${rows}</table>
       ${button(loginUrl, "Log in")}
       <p style="background:#fff4e5;border-radius:12px;padding:12px 14px;color:#8a5a00;font-size:14px;">
         <strong>Important:</strong> You must change this temporary password immediately after your first login.
         You cannot access the student dashboard until you do.
       </p>
       <p style="color:#86868b;font-size:13px;">Keep your login details private. If you can't sign in, contact your course administrator.</p>`,
    ),
    text: `Hello ${name},\n\nYour ${BRAND} student account is ready.\n\nEmail: ${to}\nTemporary password: ${tempPassword}\nAccess expires on: ${expiryDate}\n\nLog in: ${loginUrl}\n\nIMPORTANT: Change your temporary password immediately after your first login. You cannot access the dashboard until you do.\n\nAdways Academy Team`,
  };
}

export function answerEmail(to: string, name: string, question: string, answer: string): EmailMessage {
  const link = `${env.APP_URL}/chat`;
  return {
    to,
    subject: `Your doubt has been answered`,
    html: layout(
      "Your doubt has been answered",
      `<p>Hi ${escapeHtml(name)},</p><p style="color:#86868b;">You asked:</p><blockquote style="margin:0 0 16px;padding:10px 14px;background:#f5f5f7;border-radius:12px;">${escapeHtml(question)}</blockquote><p style="color:#86868b;">Answer:</p><div style="white-space:pre-wrap;">${escapeHtml(answer)}</div>${button(link, "Open chat")}`,
    ),
    text: `Hi ${name},\nYou asked: ${question}\n\nAnswer:\n${answer}\n\nOpen chat: ${link}`,
  };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
