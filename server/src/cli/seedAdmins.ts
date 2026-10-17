import { z } from "zod";
import { prisma } from "../db/prisma.js";
import { env } from "../config/env.js";
import { hashPassword } from "../lib/crypto.js";
import { normalizeEmail } from "../auth/authService.js";

// Seed pre-approved admins from ADMIN_SEED (JSON array). Idempotent: existing
// emails are skipped (never overwrites a password). Admins are NEVER self-service.
const seedSchema = z.array(
  z.object({
    email: z.string().email(),
    name: z.string().min(2),
    password: z.string().min(10),
    role: z.enum(["ADMIN", "SUPER_ADMIN"]).default("ADMIN"),
  }),
);

async function main() {
  if (!env.ADMIN_SEED) {
    console.error("ADMIN_SEED is not set. Nothing to seed.");
    process.exit(1);
  }
  let parsed;
  try {
    parsed = seedSchema.parse(JSON.parse(env.ADMIN_SEED));
  } catch (err) {
    console.error("ADMIN_SEED is invalid JSON or shape:", err);
    process.exit(1);
  }

  for (const admin of parsed) {
    const email = normalizeEmail(admin.email);
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      console.log(`skip (exists): ${email}`);
      continue;
    }
    await prisma.user.create({
      data: { email, name: admin.name, role: admin.role, emailVerified: true, passwordHash: await hashPassword(admin.password) },
    });
    console.log(`created ${admin.role}: ${email}`);
  }
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
