import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import "dotenv/config";

// Apply migrations to the test database once. Skips when the schema already
// exists (keeps memory-constrained CI from re-spawning the Prisma CLI).
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is required.");

  const prisma = new PrismaClient({ datasourceUrl: url });
  let applied = false;
  try {
    await prisma.$queryRawUnsafe('SELECT 1 FROM "User" LIMIT 1');
    applied = true;
  } catch {
    applied = false;
  } finally {
    await prisma.$disconnect();
  }
  if (applied) return;

  // Run the local Prisma binary directly (lighter than npx) with a small heap.
  const bin = ["../node_modules/prisma/build/index.js", "node_modules/prisma/build/index.js"].find((p) => existsSync(p));
  const cmd = bin ? `node --max-old-space-size=512 ${bin} migrate deploy` : "npx prisma migrate deploy";
  execSync(cmd, { stdio: "inherit", env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url } });
}
