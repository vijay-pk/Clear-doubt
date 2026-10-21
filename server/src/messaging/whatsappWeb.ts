import QRCode from "qrcode";
import { logger } from "../lib/logger.js";
import { getSettings } from "../settings/settingsService.js";
import {
  clearStoredWhatsAppSession,
  hasStoredWhatsAppSession,
  useDbAuthState,
  type BaileysAuthHelpers,
} from "./whatsappWebAuthStore.js";

// Outbound-only WhatsApp Web sender (Baileys, QR-linked device). Students use the
// web portal, so this only SENDS tutor answers — it does not read inbound messages.
// Unofficial automation: may violate WhatsApp's terms and get the number banned.
// The linked-device session is stored in the database (WhatsAppAuth table) so the
// login survives restarts/redeploys; it is credentials — never logged or exposed.
// It is removed only by an admin logout or by unlinking the device on the phone.

type WebState = "disconnected" | "connecting" | "qr" | "connected" | "error";
const LOGGED_OUT = 401;
const RESTART_REQUIRED = 515;
const CONNECTION_REPLACED = 440; // another server instance took over (e.g. during a deploy)

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
    await this.start();
  }

  // On server start: reconnect automatically if a session is already linked, so
  // no QR scan is needed after a restart or redeploy.
  async resumeIfLinked(): Promise<void> {
    const settings = await getSettings();
    if (settings.whatsappProvider !== "web" || !settings.whatsappWebRiskAck) return;
    if (!(await hasStoredWhatsAppSession())) return;
    logger.info("Resuming saved WhatsApp Web session");
    await this.connect();
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
      const { state, saveCreds } = await useDbAuthState(baileys as unknown as BaileysAuthHelpers);
      const latest = await baileys.fetchLatestBaileysVersion().catch(() => null);
      sock = baileys.makeWASocket({
        auth: state as never,
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
      if (code === CONNECTION_REPLACED) {
        // A newer server instance is now using this session; let it keep the link.
        this.stopping = true;
        this.clearTimer();
        this.setState("disconnected", "Session taken over by another server instance.");
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
    await clearStoredWhatsAppSession().catch((err) =>
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
