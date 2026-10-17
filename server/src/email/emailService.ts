import nodemailer, { type Transporter } from "nodemailer";
import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface EmailProvider {
  send(msg: EmailMessage): Promise<{ id?: string }>;
}

class ConsoleEmail implements EmailProvider {
  async send(msg: EmailMessage) {
    logger.info({ to: msg.to, subject: msg.subject }, "[console email] (set EMAIL_PROVIDER to send for real)");
    logger.debug({ text: msg.text }, "[console email body]");
    return { id: `console-${Date.now()}` };
  }
}

class ResendEmail implements EmailProvider {
  async send(msg: EmailMessage) {
    if (!env.RESEND_API_KEY) throw new Error("EMAIL_PROVIDER=resend requires RESEND_API_KEY");
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: env.EMAIL_FROM, to: msg.to, subject: msg.subject, html: msg.html, text: msg.text }),
    });
    if (!res.ok) throw new Error(`Resend failed (${res.status}): ${await res.text()}`);
    const data = (await res.json()) as { id?: string };
    return { id: data.id };
  }
}

class SmtpEmail implements EmailProvider {
  private transport: Transporter;
  constructor() {
    if (!env.SMTP_HOST || !env.SMTP_PORT) throw new Error("EMAIL_PROVIDER=smtp requires SMTP_HOST and SMTP_PORT");
    this.transport = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    });
  }
  async send(msg: EmailMessage) {
    const info = await this.transport.sendMail({
      from: env.EMAIL_FROM,
      to: msg.to,
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
    });
    return { id: info.messageId };
  }
}

let provider: EmailProvider | null = null;
export function getEmailProvider(): EmailProvider {
  if (!provider) {
    provider =
      env.EMAIL_PROVIDER === "resend"
        ? new ResendEmail()
        : env.EMAIL_PROVIDER === "smtp"
          ? new SmtpEmail()
          : new ConsoleEmail();
  }
  return provider;
}

// test hook
export function setEmailProvider(p: EmailProvider) {
  provider = p;
}
