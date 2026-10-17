import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { hash as argonHash, verify as argonVerify } from "@node-rs/argon2";

const TEST = process.env.NODE_ENV === "test";

// --- Password hashing (argon2id) ---
export async function hashPassword(password: string): Promise<string> {
  return argonHash(password, {
    // OWASP-ish argon2id params in prod; cheap in tests (keeps the low-RAM
    // test host from failing argon2 memory allocations).
    memoryCost: TEST ? 512 : 19456,
    timeCost: TEST ? 1 : 2,
    parallelism: 1,
  });
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argonVerify(hash, password);
  } catch {
    return false;
  }
}

// --- Opaque tokens (sessions, email verification, password reset) ---
// We store only the sha256 of the token; the raw token is shown once.
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
