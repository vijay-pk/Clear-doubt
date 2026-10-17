import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import QRCode from "qrcode";
import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";

// Outbound-only WhatsApp Web sender (Baileys, QR-linked device). Students use the
// web portal, so this only SENDS tutor answers — it does not read inbound messages.
// Unofficial automation: may violate WhatsApp's terms and get the number banned.
// Session files in WHATSAPP_WEB_SESSION_DIR are credentials — never logged or exposed.

type WebState = "disconnected" | "connecting" | "qr" | "connected" | "error";
const LOGGED_OUT = 401;
const RESTART_REQUIRED = 515;

// Loose socket surface so we don't hard-depend on Baileys types at the call sites.
interface WaSocket {
  user?: { id: string } | null;
  ev: { on(event: string, listener: (arg: never) => void): void };
  sendMessage(jid: string, content: { text: string }): Promise<{ key?: { id?: string | null } } | undefined>;
  logout(): Promise<void>;
  end(err: Error | undefined): void;
}

class WhatsAppWebManager {
  private sock: WaSocket | null = null;
  private state: WebState = "disconnected";
  private detail: string | undefined;
  private qrRaw: string | null = null;
  private selfId: string | null = null;
  private stopping = false;
  private retries = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private get sessionDir() {
    return resolve(env.WHATSAPP_WEB_SESSION_DIR);
  }

  isConnected() {
    return this.state === "connected" && this.sock !== null;
  }

  async status(): Promise<{ state: WebState; detail?: string; qr: string | null; botId: string | null }> {
    const qr = this.state === "qr" && this.qrRaw ? await QRCode.toDataURL(this.qrRaw) : null;
    return { state: this.state, detail: this.detail, qr, botId: this.selfId };
  }

  async connect(): Promise<void> {
    if (this.sock) return;
    this.stopping = false;
    await mkdir(this.sessionDir, { recursive: true, mode: 0o700 });
    await this.start();
  }

  async disconnect(): Promise<void> {
    this.stopping = true;
    this.clearTimer();
    const sock = this.sock;
    this.sock = null;
    sock?.end(undefined);
    this.setState("disconnected", "Disconnected by an administrator");
  }

  async logout(): Promise<void> {
    this.stopping = true;
    this.clearTimer();
    const sock = this.sock;
    this.sock = null;
    if (sock) {
      await sock.logout().catch(() => undefined);
      sock.end(undefined);
    }
    await this.clearSession();
    this.setState("disconnected", "Logged out. Connect again to scan a new QR code.");
  }

  // Send a text message to an E.164 phone number (e.g. +919812345678).
  async sendText(phoneE164: string, text: string): Promise<{ id: string }> {
    if (!this.sock || this.state !== "connected") throw new Error("WhatsApp Web is not connected");
    const digits = phoneE164.replace(/[^\d]/g, "");
    if (!digits) throw new Error("Invalid phone number");
    const jid = `${digits}@s.whatsapp.net`;
    const sent = await this.sock.sendMessage(jid, { text: text.slice(0, 4096) });
    const id = sent?.key?.id;
    if (!id) throw new Error("WhatsApp Web did not return a message id");
    return { id };
  }

  private async start(): Promise<void> {
    this.setState("connecting", "Connecting to WhatsApp…");
    let sock: WaSocket;
    try {
      const baileys = await import("@whiskeysockets/baileys");
      const { default: pino } = await import("pino");
      const { state, saveCreds } = await baileys.useMultiFileAuthState(this.sessionDir);
      const latest = await baileys.fetchLatestBaileysVersion().catch(() => null);
      sock = baileys.makeWASocket({
        auth: state,
        logger: pino({ level: "silent" }) as never, // Baileys logs can contain keys/payloads
        browser: baileys.Browsers.appropriate("Adways Doubts"),
        markOnlineOnConnect: false,
        syncFullHistory: false,
        ...(latest?.version ? { version: latest.version } : {}),
      }) as unknown as WaSocket;
      sock.ev.on("creds.update", saveCreds as (arg: never) => void);
    } catch (err) {
      this.setState("error", `Could not start WhatsApp Web: ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    }
    this.sock = sock;
    sock.ev.on("connection.update", ((u: { connection?: string; qr?: string; lastDisconnect?: { error?: unknown } }) => {
      void this.onConnectionUpdate(sock, u);
    }) as (arg: never) => void);
  }

  private async onConnectionUpdate(
    sock: WaSocket,
    u: { connection?: string; qr?: string; lastDisconnect?: { error?: unknown } },
  ): Promise<void> {
    if (sock !== this.sock) return;
    if (u.qr) {
      this.qrRaw = u.qr;
      this.setState("qr", "Scan with WhatsApp → Linked devices → Link a device.");
    }
    if (u.connection === "open") {
      this.qrRaw = null;
      this.retries = 0;
      this.selfId = sock.user?.id ?? null;
      this.setState("connected", "Linked and connected");
      logger.info("WhatsApp Web connected");
    }
    if (u.connection === "close") {
      this.sock = null;
      const code = (u.lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output?.statusCode;
      if (code === LOGGED_OUT) {
        await this.clearSession();
        this.setState("disconnected", "Device unlinked. Connect again to scan a new QR code.");
        return;
      }
      if (this.stopping) return;
      const delay = code === RESTART_REQUIRED ? 0 : Math.min(2000 * 2 ** this.retries, 60_000);
      this.retries++;
      this.setState("connecting", `Connection closed${code ? ` (${code})` : ""}; reconnecting…`);
      this.clearTimer();
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        if (!this.stopping && !this.sock) this.start().catch(() => undefined);
      }, delay);
    }
  }

  private async clearSession(): Promise<void> {
    this.selfId = null;
    this.qrRaw = null;
    await rm(this.sessionDir, { recursive: true, force: true }).catch((err) =>
      logger.error({ err: err instanceof Error ? err.message : String(err) }, "could not delete WhatsApp Web session"),
    );
  }

  private clearTimer(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private setState(state: WebState, detail?: string): void {
    this.state = state;
    this.detail = detail;
    if (state !== "qr") this.qrRaw = null;
  }
}

export const whatsappWeb = new WhatsAppWebManager();
