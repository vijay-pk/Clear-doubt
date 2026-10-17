import supertest from "supertest";
import type TestAgent from "supertest/lib/agent.js";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";
import { registerJobHandlers } from "../src/bootstrap.js";
import { runDueJobs } from "../src/jobs/worker.js";
import { hashPassword } from "../src/lib/crypto.js";

registerJobHandlers();
export const app = createApp();

export function agent(): TestAgent {
  return supertest.agent(app);
}

// TRUNCATE every table between tests. Never point TEST_DATABASE_URL at real data.
export async function resetDb() {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE "AuditLog","DeliveryLog","Citation","ResponseDraft","Attachment",
      "DoubtMessage","Doubt","ApprovedAnswer","DocumentChunk","CourseDocument",
      "VerificationToken","Session","Job","Setting","User" RESTART IDENTITY CASCADE;
  `);
}

function csrfFrom(res: { headers: Record<string, unknown> }): string {
  const raw = res.headers["set-cookie"] as string[] | undefined;
  const line = raw?.find((c) => c.startsWith("adways_csrf="));
  return line ? decodeURIComponent(line.split(";")[0]!.split("=")[1]!) : "";
}

export async function seedAdmin(role: "ADMIN" | "SUPER_ADMIN" = "SUPER_ADMIN") {
  const email = `admin-${role.toLowerCase()}@test.local`;
  await prisma.user.create({
    data: { email, name: "Admin", role, emailVerified: true, passwordHash: await hashPassword("AdminPass123") },
  });
  return { email, password: "AdminPass123" };
}

export async function makeStudent(email = "stu@test.local", verified = true) {
  const user = await prisma.user.create({
    data: { email, name: "Student", role: "STUDENT", emailVerified: verified, passwordHash: await hashPassword("StudentPass1") },
  });
  return { user, email, password: "StudentPass1" };
}

export async function login(a: TestAgent, email: string, password: string) {
  const res = await a.post("/api/auth/login").send({ email, password });
  return { res, csrf: csrfFrom(res) };
}

export async function loginAsStudent(email = "stu@test.local") {
  await makeStudent(email, true);
  const a = agent();
  const { csrf } = await login(a, email, "StudentPass1");
  return { a, csrf };
}

export async function loginAsAdmin(role: "ADMIN" | "SUPER_ADMIN" = "SUPER_ADMIN") {
  const { email, password } = await seedAdmin(role);
  const a = agent();
  const { csrf } = await login(a, email, password);
  return { a, csrf };
}

export { runDueJobs, prisma };
