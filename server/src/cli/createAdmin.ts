import { prisma } from "../db/prisma.js";
import { hashPassword } from "../lib/crypto.js";
import { normalizeEmail, validatePasswordStrength } from "../auth/authService.js";

// Usage: npm run admin:create -- <email> <name> <password> [SUPER_ADMIN|ADMIN]
async function main() {
  const [, , email, name, password, roleArg] = process.argv;
  if (!email || !name || !password) {
    console.error("Usage: admin:create -- <email> <name> <password> [SUPER_ADMIN|ADMIN]");
    process.exit(1);
  }
  const role = roleArg === "SUPER_ADMIN" ? "SUPER_ADMIN" : "ADMIN";
  validatePasswordStrength(password);
  const normalized = normalizeEmail(email);
  if (await prisma.user.findUnique({ where: { email: normalized } })) {
    console.error("A user with that email already exists.");
    process.exit(1);
  }
  const user = await prisma.user.create({
    data: { email: normalized, name, role, emailVerified: true, passwordHash: await hashPassword(password) },
  });
  console.log(`Created ${role}: ${user.email}`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
