import { prisma } from "../db/prisma.js";
import { hashPassword } from "../lib/crypto.js";
import { normalizeEmail, validatePasswordStrength } from "../auth/authService.js";
import { destroyAllForUser } from "../auth/sessionService.js";

// Usage: npm run admin:reset-password -- <email> <newPassword>
async function main() {
  const [, , email, password] = process.argv;
  if (!email || !password) {
    console.error("Usage: admin:reset-password -- <email> <newPassword>");
    process.exit(1);
  }
  validatePasswordStrength(password);
  const user = await prisma.user.findUnique({ where: { email: normalizeEmail(email) } });
  if (!user) {
    console.error("No user with that email.");
    process.exit(1);
  }
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(password) } });
  await destroyAllForUser(user.id);
  console.log(`Password reset for ${user.email}`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
