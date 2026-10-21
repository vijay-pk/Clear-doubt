import { prisma } from "../db/prisma.js";
import { logger } from "../lib/logger.js";

// Database-backed Baileys auth state (replaces useMultiFileAuthState).
// Storing the linked-device session in Postgres means the WhatsApp Web login
// survives restarts and redeploys (container disks are wiped on every deploy).
// The session is removed only when an admin logs out or the device is unlinked
// from the phone. Rows are credentials: never log their contents.

const CREDS_ID = "creds";

// Minimal slice of the Baileys module this store needs (loaded dynamically).
export interface BaileysAuthHelpers {
  initAuthCreds: () => unknown;
  BufferJSON: {
    replacer: (key: string, value: unknown) => unknown;
    reviver: (key: string, value: unknown) => unknown;
  };
  proto: { Message: { AppStateSyncKeyData: { fromObject: (obj: object) => unknown } } };
}

type KeyData = Record<string, Record<string, unknown>>;

// All writes run one at a time, in order, so a later creds update can never be
// overwritten by an earlier one that finished late.
let writeChain: Promise<unknown> = Promise.resolve();
// Bumped on clear: writes queued by an old (logged-out) socket are dropped
// instead of re-inserting a dead session.
let generation = 0;

function enqueue(gen: number, task: () => Promise<unknown>): Promise<void> {
  const run = writeChain.then(async () => {
    if (gen !== generation) return;
    await task();
  });
  writeChain = run.catch((err) =>
    logger.error({ err: err instanceof Error ? err.message : String(err) }, "WhatsApp Web session write failed"),
  );
  return run.then(() => undefined);
}

// True only for a session that finished linking (QR scanned), not a half-started one.
export async function hasStoredWhatsAppSession(): Promise<boolean> {
  const row = await prisma.whatsAppAuth.findUnique({ where: { id: CREDS_ID } });
  if (!row) return false;
  try {
    const creds = JSON.parse(row.data) as { me?: { id?: string } };
    return Boolean(creds.me?.id);
  } catch {
    return false;
  }
}

export async function clearStoredWhatsAppSession(): Promise<void> {
  generation++;
  await writeChain;
  await prisma.whatsAppAuth.deleteMany({});
}

export async function useDbAuthState(b: BaileysAuthHelpers) {
  const gen = generation;
  const encode = (value: unknown) => JSON.stringify(value, b.BufferJSON.replacer);
  const decode = (data: string) => JSON.parse(data, b.BufferJSON.reviver) as unknown;

  const writeRow = (id: string, value: unknown) => {
    const data = encode(value);
    return prisma.whatsAppAuth.upsert({ where: { id }, create: { id, data }, update: { data } });
  };

  const credsRow = await prisma.whatsAppAuth.findUnique({ where: { id: CREDS_ID } });
  const creds = credsRow ? decode(credsRow.data) : b.initAuthCreds();

  const state = {
    creds,
    keys: {
      get: async (type: string, ids: string[]) => {
        const out: Record<string, unknown> = {};
        if (ids.length === 0) return out;
        const rows = await prisma.whatsAppAuth.findMany({ where: { id: { in: ids.map((id) => `${type}:${id}`) } } });
        const byId = new Map(rows.map((r) => [r.id, r.data]));
        for (const id of ids) {
          const raw = byId.get(`${type}:${id}`);
          let value: unknown = raw === undefined ? null : decode(raw);
          if (type === "app-state-sync-key" && value) {
            value = b.proto.Message.AppStateSyncKeyData.fromObject(value as object);
          }
          out[id] = value;
        }
        return out;
      },
      set: async (data: KeyData) => {
        const upserts: Array<{ id: string; value: unknown }> = [];
        const deletes: string[] = [];
        for (const category of Object.keys(data)) {
          const entries = data[category] ?? {};
          for (const id of Object.keys(entries)) {
            const value = entries[id];
            if (value) upserts.push({ id: `${category}:${id}`, value });
            else deletes.push(`${category}:${id}`);
          }
        }
        if (upserts.length === 0 && deletes.length === 0) return;
        await enqueue(gen, () =>
          prisma.$transaction([
            ...upserts.map((u) => writeRow(u.id, u.value)),
            ...(deletes.length ? [prisma.whatsAppAuth.deleteMany({ where: { id: { in: deletes } } })] : []),
          ]),
        );
      },
    },
  };

  const saveCreds = () => enqueue(gen, () => writeRow(CREDS_ID, creds));

  return { state, saveCreds };
}
