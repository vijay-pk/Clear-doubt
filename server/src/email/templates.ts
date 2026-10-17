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
