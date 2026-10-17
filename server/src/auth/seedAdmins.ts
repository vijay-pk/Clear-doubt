import { z } from "zod";
import { prisma } from "../db/prisma.js";
import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";
import { hashPassword } from "../lib/crypto.js";
import { normalizeEmail } from "./authService.js";

const seedSchema = z.array(
  z.object({
    email: z.string().email(),
    name: z.string().min(2),
    password: z.string().min(10),
    role: z.enum(["ADMIN", "SUPER_ADMIN"]).default("ADMIN"),
  }),
);

// Seed pre-approved admins from ADMIN_SEED. Idempotent: existing emails are
// skipped and passwords are never overwritten. Safe to run on every boot — this
// is how admins are provisioned on hosts with no shell (e.g. Render free).
export async function seedAdminsFromEnv(): Promise<void> {
  if (!env.ADMIN_SEED) return;
  let parsed: z.infer<typeof seedSchema>;
  try {
    parsed = seedSchema.parse(JSON.parse(env.ADMIN_SEED));
  } catch (err) {
    logger.error({ err }, "ADMIN_SEED is invalid JSON or shape; skipping admin seed");
    return;
  }
  for (const admin of parsed) {
    const email = normalizeEmail(admin.email);
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) continue;
    await prisma.user.create({
      data: { email, name: admin.name, role: admin.role, emailVerified: true, passwordHash: await hashPassword(admin.password) },
    });
    logger.info({ email, role: admin.role }, "seeded admin");
  }
}
