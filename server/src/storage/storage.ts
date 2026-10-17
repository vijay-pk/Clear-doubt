import { promises as fs } from "node:fs";
import path from "node:path";
import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";

export interface StoredObject {
  key: string;
}

export interface Storage {
  put(key: string, bytes: Buffer, contentType: string): Promise<StoredObject>;
  getBytes(key: string): Promise<Buffer>;
  // Returns a short-lived URL the client can use directly, or null when the
  // provider has none (caller must stream via an authorized endpoint instead).
  createSignedUrl(key: string, ttlSeconds: number): Promise<string | null>;
  remove(key: string): Promise<void>;
}

// ---- Local disk (dev / small deployments) ----
class LocalStorage implements Storage {
  private root = path.resolve(env.UPLOAD_DIR);

  private full(key: string) {
    // Prevent path traversal: keys are server-generated, but double-check.
    const safe = key.replace(/\.\.(\/|\\|$)/g, "").replace(/^[/\\]+/, "");
    return path.join(this.root, safe);
  }

  async put(key: string, bytes: Buffer): Promise<StoredObject> {
    const dest = this.full(key);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, bytes);
    return { key };
  }

  async getBytes(key: string): Promise<Buffer> {
    return fs.readFile(this.full(key));
  }

  async createSignedUrl(): Promise<string | null> {
    return null; // stream through the authorized /api download endpoint
  }

  async remove(key: string): Promise<void> {
    await fs.rm(this.full(key), { force: true });
  }
}

// ---- Supabase private bucket ----
class SupabaseStorage implements Storage {
  private base: string;
  private serviceKey: string;
  private bucket: string;

  constructor() {
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
      throw new Error("STORAGE_PROVIDER=supabase requires SUPABASE_URL and SUPABASE_SERVICE_KEY");
    }
    this.base = env.SUPABASE_URL.replace(/\/$/, "");
    this.serviceKey = env.SUPABASE_SERVICE_KEY;
    this.bucket = env.SUPABASE_BUCKET;
  }

  private headers() {
    return { Authorization: `Bearer ${this.serviceKey}`, apikey: this.serviceKey };
  }

  private bucketReady = false;

  // Create the private bucket on first use so deployment needs no manual step.
  private async ensureBucket(): Promise<void> {
    if (this.bucketReady) return;
    const res = await fetch(`${this.base}/storage/v1/bucket`, {
      method: "POST",
      headers: { ...this.headers(), "Content-Type": "application/json" },
      body: JSON.stringify({ id: this.bucket, name: this.bucket, public: false }),
    });
    // 200 = created; a conflict (already exists) is fine too.
    if (res.ok || res.status === 409) {
      this.bucketReady = true;
      return;
    }
    const text = await res.text();
    if (/already exists/i.test(text)) {
      this.bucketReady = true;
      return;
    }
    throw new Error(`Supabase bucket create failed (${res.status}): ${text}`);
  }

  async put(key: string, bytes: Buffer, contentType: string): Promise<StoredObject> {
    await this.ensureBucket();
    const url = `${this.base}/storage/v1/object/${this.bucket}/${encodeURI(key)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { ...this.headers(), "Content-Type": contentType, "x-upsert": "true" },
      body: new Uint8Array(bytes),
    });
    if (!res.ok) throw new Error(`Supabase upload failed (${res.status}): ${await res.text()}`);
    return { key };
  }

  async getBytes(key: string): Promise<Buffer> {
    const url = `${this.base}/storage/v1/object/${this.bucket}/${encodeURI(key)}`;
    const res = await fetch(url, { headers: this.headers() });
    if (!res.ok) throw new Error(`Supabase download failed (${res.status})`);
    return Buffer.from(await res.arrayBuffer());
  }

  async createSignedUrl(key: string, ttlSeconds: number): Promise<string | null> {
    const url = `${this.base}/storage/v1/object/sign/${this.bucket}/${encodeURI(key)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { ...this.headers(), "Content-Type": "application/json" },
      body: JSON.stringify({ expiresIn: ttlSeconds }),
    });
    if (!res.ok) {
      logger.warn({ status: res.status }, "supabase sign failed");
      return null;
    }
    const data = (await res.json()) as { signedURL?: string };
    return data.signedURL ? `${this.base}/storage/v1${data.signedURL}` : null;
  }

  async remove(key: string): Promise<void> {
    const url = `${this.base}/storage/v1/object/${this.bucket}/${encodeURI(key)}`;
    await fetch(url, { method: "DELETE", headers: this.headers() }).catch(() => {});
  }
}

let instance: Storage | null = null;
export function getStorage(): Storage {
  if (!instance) {
    instance = env.STORAGE_PROVIDER === "supabase" ? new SupabaseStorage() : new LocalStorage();
  }
  return instance;
}

// test hook
export function setStorage(s: Storage) {
  instance = s;
}
